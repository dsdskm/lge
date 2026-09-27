import { VertexAI } from "@google-cloud/vertexai";
import { GoogleAuth } from "google-auth-library";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

import { config } from "./config";
import { database, ensureRuntimeSchema } from "./database";
import type { ExtractedChunk, ExtractedDocument } from "./document-extractor";
import { canRenderSlides } from "./evidence-preview";

export type AnswerSource = { fileId: string; fileName: string; chunkIndex: number; page?: number; slide?: number; startSeconds?: number; endSeconds?: number; previewAvailable?: boolean };

export type SearchProgress = {
    phase: "scope" | "matches";
    folders: Array<{ path: string; files: Array<{ name: string; selected?: boolean; chunks?: number }> }>;
    candidates?: Array<{ fileId: string; file: string; chunk: number; selected: boolean; vectorSimilarity: number; keywordMatches: number; folderMatches: number; titleMatches: number; headerMatches: number; score: number; selectionReason: string }>;
    topSimilar?: Array<{ fileId: string; file: string; chunk: number; similarity: number; preview: string }>;
    relatedFiles?: Array<{ name: string; active: boolean; chunkCount: number; reason: string }>;
    reason?: string;
};
export type ProgressReporter = (message: string, search?: SearchProgress) => void;

function vertex() {
    if (!config.gcpProjectId) throw new Error("GCP_PROJECT_ID is not configured.");
    return new VertexAI({ project: config.gcpProjectId, location: config.vertexLocation });
}

function splitText(text: string, size = 1800, overlap = 250): string[] {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const chunks: string[] = [];
    let current = "";
    for (const line of normalized.split("\n").map((value) => value.trim()).filter(Boolean)) {
        if (line.length > size) {
            if (current) chunks.push(current);
            for (let start = 0; start < line.length; start += size - overlap) {
                chunks.push(line.slice(start, start + size));
                if (start + size >= line.length) break;
            }
            current = "";
            continue;
        }
        const next = current ? `${current}\n${line}` : line;
        if (next.length > size) {
            chunks.push(current);
            current = line;
        } else {
            current = next;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

function queryTerms(question: string): string[] {
    return [...new Set((question.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])
        .map((term) => term.replace(/(?:에서|에게|으로|에|을|를|은|는|이|가|의)$/u, ""))
        .filter((term) => term.length >= 2))].slice(0, 12);
}

function searchText(text: string): string {
    return text.toLocaleLowerCase().replace(/(?<=[가-힣])\s+(?=[가-힣])/gu, "");
}

function isListQuestion(question: string): boolean {
    return /명단|누구|인원|출장자|출장.*알려|(?:사람|직원|인물).*목록/.test(question);
}

function matchesPersonField(content: string, term: string): boolean {
    return new RegExp(`^(?:본부/센터|부서1|부서2|직급):\\s*.*${term}.*$`, "mi").test(content);
}

function toVectorLiteral(values: number[]): string {
    if (values.length !== config.vertexEmbeddingDimensions || values.some((value) => !Number.isFinite(value))) {
        throw new Error(`Vertex embedding must contain ${config.vertexEmbeddingDimensions} finite dimensions.`);
    }
    return `[${values.join(",")}]`;
}

async function embed(texts: string[], reportProgress?: ProgressReporter, signal?: AbortSignal): Promise<number[][]> {
    signal?.throwIfAborted();
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const client = await auth.getClient();
    const token = (await client.getAccessToken()).token;
    const url = `https://${config.vertexLocation}-aiplatform.googleapis.com/v1/projects/${config.gcpProjectId}/locations/${config.vertexLocation}/publishers/google/models/${config.vertexEmbeddingModel}:predict`;
    const embeddings: number[][] = [];
    let batch: string[] = [];
    let batchCharacters = 0;
    let batchNumber = 0;
    // Korean text can use close to one token per character; keep a wide margin
    // below Vertex's 20,000-token request limit.
    const maxBatchCharacters = 8000;

    async function sendBatch(items: string[]) {
        if (!items.length) return;
        signal?.throwIfAborted();
        const currentBatch = ++batchNumber;
        const startedAt = Date.now();
        console.info(`[index] embedding batch ${currentBatch} started`, { items: items.length, completed: embeddings.length, total: texts.length });
        reportProgress?.(`임베딩 생성 중: ${embeddings.length}/${texts.length}개 청크 완료`);
        const response = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ instances: items.map((text) => ({ content: text })) }),
            signal,
        });
        if (!response.ok) throw new Error(`Vertex embedding failed (${response.status}): ${await response.text()}`);
        const body = await response.json() as { predictions?: Array<{ embeddings?: { values?: number[] } }> };
        embeddings.push(...(body.predictions ?? []).map((prediction) => prediction.embeddings?.values ?? []));
        console.info(`[index] embedding batch ${currentBatch} completed`, { completed: embeddings.length, total: texts.length, elapsedMs: Date.now() - startedAt });
        reportProgress?.(`임베딩 생성 중: ${embeddings.length}/${texts.length}개 청크 완료`);
    }

    for (const text of texts) {
        if (batch.length && batchCharacters + text.length > maxBatchCharacters) {
            await sendBatch(batch);
            batch = [];
            batchCharacters = 0;
        }
        batch.push(text);
        batchCharacters += text.length;
    }
    await sendBatch(batch);
    return embeddings;
}

