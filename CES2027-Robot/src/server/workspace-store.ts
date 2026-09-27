import { randomUUID } from "crypto";

import { copyFile, copyFolderPrefix, createFolderPrefix, deleteFile, deleteFolderPrefix, downloadFile, getBucketStorageUsage, getFileSize, moveFile, moveFolderPrefix, storageFolderPath, uploadFile } from "./file-storage";
import { extractDocumentText } from "./document-extractor";
import { indexFile, type ProgressReporter } from "./rag-service";
import { database, ensureRuntimeSchema } from "./database";
import { countFilesInSubtree } from "./folder-counts";

export type WorkspaceFolder = { id: string; name: string; parentId?: string; path?: string; count: number };
export type WorkspaceFile = { id: string; folderId: string; name: string; type: string; updated: string; owner: string; active: boolean; sizeBytes: number; chunkCount: number; storagePath?: string };
export type WorkspaceData = { folders: WorkspaceFolder[]; files: WorkspaceFile[]; storage: { usedBytes: number; totalBytes: number } };
export type AdminData = {
    prompt: { key: string; content: string } | null;
    accounts: Array<{ id: string; displayName: string; email: string; role: string; status: string }>;
    stats: {
        folderCount: number;
        fileCount: number;
        chunkCount: number;
        usedBytes: number;
        totalBytes: number;
        retrieval: { searchScope: string; topK: number; threshold: string };
        recentFiles: Array<{ id: string; name: string; updated: string }>;
    };
};

function folderView(folder: { id: string; name: string; parentId: string | null; path: string; _count?: { files: number } }): WorkspaceFolder {
    return { id: folder.id, name: folder.name, ...(folder.parentId ? { parentId: folder.parentId } : {}), path: folder.path, count: folder._count?.files ?? 0 };
}

function fileView(file: { id: string; folderId: string; name: string; type: string; updated: string; owner: string; active: boolean; sizeBytes: bigint; storagePath: string | null; _count?: { chunks: number } }): WorkspaceFile {
    return { id: file.id, folderId: file.folderId, name: file.name, type: file.type, updated: file.updated, owner: file.owner, active: file.active, sizeBytes: Number(file.sizeBytes), chunkCount: file._count?.chunks ?? 0, ...(file.storagePath ? { storagePath: file.storagePath } : {}) };
}

async function filesView(files: Array<{ id: string; folderId: string; name: string; type: string; updated: string; owner: string; active: boolean; sizeBytes: bigint; storagePath: string | null; _count?: { chunks: number } }>, options: { useStorageSize?: boolean } = {}): Promise<WorkspaceFile[]> {
    return Promise.all(files.map(async (file) => {
        const view = fileView(file);
        if ((options.useStorageSize || !view.sizeBytes) && file.storagePath) {
            try {
                view.sizeBytes = await getFileSize(file.storagePath);
            } catch {
                view.sizeBytes = 0;
            }
        }
        return view;
    }));
}

export async function getWorkspace(): Promise<WorkspaceData> {
    await ensureRuntimeSchema();
    const [folders, files, storage, gcsUsedBytes] = await Promise.all([
        database.folder.findMany({ orderBy: [{ path: "asc" }] }),
        database.file.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { chunks: true } } } }),
        database.storageUsage.findUnique({ where: { id: 1 } }),
        getBucketStorageUsage(),
    ]);
    const counts = countFilesInSubtree(folders, files);
    return { folders: folders.map((folder) => ({ ...folderView(folder), count: counts.get(folder.id) ?? 0 })), files: await filesView(files), storage: { usedBytes: gcsUsedBytes, totalBytes: Number(storage?.totalBytes ?? 0) } };
}

export async function getAdminData(): Promise<AdminData> {
    await ensureRuntimeSchema();
    const [prompt, accounts, folderCount, fileCount, chunkCount, storage, gcsUsedBytes, recentFiles] = await Promise.all([
        database.systemPrompt.findUnique({ where: { key: "rag.default" } }),
        database.account.findMany({ orderBy: { displayName: "asc" } }),
        database.folder.count(),
        database.file.count(),
        database.documentChunk.count(),
        database.storageUsage.findUnique({ where: { id: 1 } }),
        getBucketStorageUsage(),
        database.file.findMany({ orderBy: { updated: "desc" }, take: 5, select: { id: true, name: true, updated: true } }),
    ]);
    return {
        prompt,
        accounts,
        stats: {
            folderCount,
            fileCount,
            chunkCount,
            usedBytes: gcsUsedBytes,
            totalBytes: Number(storage?.totalBytes ?? 0),
            retrieval: { searchScope: "All indexed document chunks", topK: 8, threshold: "Not configured" },
            recentFiles,
        },
    };
}

