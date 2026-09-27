import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { SpeechClient } from "@google-cloud/speech";
import { VertexAI } from "@google-cloud/vertexai";
import ffmpegPath from "ffmpeg-static";

import { config } from "./config";
import { database, ensureRuntimeSchema } from "./database";
import type { ExtractedChunk } from "./document-extractor";
import { deleteFile, downloadToFile, storageFolderPath, storageUri, uploadLocalFile } from "./file-storage";
import { indexFile } from "./rag-service";

const execute = promisify(execFile);
export const videoExtensions = new Set(["mp4", "mov", "webm"]);

type VideoUpload = { originalname: string; mimetype: string; path: string; size: number };

export function hasNoAudioStream(error: unknown): boolean {
    const output = error as { stderr?: string; message?: string };
    return /Output file does not contain any stream|matches no streams/i.test(`${output.stderr ?? ""}\n${output.message ?? ""}`);
}

function seconds(value: { seconds?: number | string | { toString(): string } | null; nanos?: number | null } | null | undefined): number {
    return Number(value?.seconds ?? 0) + Number(value?.nanos ?? 0) / 1e9;
}

export function transcriptChunks(results: Array<{ alternatives?: Array<{ transcript?: string | null }> | null; resultEndTime?: { seconds?: number | string | { toString(): string } | null; nanos?: number | null } | null }>): ExtractedChunk[] {
    const chunks: ExtractedChunk[] = [];
    let start = 0;
    let end = 0;
    let lines: string[] = [];
    const flush = () => {
        if (!lines.length) return;
        chunks.push({ content: `Video ${Math.floor(start / 60)}:${String(Math.floor(start % 60)).padStart(2, "0")}-${Math.floor(end / 60)}:${String(Math.floor(end % 60)).padStart(2, "0")}\n${lines.join(" ")}`, metadata: { startSeconds: String(Math.floor(start)), endSeconds: String(Math.ceil(end)), recordType: "video-transcript" } });
        lines = [];
    };
    for (const result of results) {
        const text = result.alternatives?.[0]?.transcript?.trim();
        if (!text) continue;
        const resultEnd = seconds(result.resultEndTime);
        if (!lines.length) start = end;
        if (lines.length && (resultEnd - start > 30 || lines.join(" ").length + text.length > 1500)) {
            flush();
            start = end;
        }
        lines.push(text);
        end = Math.max(end, resultEnd);
    }
    flush();
    return chunks;
}

export function parseVertexTranscript(value: unknown, offsetSeconds: number): ExtractedChunk[] {
    if (!Array.isArray(value)) throw new Error("Vertex transcription did not return timestamped segments.");
    return value.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== "object") return [];
        const segment = entry as { startSeconds?: unknown; endSeconds?: unknown; text?: unknown };
        if (typeof segment.text !== "string" || !segment.text.trim() || typeof segment.startSeconds !== "number" || typeof segment.endSeconds !== "number"
            || !Number.isFinite(segment.startSeconds) || !Number.isFinite(segment.endSeconds) || segment.startSeconds < 0 || segment.endSeconds < segment.startSeconds || segment.endSeconds > 310) return [];
        const start = Math.floor(offsetSeconds + segment.startSeconds);
        const end = Math.ceil(offsetSeconds + segment.endSeconds);
        const chunks: ExtractedChunk[] = [];
        for (let position = 0; position < segment.text.length; position += 1500) {
            chunks.push({ content: `Video ${Math.floor(start / 60)}:${String(start % 60).padStart(2, "0")}-${Math.floor(end / 60)}:${String(end % 60).padStart(2, "0")}\n${segment.text.slice(position, position + 1500)}`, metadata: { startSeconds: String(start), endSeconds: String(end), recordType: "video-transcript" } });
        }
        return chunks;
    });
}