export async function indexFile(fileId: string, folderId: string, document: ExtractedDocument, reportProgress?: ProgressReporter): Promise<void> {
    const startedAt = Date.now();
    const logPrefix = `[index] ${fileId}`;
    await ensureRuntimeSchema();
    const chunks: ExtractedChunk[] = document.chunks?.length ? document.chunks : splitText(document.text).map((content) => ({ content }));
    if (!chunks.length) throw new Error("The uploaded file contains no searchable text.");
    reportProgress?.(`${chunks.length}개 문서 청크를 준비했습니다.`);
    console.info(`${logPrefix} created ${chunks.length} chunks`);
    console.info(`${logPrefix} requesting embeddings`);
    reportProgress?.("문서 청크의 임베딩을 생성하고 있습니다.");
    const embeddings = await embed(chunks.map((chunk) => chunk.content), reportProgress).catch((error: unknown) => {
        console.error(`${logPrefix} embedding failed after ${Date.now() - startedAt}ms`, error);
        throw error;
    });
    console.info(`${logPrefix} received ${embeddings.length} embeddings; storing vectors`);
    reportProgress?.("pgvector에 임베딩을 저장하고 있습니다.");
    try {
        await database.$transaction(async (transaction) => {
            await transaction.documentChunk.deleteMany({ where: { fileId } });
            for (const [index, chunk] of chunks.entries()) {
                await transaction.$executeRaw(Prisma.sql`
                    INSERT INTO document_chunks (id, file_id, folder_id, chunk_index, content, metadata, embedding)
                    VALUES (${randomUUID()}, ${fileId}, ${folderId}, ${index}, ${chunk.content}, ${JSON.stringify(chunk.metadata ?? {})}::jsonb, ${toVectorLiteral(embeddings[index])}::vector)
                `);
                if ((index + 1) % 100 === 0 || index + 1 === chunks.length) {
                    console.info(`${logPrefix} stored ${index + 1}/${chunks.length} vectors`);
                    reportProgress?.(`벡터 저장 중: ${index + 1}/${chunks.length}개 완료`);
                }
            }
        }, { timeout: 120000 });
        console.info(`${logPrefix} completed in ${Date.now() - startedAt}ms`);
    } catch (error) {
        console.error(`${logPrefix} failed after ${Date.now() - startedAt}ms`, error);
        throw error;
    }
}