export async function updateDefaultPrompt(content: string) {
    return database.systemPrompt.upsert({ where: { key: "rag.default" }, create: { key: "rag.default", content }, update: { content } });
}

export async function getFolderFiles(folderId: string): Promise<WorkspaceFile[]> {
    await ensureRuntimeSchema();
    return filesView(await database.file.findMany({ where: { folderId }, orderBy: { name: "asc" }, include: { _count: { select: { chunks: true } } } }), { useStorageSize: true });
}

export async function createFolder(name: string, parentId?: string): Promise<WorkspaceFolder> {
    const parent = parentId ? await database.folder.findUnique({ where: { id: parentId } }) : null;
    if (parentId && !parent) throw new Error("Parent folder does not exist.");
    const id = randomUUID();
    const path = parent ? `${parent.path}/${name}` : name;
    await createFolderPrefix(path);
    try {
        const folder = await database.folder.create({ data: { id, name, parentId: parentId ?? null, path }, include: { _count: { select: { files: true } } } });
        return folderView(folder);
    } catch (error) {
        await deleteFolderPrefix(path);
        throw error;
    }
}

export async function updateFolder(id: string, name: string, parentId?: string): Promise<void> {
    const current = await database.folder.findUnique({ where: { id } });
    if (!current) throw new Error("Folder does not exist.");
    if (parentId === id) throw new Error("A folder cannot be its own parent.");
    const parent = parentId ? await database.folder.findUnique({ where: { id: parentId } }) : null;
    if (parentId && !parent) throw new Error("Parent folder does not exist.");
    const nextPath = parent ? `${parent.path}/${name}` : name;
    await moveFolderPrefix(current.path, nextPath);
    const descendants = await database.folder.findMany({ where: { OR: [{ path: current.path }, { path: { startsWith: `${current.path}/` } }] } });
    await database.$transaction(async (tx) => {
        for (const folder of descendants) {
            const nextDescendantPath = `${nextPath}${folder.path.slice(current.path.length)}`;
            await tx.folder.update({ where: { id: folder.id }, data: { path: nextDescendantPath, ...(folder.id === id ? { name, parentId: parentId ?? null } : {}) } });
        }
    });
    const files = await database.file.findMany({ where: { folderId: { in: descendants.map((folder) => folder.id) } } });
    for (const file of files) {
        if (file.storagePath) await database.file.update({ where: { id: file.id }, data: { storagePath: file.storagePath.replace(storageFolderPath(current.path), storageFolderPath(nextPath)) } });
    }
}

export async function removeFolder(id: string): Promise<void> {
    const folder = await database.folder.findUnique({ where: { id } });
    if (!folder) throw new Error("Folder does not exist.");
    const descendants = await database.folder.findMany({ where: { OR: [{ id }, { path: { startsWith: `${folder.path}/` } }] }, select: { id: true } });
    const folderIds = descendants.map((item) => item.id);
    const [pendingVideos, pendingDocuments] = await Promise.all([
        database.videoJob.count({ where: { folderId: { in: folderIds }, status: { in: ["queued", "processing"] } } }),
        database.documentJob.count({ where: { folderId: { in: folderIds }, status: { in: ["queued", "processing"] } } }),
    ]);
    if (pendingVideos || pendingDocuments) throw new Error("색인이 완료된 후 폴더를 삭제할 수 있습니다.");
    await deleteFolderPrefix(folder.path);
    await database.$transaction([database.videoJob.deleteMany({ where: { folderId: { in: folderIds } } }), database.documentJob.deleteMany({ where: { folderId: { in: folderIds } } }), database.folder.delete({ where: { id } })]);
}