async function transcribeWithVertex(audio: string, directory: string, jobId: string): Promise<ExtractedChunk[]> {
    if (!ffmpegPath || !config.gcpProjectId) throw new Error("Vertex audio transcription is unavailable.");
    await execute(ffmpegPath, ["-nostdin", "-loglevel", "error", "-i", audio, "-f", "segment", "-segment_time", "300", "-c", "copy", path.join(directory, "segment-%03d.flac")], { timeout: 30 * 60 * 1000 });
    const segments = (await readdir(directory)).filter((name) => /^segment-\d+\.flac$/.test(name)).sort();
    const model = new VertexAI({ project: config.gcpProjectId, location: config.vertexLocation }).getGenerativeModel({ model: config.vertexChatModel });
    const chunks: ExtractedChunk[] = [];
    for (const [index, segment] of segments.entries()) {
        const object = `${storageFolderPath("_transcripts")}${jobId}-${index}.flac`;
        await uploadLocalFile(object, path.join(directory, segment), "audio/flac");
        try {
            const response = await model.generateContent({
                contents: [{
                    role: "user", parts: [
                        { fileData: { fileUri: storageUri(object), mimeType: "audio/flac" } },
                        { text: "Transcribe only the speech in this audio. Return a JSON array of segments with numeric startSeconds, endSeconds (relative to this audio), and verbatim text. Prefer segments of 20-30 seconds. Do not describe visuals or invent speech." },
                    ]
                }], generationConfig: { responseMimeType: "application/json" }
            });
            const text = response.response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
            if (!text) throw new Error("Vertex did not return a transcription.");
            chunks.push(...parseVertexTranscript(JSON.parse(text) as unknown, index * 300));
        } finally {
            await deleteFile(object);
        }
    }
    return chunks;
}

export async function createVideoJob(folderId: string, file: VideoUpload) {
    await ensureRuntimeSchema();
    const extension = file.originalname.split(".").pop()?.toLowerCase();
    if (!extension || !videoExtensions.has(extension)) throw new Error("지원되는 영상 형식은 MP4, MOV, WebM입니다.");
    const folder = await database.folder.findUnique({ where: { id: folderId } });
    if (!folder) throw new Error("Folder does not exist.");
    const id = randomUUID();
    const jobId = randomUUID();
    const storagePath = `${storageFolderPath(folder.path)}${id}-${file.originalname}`;
    await uploadLocalFile(storagePath, file.path, file.mimetype || "application/octet-stream");
    try {
        await database.$transaction(async (transaction) => {
            await transaction.file.create({ data: { id, folderId, name: file.originalname, type: extension.toUpperCase(), updated: new Date().toISOString(), owner: "Teams user", active: false, sizeBytes: file.size, storagePath } });
            await transaction.videoJob.create({ data: { id: jobId, fileId: id, folderId, status: "queued", progress: "처리 대기 중" } });
            await transaction.storageUsage.upsert({ where: { id: 1 }, create: { id: 1, usedBytes: file.size, totalBytes: 0 }, update: { usedBytes: { increment: file.size } } });
        });
    } catch (error) {
        await deleteFile(storagePath);
        throw error;
    }
    void processPendingVideos().catch((error: unknown) => console.error("[video] worker failed", error));
    return { jobId, fileId: id };
}