export async function answerQuestion(question: string, reportProgress?: ProgressReporter, signal?: AbortSignal): Promise<{ answer: string; sources: AnswerSource[] }> {
    signal?.throwIfAborted();
    const startedAt = Date.now();
    const terms = queryTerms(question);
    const videoQuestion = /영상|비디오|동영상|video/i.test(question);
    const listQuestion = !videoQuestion && isListQuestion(question);
    console.info("[rag] question received", { question, terms });
    await ensureRuntimeSchema();
    const eligibleFiles = { active: true, ...(videoQuestion ? { type: { in: ["MP4", "MOV", "WEBM"] } } : {}), chunks: { some: listQuestion ? { metadata: { path: ["recordType"], equals: "person" } } : {} } };
    const folders = await database.folder.findMany({
        where: { files: { some: eligibleFiles } },
        select: { path: true, files: { where: eligibleFiles, select: { id: true, name: true } } },
        orderBy: { path: "asc" },
    });
    signal?.throwIfAborted();
    reportProgress?.("활성 문서에서 관련 내용을 검색하고 있습니다.", {
        phase: "scope", folders: folders.map((folder) => ({ path: folder.path, files: folder.files.map((file) => ({ name: file.name })) })),
    });
    console.info("[rag] search scope", { folders: folders.map((folder) => ({ path: folder.path, files: folder.files.map((file) => file.name) })), elapsedMs: Date.now() - startedAt });
    const titleTerms = terms.filter((term) => term.length >= 2);
    const matchingFileIds = folders.flatMap((folder) => folder.files
        .filter((file) => titleTerms.some((term) => searchText(`${folder.path} ${file.name}`).includes(term)))
        .map((file) => file.id));
    console.info("[rag] document shortlist", { matchingFiles: matchingFileIds.length, totalFiles: folders.reduce((count, folder) => count + folder.files.length, 0) });
    reportProgress?.(matchingFileIds.length ? `폴더명·파일명으로 문서 ${matchingFileIds.length}개를 찾았습니다.` : "이름이 일치하는 문서가 없어 전체 문서를 검색합니다.");
    reportProgress?.("질문을 벡터 임베딩으로 변환하고 있습니다.");
    const queryEmbedding = (await embed([question], undefined, signal))[0];
    signal?.throwIfAborted();
    console.info("[rag] query embedded", { elapsedMs: Date.now() - startedAt });
    reportProgress?.("모든 활성 문서에서 관련 청크를 검색하고 있습니다.");
    type Candidate = { fileId: string; fileName: string; folderPath: string; chunkIndex: number; content: string; slide: string | null; page: string | null; startSeconds: string | null; endSeconds: string | null; recordType: string | null; similarity: number };
    const candidateQuery = (fileIds?: string[]) => Prisma.sql`
        WITH ranked_chunks AS (
         SELECT chunks.file_id AS "fileId", files.name AS "fileName", folders.path AS "folderPath", chunks.chunk_index AS "chunkIndex", chunks.content,
             chunks.metadata->>'slide' AS slide, chunks.metadata->>'page' AS page,
             chunks.metadata->>'startSeconds' AS "startSeconds", chunks.metadata->>'endSeconds' AS "endSeconds",
             chunks.metadata->>'recordType' AS "recordType",
               1 - (chunks.embedding <=> ${toVectorLiteral(queryEmbedding)}::vector) AS similarity,
               ROW_NUMBER() OVER (PARTITION BY chunks.file_id ORDER BY chunks.embedding <=> ${toVectorLiteral(queryEmbedding)}::vector) AS file_rank
        FROM document_chunks AS chunks
        JOIN files ON files.id = chunks.file_id
        JOIN folders ON folders.id = files.folder_id
        WHERE files.active = TRUE
                    ${videoQuestion ? Prisma.sql`AND files.type IN ('MP4', 'MOV', 'WEBM')` : Prisma.empty}
                    ${listQuestion ? Prisma.sql`AND chunks.metadata @> '{"recordType":"person"}'::jsonb` : Prisma.empty}
                    ${fileIds ? Prisma.sql`AND files.id IN (${Prisma.join(fileIds)})` : Prisma.empty}
        )
        SELECT "fileId", "fileName", "folderPath", "chunkIndex", content, slide, page, "startSeconds", "endSeconds", "recordType", similarity
        FROM ranked_chunks
        ${fileIds && !listQuestion ? Prisma.sql`WHERE file_rank <= 3` : Prisma.empty}
        ORDER BY similarity DESC
        LIMIT ${listQuestion ? 200 : fileIds ? 48 : 24}
    `;
    const lexicalQuery = () => Prisma.sql`
        SELECT chunks.file_id AS "fileId", files.name AS "fileName", folders.path AS "folderPath", chunks.chunk_index AS "chunkIndex", chunks.content,
               chunks.metadata->>'slide' AS slide, chunks.metadata->>'page' AS page,
               chunks.metadata->>'startSeconds' AS "startSeconds", chunks.metadata->>'endSeconds' AS "endSeconds",
               chunks.metadata->>'recordType' AS "recordType",
               1 - (chunks.embedding <=> ${toVectorLiteral(queryEmbedding)}::vector) AS similarity
        FROM document_chunks AS chunks
        JOIN files ON files.id = chunks.file_id
        JOIN folders ON folders.id = files.folder_id
        WHERE files.active = TRUE AND files.id IN (${Prisma.join(matchingFileIds)})
              ${videoQuestion ? Prisma.sql`AND files.type IN ('MP4', 'MOV', 'WEBM')` : Prisma.empty}
              ${listQuestion ? Prisma.sql`AND chunks.metadata @> '{"recordType":"person"}'::jsonb` : Prisma.empty}
              AND (${Prisma.join(terms.map((term) => Prisma.sql`regexp_replace(lower(chunks.content), '\\s+', '', 'g') LIKE ${`%${term}%`}`), " OR ")})
        ORDER BY chunks.embedding <=> ${toVectorLiteral(queryEmbedding)}::vector
        LIMIT 24
    `;
    const [documentCandidates, globalCandidates, lexicalCandidates] = await Promise.all([
        matchingFileIds.length ? database.$queryRaw<Candidate[]>(candidateQuery(matchingFileIds)) : Promise.resolve([]),
        database.$queryRaw<Candidate[]>(candidateQuery()),
        matchingFileIds.length && terms.length ? database.$queryRaw<Candidate[]>(lexicalQuery()) : Promise.resolve([]),
    ]);
    signal?.throwIfAborted();
    const candidates = [...new Map([...documentCandidates, ...globalCandidates, ...lexicalCandidates].map((candidate) => [`${candidate.fileId}:${candidate.chunkIndex}`, candidate])).values()];
    console.info("[rag] candidate pools", { documentChunks: documentCandidates.length, globalChunks: globalCandidates.length, lexicalChunks: lexicalCandidates.length, uniqueChunks: candidates.length });
    const headerFilterTerms = listQuestion ? terms.filter((term) => candidates.some((candidate) => matchesPersonField(candidate.content, term))) : [];
    const filteredCandidates = candidates.filter((candidate) =>
        (!headerFilterTerms.length || headerFilterTerms.every((term) => matchesPersonField(candidate.content, term)))
        && (!videoQuestion || candidate.recordType !== "video-title" || matchingFileIds.includes(candidate.fileId)));
    const matches = filteredCandidates
        .map((candidate) => {
            const keywordMatches = terms.filter((term) => searchText(candidate.content).includes(term)).length;
            const folderMatches = titleTerms.filter((term) => searchText(candidate.folderPath).includes(term)).length;
            const titleMatches = titleTerms.filter((term) => searchText(candidate.fileName).includes(term)).length;
            const headerMatches = listQuestion ? terms.filter((term) => matchesPersonField(candidate.content, term)).length : 0;
            return { ...candidate, keywordMatches, folderMatches, titleMatches, headerMatches, score: candidate.similarity + folderMatches * 0.35 + keywordMatches * 0.18 + titleMatches * 1.0 + headerMatches * 0.2 };
        })
        .sort((left, right) => right.score - left.score)
        .slice(0, listQuestion ? 200 : 8);
    const selectedCounts = new Map<string, number>();
    for (const match of matches) selectedCounts.set(match.fileId, (selectedCounts.get(match.fileId) ?? 0) + 1);
    const candidateIds = new Set(candidates.map((candidate) => candidate.fileId));
    console.info("[rag] search", { videoQuestion, listQuestion, headerFilterTerms, candidateCount: candidates.length, filteredCandidateCount: filteredCandidates.length, selectedCount: matches.length, elapsedMs: Date.now() - startedAt });
    const ranking = candidates.map((candidate) => {
        const selected = matches.find((match) => match.fileId === candidate.fileId && match.chunkIndex === candidate.chunkIndex);
        const keywordMatches = terms.filter((term) => searchText(candidate.content).includes(term)).length;
        const folderMatches = titleTerms.filter((term) => searchText(candidate.folderPath).includes(term)).length;
        const titleMatches = titleTerms.filter((term) => searchText(candidate.fileName).includes(term)).length;
        const headerMatches = listQuestion ? terms.filter((term) => matchesPersonField(candidate.content, term)).length : 0;
        return {
            selected: Boolean(selected),
            file: candidate.fileName,
            fileId: candidate.fileId,
            chunk: candidate.chunkIndex,
            vectorSimilarity: Number(candidate.similarity.toFixed(3)),
            keywordMatches, folderMatches, titleMatches, headerMatches,
            score: Number((candidate.similarity + folderMatches * 0.35 + keywordMatches * 0.18 + titleMatches * 1.0 + headerMatches * 0.2).toFixed(3)),
            selectionReason: selected ? "selected" : headerFilterTerms.some((term) => !matchesPersonField(candidate.content, term)) ? "person field filter" : "below ranking cutoff",
        };
    });
    console.info("[rag] candidate ranking", ranking);
    const relatedFiles = terms.length ? await database.file.findMany({
        where: { OR: terms.map((term) => ({ name: { contains: term, mode: "insensitive" as const } })), ...(videoQuestion ? { type: { in: ["MP4", "MOV", "WEBM"] } } : {}) },
        select: { id: true, name: true, active: true, _count: { select: { chunks: true } } }, take: 20,
    }) : [];
    signal?.throwIfAborted();
    const matchProgress: SearchProgress = {
        phase: "matches", folders: folders.map((folder) => ({
            path: folder.path, files: folder.files
                .filter((file) => candidateIds.has(file.id))
                .map((file) => ({ name: file.name, selected: selectedCounts.has(file.id), chunks: selectedCounts.get(file.id) ?? 0 }))
        })).filter((folder) => folder.files.length), candidates: ranking,
        topSimilar: globalCandidates.slice(0, 10).map((candidate) => ({ fileId: candidate.fileId, file: candidate.fileName, chunk: candidate.chunkIndex, similarity: Number(candidate.similarity.toFixed(3)), preview: candidate.content.replace(/\s+/g, " ").slice(0, 160) })),
        relatedFiles: relatedFiles.map((file) => ({
            name: file.name, active: file.active, chunkCount: file._count.chunks,
            reason: !file.active ? "비활성 문서" : !file._count.chunks ? "색인된 청크 없음" : selectedCounts.has(file.id) ? "답변 근거로 선택됨" : candidateIds.has(file.id) ? "후보에는 포함됐으나 최종 선택되지 않음" : "검색 후보 제한 밖 또는 명단 질문의 인물 필터 대상 아님",
        })),
    };
    reportProgress?.(matches.length ? `관련 청크 ${matches.length}개를 찾았습니다.` : "검색 결과를 확인하고 있습니다.", matchProgress);
    if (!matches.length) {
        const reason = candidates.length ? "person field filter excluded every candidate" : "no eligible indexed chunks (list questions require person records)";
        console.warn("[rag] no matching chunks", { listQuestion, headerFilterTerms, relatedFiles, reason });
        reportProgress?.("검색 가능한 청크가 없습니다.", { ...matchProgress, reason });
        return { answer: videoQuestion ? "검색 가능한 영상 음성 기록을 찾지 못했습니다. 영상에 음성 설명이 있는지 확인해 주세요." : "검색 가능한 문서를 찾지 못했습니다.", sources: [] };
    }
    reportProgress?.(`관련 문서 청크 ${matches.length}개를 확인했습니다.`);
    const context = matches.map((match, index) => `[${index + 1}] ${match.folderPath}/${match.fileName}${match.slide ? ` (slide ${match.slide})` : match.page ? ` (page ${match.page})` : match.startSeconds ? ` (${match.startSeconds}-${match.endSeconds} seconds)` : ""}\n${match.content}`).join("\n\n");
    const slidesAvailable = matches.some((match) => match.slide) && await canRenderSlides();
    const sources: AnswerSource[] = matches.map((match) => ({
        fileId: match.fileId, fileName: match.fileName, chunkIndex: match.chunkIndex,
        ...(match.page ? { page: Number(match.page), previewAvailable: true } : {}),
        ...(match.slide ? { slide: Number(match.slide), previewAvailable: slidesAvailable } : {}),
        ...(match.startSeconds ? { startSeconds: Number(match.startSeconds), endSeconds: Number(match.endSeconds) } : {}),
    }));
    const titleMatches = matches.filter((match) => match.recordType === "video-title");
    if (videoQuestion && titleMatches.length) {
        return { answer: `파일명으로 일치하는 영상: ${[...new Set(titleMatches.map((match) => match.fileName))].join(", ")}. 이 영상에는 음성 트랙이 없어 내용이나 화면 동작은 분석하지 않았습니다. 원본 영상을 직접 확인해 주세요.`, sources: sources.filter((source) => titleMatches.some((match) => match.fileId === source.fileId && match.chunkIndex === source.chunkIndex)) };
    }
    const prompt = await database.systemPrompt.findUnique({ where: { key: "rag.default" } });
    signal?.throwIfAborted();
    if (!prompt) throw new Error("RAG default prompt is not configured in the database.");
    console.info("[rag] generating answer", { model: config.vertexChatModel, sources: matches.map((match) => `${match.fileName}#${match.chunkIndex}`), contextCharacters: context.length, elapsedMs: Date.now() - startedAt });
    reportProgress?.("검색된 근거를 바탕으로 답변을 생성하고 있습니다.");
    const model = vertex().getGenerativeModel({ model: config.vertexChatModel });
    const listInstruction = listQuestion
        ? "\n\n이 질문은 명단 요청입니다. 전달된 모든 사람 행을 누락 없이 한 사람씩 목록으로 출력하세요. 총원만 답하거나 일부 예시만 제시하지 마세요. 각 사람은 성명, 이메일, 본부/센터, 부서1, 부서2, 직급, 출장 목적을 표시하고 문서에 없는 값은 미기재로 쓰세요."
        : "";
    const generation = model.generateContent({ contents: [{ role: "user", parts: [{ text: `${prompt.content}\n\n출처에 직접 적힌 사실만 답변하세요. 행이나 표의 경우 동일한 출처 행에서 직책, 이름, 일정 등 질문 조건이 모두 일치하는지 확인하세요. 근거가 부족하면 추정하지 말고 모른다고 답하세요.${listInstruction}${videoQuestion ? "\n영상에 대해 묻는 질문입니다. 음성 전사에 나온 말만 근거로 영상을 찾고, 화면 속 동작은 추정하지 마세요. 찾은 구간의 시간을 함께 알려주세요." : ""}\n\n질문: ${question}\n\n문서:\n${context}` }] }] });
    const result = signal ? await new Promise<Awaited<typeof generation>>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        generation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
        if (signal.aborted) onAbort();
    }) : await generation;
    signal?.throwIfAborted();
    const answer = result.response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const cannotAnswer = !answer.trim() || /(?:제공된 문서|문서).*?(?:정보|내용|근거).*?(?:없|부족)|답변할 수 없|답변을 생성하지 못/u.test(answer);
    const sourceLocations = [...new Set(matches.map((match) => `${match.fileName}${match.slide ? ` (${match.slide}페이지)` : ""}`))];
    if (cannotAnswer) console.warn("[rag] model could not answer from selected sources", { sourceLocations, finishReasons: result.response.candidates?.map((candidate) => candidate.finishReason) });
    const responseAnswer = cannotAnswer
        ? `정확한 답변을 생성하지 못했습니다. 검색된 후보 파일을 직접 확인해 주세요: ${sourceLocations.join(", ")}.`
        : answer;
    console.info("[rag] answer generated", { sources: matches.map((match) => `${match.fileName}#${match.chunkIndex}`), answerLength: responseAnswer.length, elapsedMs: Date.now() - startedAt });
    return { answer: responseAnswer, sources };
}