export async function addFile(folderId: string, file: { originalname: string; mimetype: string; buffer: Buffer }, reportProgress?: ProgressReporter): Promise<WorkspaceFile> {
    const startedAt = Date.now();
    const logPrefix = `[upload] ${file.originalname}`;
    console.info(`${logPrefix} started (${file.buffer.byteLength} bytes)`);
    await ensureRuntimeSchema();
    const folder = await database.folder.findUnique({ where: { id: folderId } });
    if (!folder) throw new Error("Folder does not exist.");
    const extension = file.originalname.split(".").pop()?.toLowerCase();
    if (!extension || !new Set(["txt", "md", "csv", "json", "pdf", "pptx", "xlsx"]).has(extension)) throw new Error("지원되는 파일 형식은 TXT, MD, CSV, JSON, PDF, PPTX, XLSX입니다.");
    console.info(`${logPrefix} extracting text`);
    reportProgress?.("파일에서 텍스트를 추출하고 있습니다.");
    const extractedText = await extractDocumentText(file.buffer, file.originalname, file.mimetype).catch((error: unknown) => {
        console.error(`${logPrefix} extraction failed after ${Date.now() - startedAt}ms`, error);
        throw error;
    });
    console.info(`${logPrefix} extracted ${extractedText.text.length} characters in ${Date.now() - startedAt}ms`);
    const id = randomUUID();
    const storagePath = `${storageFolderPath(folder.path)}${file.originalname}`;
    console.info(`${logPrefix} uploading to storage`);
    reportProgress?.("원본 파일을 저장하고 있습니다.");
    const storageStartedAt = Date.now();
    await uploadFile(storagePath, file.buffer, file.mimetype).catch((error: unknown) => {
        console.error(`${logPrefix} storage upload failed after ${Date.now() - storageStartedAt}ms`, error);
        throw error;
    });
    console.info(`${logPrefix} stored original in ${Date.now() - storageStartedAt}ms`);
    try {
        console.info(`${logPrefix} creating file record`);
        reportProgress?.("파일 정보를 등록하고 있습니다.");
        const created = await database.file.create({ data: { id, folderId, name: file.originalname, type: extension.toUpperCase(), updated: new Date().toISOString(), owner: "Teams user", sizeBytes: file.buffer.byteLength, storagePath } });
        await database.storageUsage.upsert({ where: { id: 1 }, create: { id: 1, usedBytes: file.buffer.byteLength, totalBytes: 0 }, update: { usedBytes: { increment: file.buffer.byteLength } } });
        console.info(`${logPrefix} indexing for RAG`);
        reportProgress?.("RAG 검색을 위해 문서를 색인하고 있습니다.");
        await indexFile(id, folderId, extractedText, reportProgress);
        console.info(`${logPrefix} completed in ${Date.now() - startedAt}ms`);
        return fileView(await database.file.findUniqueOrThrow({ where: { id } }));
    } catch (error) {
        console.error(`${logPrefix} failed after ${Date.now() - startedAt}ms`, error);
        await database.file.deleteMany({ where: { id } });
        await database.storageUsage.updateMany({ where: { id: 1 }, data: { usedBytes: { decrement: file.buffer.byteLength } } });
        await deleteFile(storagePath);
        throw error;
    }
}

export async function renameFile(id: string, name: string): Promise<void> {
    const file = await database.file.findUnique({ where: { id } });
    if (!file || !file.storagePath) throw new Error("File does not exist.");
    const nextPath = `${file.storagePath.slice(0, file.storagePath.lastIndexOf("/") + 1)}${name}`;
    await moveFile(file.storagePath, nextPath);
    await database.file.update({ where: { id }, data: { name, storagePath: nextPath, updated: new Date().toISOString() } });
}

export async function updateFileActive(id: string, active: boolean): Promise<void> {
    await ensureRuntimeSchema();
    if (active && await database.documentJob.count({ where: { fileId: id, status: { not: "completed" } } })) throw new Error("색인이 완료된 뒤 검색에 포함할 수 있습니다.");
    await database.file.update({ where: { id }, data: { active, updated: new Date().toISOString() } });
}

