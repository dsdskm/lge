import { randomUUID } from "node:crypto";

import { database, ensureRuntimeSchema } from "./database";
import { extractDocumentText } from "./document-extractor";
import { deleteFile, downloadFile, storageFolderPath, uploadLocalFile } from "./file-storage";
import { indexFile } from "./rag-service";

const documentExtensions = new Set(["txt", "md", "csv", "json", "pdf", "pptx", "xlsx"]);
type DocumentUpload = { originalname: string; mimetype: string; path: string; size: number };
let workerRunning = false;

export async function createDocumentJob(folderId: string, upload: DocumentUpload) {
    await ensureRuntimeSchema();
    const extension = upload.originalname.split(".").pop()?.toLowerCase();
    if (!extension || !documentExtensions.has(extension)) throw new Error("지원되는 파일 형식은 TXT, MD, CSV, JSON, PDF, PPTX, XLSX, MP4, MOV, WebM입니다.");
    const folder = await database.folder.findUnique({ where: { id: folderId } });
    if (!folder) throw new Error("Folder does not exist.");
    if (await database.file.findUnique({ where: { folderId_name: { folderId, name: upload.originalname } } })) throw new Error("같은 이름의 파일이 이미 있습니다.");
    const fileId = randomUUID();
    const jobId = randomUUID();
    const storagePath = `${storageFolderPath(folder.path)}${fileId}-${upload.originalname}`;
    await uploadLocalFile(storagePath, upload.path, upload.mimetype || "application/octet-stream");
    try {
        await database.$transaction(async (transaction) => {
            await transaction.file.create({ data: { id: fileId, folderId, name: upload.originalname, type: extension.toUpperCase(), updated: new Date().toISOString(), owner: "Teams user", active: false, sizeBytes: upload.size, storagePath } });
            await transaction.documentJob.create({ data: { id: jobId, fileId, folderId } });
            await transaction.storageUsage.upsert({ where: { id: 1 }, create: { id: 1, usedBytes: upload.size, totalBytes: 0 }, update: { usedBytes: { increment: upload.size } } });
        });
    } catch (error) {
        await deleteFile(storagePath);
        throw error;
    }
    void processPendingDocuments().catch((error: unknown) => console.error("[document] worker failed", error));
    return { jobId, fileId };
}

async function processDocument(job: { id: string; fileId: string; folderId: string }) {
    const file = await database.file.findUnique({ where: { id: job.fileId } });
    if (!file?.storagePath) throw new Error("Document file is unavailable.");
    await database.documentJob.update({ where: { id: job.id }, data: { progress: "문서에서 텍스트를 추출하고 있습니다." } });
    const document = await extractDocumentText(await downloadFile(file.storagePath), file.name, "");
    let progressUpdates = Promise.resolve();
    await indexFile(job.fileId, job.folderId, document, (progress) => {
        progressUpdates = progressUpdates.then(() => database.documentJob.update({ where: { id: job.id }, data: { progress } }))
            .then(() => undefined, (error: unknown) => console.error("[document] progress update failed", { jobId: job.id, error }));
    });
    await progressUpdates;
    await database.$transaction(async (transaction) => {
        await transaction.file.update({ where: { id: job.fileId }, data: { active: true, updated: new Date().toISOString() } });
        await transaction.documentJob.update({ where: { id: job.id }, data: { status: "completed", progress: "색인 완료" } });
    });
}

export async function processPendingDocuments(): Promise<void> {
    if (workerRunning) return;
    workerRunning = true;
    try {
        while (true) {
            const job = await database.documentJob.findFirst({ where: { status: "queued" }, orderBy: { createdAt: "asc" } });
            if (!job) break;
            const claimed = await database.documentJob.updateMany({ where: { id: job.id, status: "queued" }, data: { status: "processing", progress: "작업을 시작합니다." } });
            if (!claimed.count) continue;
            try {
                await processDocument(job);
            } catch (error) {
                console.error("[document] indexing failed", { jobId: job.id, error });
                await database.documentJob.update({ where: { id: job.id }, data: { status: "failed", progress: "색인 실패", error: error instanceof Error ? error.message : String(error) } });
            }
        }
    } finally {
        workerRunning = false;
    }
}

export async function resumeDocumentJobs(): Promise<void> {
    await ensureRuntimeSchema();
    await database.documentJob.updateMany({ where: { status: "processing" }, data: { status: "queued", progress: "재시작 후 처리를 재개합니다." } });
    void processPendingDocuments().catch((error: unknown) => console.error("[document] worker failed", error));
}

export async function listDocumentJobs(folderId: string) {
    await ensureRuntimeSchema();
    return database.documentJob.findMany({ where: { folderId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, fileId: true, status: true, progress: true, error: true } });
}

export async function retryDocumentJob(fileId: string): Promise<void> {
    await ensureRuntimeSchema();
    const job = await database.documentJob.findUnique({ where: { fileId } });
    if (!job || job.status !== "failed") throw new Error("Only failed document jobs can be retried.");
    await database.documentJob.update({ where: { id: job.id }, data: { status: "queued", progress: "재시도 대기 중", error: null } });
    void processPendingDocuments().catch((error: unknown) => console.error("[document] worker failed", error));
}