async function processVideo(job: { id: string; fileId: string; folderId: string }) {
    const file = await database.file.findUnique({ where: { id: job.fileId } });
    if (!file?.storagePath) throw new Error("Video file is unavailable.");
    const directory = await mkdtemp(path.join(os.tmpdir(), "video-index-"));
    const audioPath = `${storageFolderPath("_transcripts")}${job.id}.flac`;
    try {
        await database.videoJob.update({ where: { id: job.id }, data: { progress: "영상 음성을 추출하고 있습니다." } });
        const video = path.join(directory, "source" + path.extname(file.name));
        const audio = path.join(directory, "audio.flac");
        await downloadToFile(file.storagePath, video);
        if (!ffmpegPath) throw new Error("FFmpeg binary is unavailable.");
        try {
            await execute(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", video, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "flac", audio], { timeout: 30 * 60 * 1000 });
        } catch (error) {
            if (!hasNoAudioStream(error)) throw error;
            await database.videoJob.update({ where: { id: job.id }, data: { progress: "음성 트랙이 없어 파일명만 색인하고 있습니다." } });
            await indexFile(job.fileId, job.folderId, {
                text: `영상 파일명: ${file.name}. 음성 트랙이 없어 영상 내용은 분석되지 않았습니다.`,
                chunks: [{ content: `영상 파일명: ${file.name}. 음성 트랙이 없어 영상 내용은 분석되지 않았습니다.`, metadata: { recordType: "video-title" } }],
            });
            await database.$transaction(async (transaction) => {
                await transaction.file.update({ where: { id: job.fileId }, data: { active: true, updated: new Date().toISOString() } });
                await transaction.videoJob.update({ where: { id: job.id }, data: { status: "completed", progress: "음성 없는 영상: 파일명만 검색 가능" } });
            });
            return;
        }
        await database.videoJob.update({ where: { id: job.id }, data: { progress: "음성을 전사하고 있습니다." } });
        await uploadLocalFile(audioPath, audio, "audio/flac");
        const speech = new SpeechClient({ ...(config.gcpProjectId ? { projectId: config.gcpProjectId } : {}), ...(config.googleApplicationCredentials ? { keyFilename: config.googleApplicationCredentials } : {}) });
        try {
            let chunks: ExtractedChunk[];
            try {
                const [operation] = await speech.longRunningRecognize({ audio: { uri: storageUri(audioPath) }, config: { encoding: "FLAC", sampleRateHertz: 16000, languageCode: "ko-KR", alternativeLanguageCodes: ["en-US"], enableAutomaticPunctuation: true } });
                const [transcription] = await operation.promise();
                chunks = transcriptChunks(transcription.results ?? []);
            } catch (error) {
                if ((error as { code?: number }).code !== 7 || !String(error).includes("speech.googleapis.com")) throw error;
                await database.videoJob.update({ where: { id: job.id }, data: { progress: "Vertex로 음성을 전사하고 있습니다." } });
                chunks = await transcribeWithVertex(audio, directory, job.id);
            }
            if (!chunks.length) throw new Error("영상에서 음성을 인식하지 못했습니다. 음성 설명이 있는 영상을 업로드해 주세요.");
            await database.videoJob.update({ where: { id: job.id }, data: { progress: `${chunks.length}개 시간 구간을 색인하고 있습니다.` } });
            await indexFile(job.fileId, job.folderId, { text: chunks.map((chunk) => chunk.content).join("\n\n"), chunks });
            await database.$transaction(async (transaction) => {
                await transaction.file.update({ where: { id: job.fileId }, data: { active: true, updated: new Date().toISOString() } });
                await transaction.videoJob.update({ where: { id: job.id }, data: { status: "completed", progress: `${chunks.length}개 구간 색인 완료` } });
            });
        } finally {
            await speech.close();
        }
    } finally {
        await deleteFile(audioPath);
        await rm(directory, { recursive: true, force: true });
    }
}

let workerRunning = false;

export async function processPendingVideos(): Promise<void> {
    if (workerRunning) return;
    workerRunning = true;
    try {
        while (true) {
            const job = await database.videoJob.findFirst({ where: { status: "queued" }, orderBy: { createdAt: "asc" } });
            if (!job) break;
            const claimed = await database.videoJob.updateMany({ where: { id: job.id, status: "queued" }, data: { status: "processing", progress: "작업을 시작합니다." } });
            if (!claimed.count) continue;
            try {
                await processVideo(job);
            } catch (error) {
                console.error("[video] indexing failed", { jobId: job.id, error });
                await database.videoJob.update({ where: { id: job.id }, data: { status: "failed", progress: "색인 실패", error: error instanceof Error ? error.message : String(error) } });
            }
        }
    } finally {
        workerRunning = false;
    }
}

export async function resumeVideoJobs(): Promise<void> {
    await ensureRuntimeSchema();
    await database.videoJob.updateMany({ where: { status: "processing" }, data: { status: "queued", progress: "재시작 후 처리를 재개합니다." } });
    void processPendingVideos().catch((error: unknown) => console.error("[video] worker failed", error));
}

export async function listVideoJobs(folderId: string) {
    await ensureRuntimeSchema();
    return database.videoJob.findMany({ where: { folderId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, fileId: true, status: true, progress: true, error: true } });
}

export async function retryVideoJob(fileId: string): Promise<void> {
    await ensureRuntimeSchema();
    const job = await database.videoJob.findUnique({ where: { fileId } });
    if (!job || job.status !== "failed") throw new Error("Only failed video jobs can be retried.");
    await database.videoJob.update({ where: { id: job.id }, data: { status: "queued", progress: "재시도 대기 중", error: null } });
    void processPendingVideos().catch((error: unknown) => console.error("[video] worker failed", error));
}