export async function replaceFileContent(id: string, file: { originalname: string; mimetype: string; buffer: Buffer }): Promise<WorkspaceFile> {
    const startedAt = Date.now();
    console.info(`[replace] ${id} started`, { sizeBytes: file.buffer.byteLength });
    try {
        if (await database.documentJob.count({ where: { fileId: id, status: { in: ["queued", "processing"] } } })) throw new Error("색인이 완료된 뒤 파일을 교체할 수 있습니다.");
        const current = await database.file.findUnique({ where: { id } });
        if (!current?.storagePath) throw new Error("File does not exist.");
        const extension = file.originalname.split(".").pop()?.toLowerCase();
        if (!extension || !new Set(["txt", "md", "csv", "json", "pdf", "pptx", "xlsx"]).has(extension)) throw new Error("지원되는 파일 형식은 TXT, MD, CSV, JSON, PDF, PPTX, XLSX입니다.");
        const extractedText = await extractDocumentText(file.buffer, file.originalname, file.mimetype);
        console.info(`[replace] ${id} extracted ${extractedText.text.length} characters in ${Date.now() - startedAt}ms`);
        await uploadFile(current.storagePath, file.buffer, file.mimetype);
        console.info(`[replace] ${id} stored original in ${Date.now() - startedAt}ms`);
        const sizeDifference = file.buffer.byteLength - Number(current.sizeBytes);
        await database.file.update({ where: { id }, data: { type: extension.toUpperCase(), updated: new Date().toISOString(), sizeBytes: file.buffer.byteLength } });
        if (sizeDifference) {
            await database.storageUsage.upsert({ where: { id: 1 }, create: { id: 1, usedBytes: file.buffer.byteLength, totalBytes: 0 }, update: { usedBytes: { increment: sizeDifference } } });
        }
        await indexFile(id, current.folderId, extractedText);
        console.info(`[replace] ${id} completed in ${Date.now() - startedAt}ms`);
        return fileView(await database.file.findUniqueOrThrow({ where: { id } }));
    } catch (error) {
        console.error(`[replace] ${id} failed after ${Date.now() - startedAt}ms`, error);
        throw error;
    }
}

export async function reindexFile(id: string): Promise<void> {
    const file = await database.file.findUnique({ where: { id } });
    if (!file?.storagePath) throw new Error("File does not exist.");
    const content = await downloadFile(file.storagePath);
    const document = await extractDocumentText(content, file.name, "");
    await indexFile(file.id, file.folderId, document);
    await database.file.update({ where: { id }, data: { updated: new Date().toISOString() } });
}

export async function removeFile(id: string): Promise<void> {
    const file = await database.file.findUnique({ where: { id } });
    if (!file) throw new Error("File does not exist.");
    const videoJob = await database.videoJob.findUnique({ where: { fileId: id } });
    const documentJob = await database.documentJob.findUnique({ where: { fileId: id } });
    if (videoJob && ["queued", "processing"].includes(videoJob.status)) throw new Error("영상 색인이 완료된 후 삭제할 수 있습니다.");
    if (documentJob && ["queued", "processing"].includes(documentJob.status)) throw new Error("문서 색인이 완료된 후 삭제할 수 있습니다.");
    if (file.storagePath) await deleteFile(file.storagePath);
    if (videoJob) await database.videoJob.delete({ where: { id: videoJob.id } });
    if (documentJob) await database.documentJob.delete({ where: { id: documentJob.id } });
    await database.file.delete({ where: { id } });
    await database.storageUsage.updateMany({ where: { id: 1 }, data: { usedBytes: { decrement: file.sizeBytes } } });
}

export async function getFileContent(id: string): Promise<{ name: string; type: string; content: Buffer }> {
    const file = await database.file.findUnique({ where: { id } });
    if (!file?.storagePath) throw new Error("File does not exist.");
    return { name: file.name, type: file.type, content: await downloadFile(file.storagePath) };
}

async function targetFolder(folderId: string) {
    const folder = await database.folder.findUnique({ where: { id: folderId } });
    if (!folder) throw new Error("Target folder does not exist.");
    return folder;
}

export async function moveFileToFolder(id: string, targetFolderId: string): Promise<void> {
    const [file, folder] = await Promise.all([database.file.findUnique({ where: { id } }), targetFolder(targetFolderId)]);
    if (!file?.storagePath) throw new Error("File does not exist.");
    if (await database.documentJob.count({ where: { fileId: id, status: { in: ["queued", "processing"] } } })) throw new Error("색인이 완료된 뒤 파일을 이동할 수 있습니다.");
    if (await database.file.findUnique({ where: { folderId_name: { folderId: folder.id, name: file.name } } })) throw new Error("A file with this name already exists in the target folder.");
    const nextPath = `${storageFolderPath(folder.path)}${file.name}`;
    await moveFile(file.storagePath, nextPath);
    await database.$transaction([
        database.file.update({ where: { id }, data: { folderId: folder.id, storagePath: nextPath } }),
        database.documentChunk.updateMany({ where: { fileId: id }, data: { folderId: folder.id } }),
        database.videoJob.updateMany({ where: { fileId: id }, data: { folderId: folder.id } }),
        database.documentJob.updateMany({ where: { fileId: id }, data: { folderId: folder.id } }),
    ]);
}

export async function copyFileToFolder(id: string, targetFolderId: string): Promise<void> {
    const [file, folder] = await Promise.all([database.file.findUnique({ where: { id } }), targetFolder(targetFolderId)]);
    if (!file?.storagePath) throw new Error("File does not exist.");
    if (["MP4", "MOV", "WEBM"].includes(file.type)) throw new Error("영상 복사는 아직 지원하지 않습니다. 원본 영상을 새 폴더에 업로드해 주세요.");
    if (await database.documentJob.count({ where: { fileId: id } })) throw new Error("색인된 문서 복사는 아직 지원하지 않습니다. 원본 문서를 새 폴더에 업로드해 주세요.");
    const nextPath = `${storageFolderPath(folder.path)}${file.name}`;
    await copyFile(file.storagePath, nextPath);
    await database.file.create({ data: { id: randomUUID(), folderId: folder.id, name: file.name, type: file.type, updated: new Date().toISOString(), owner: file.owner, active: file.active, sizeBytes: file.sizeBytes, storagePath: nextPath } });
    await database.storageUsage.upsert({ where: { id: 1 }, create: { id: 1, usedBytes: file.sizeBytes, totalBytes: 0 }, update: { usedBytes: { increment: file.sizeBytes } } });
}

export async function copyFolder(id: string, targetParentId?: string): Promise<void> {
    const source = await database.folder.findUnique({ where: { id } });
    if (!source) throw new Error("Folder does not exist.");
    const parent = targetParentId ? await targetFolder(targetParentId) : null;
    const newRootPath = `${parent ? `${parent.path}/` : ""}${source.name} copy`;
    const descendants = await database.folder.findMany({ where: { OR: [{ path: source.path }, { path: { startsWith: `${source.path}/` } }] }, orderBy: { path: "asc" } });
    if (await database.documentJob.count({ where: { folderId: { in: descendants.map((folder) => folder.id) } } })) throw new Error("색인 작업이 있는 폴더는 복사할 수 없습니다. 문서를 새 폴더에 업로드해 주세요.");
    if (await database.file.count({ where: { folderId: { in: descendants.map((folder) => folder.id) }, type: { in: ["MP4", "MOV", "WEBM"] } } })) throw new Error("영상이 포함된 폴더는 복사할 수 없습니다. 영상을 새 폴더에 업로드해 주세요.");
    const idMap = new Map<string, string>();
    await copyFolderPrefix(source.path, newRootPath);
    try {
        for (const folder of descendants) idMap.set(folder.id, randomUUID());
        for (const folder of descendants) {
            const relative = folder.path === source.path ? "" : folder.path.slice(source.path.length + 1);
            await database.folder.create({ data: { id: idMap.get(folder.id)!, name: folder.name, parentId: folder.parentId ? idMap.get(folder.parentId) : targetParentId ?? null, path: relative ? `${newRootPath}/${relative}` : newRootPath } });
        }
        const files = await database.file.findMany({ where: { folderId: { in: descendants.map((folder) => folder.id) } } });
        for (const file of files) {
            await database.file.create({ data: { id: randomUUID(), folderId: idMap.get(file.folderId)!, name: file.name, type: file.type, updated: new Date().toISOString(), owner: file.owner, active: file.active, sizeBytes: file.sizeBytes, storagePath: file.storagePath?.replace(storageFolderPath(source.path), storageFolderPath(newRootPath)) } });
        }
    } catch (error) {
        await deleteFolderPrefix(newRootPath);
        throw error;
    }
}
