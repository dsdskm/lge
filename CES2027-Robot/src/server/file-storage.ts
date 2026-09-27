import { Storage } from "@google-cloud/storage";
import type { Readable } from "node:stream";

import { config } from "./config";

const storage = new Storage({
    ...(config.gcpProjectId ? { projectId: config.gcpProjectId } : {}),
    ...(config.googleApplicationCredentials ? { keyFilename: config.googleApplicationCredentials } : {}),
});

function getBucket() {
    if (!config.gcsBucketName) {
        throw new Error("GCS_BUCKET_NAME is not configured.");
    }
    return storage.bucket(config.gcsBucketName);
}

export function storageFolderPath(folderPath: string): string {
    return `${folderPath.replace(/^\/+|\/+$/g, "")}/`;
}

export async function uploadFile(storagePath: string, content: Buffer, contentType: string): Promise<void> {
    await getBucket().file(storagePath).save(content, { contentType, resumable: false });
}

export async function uploadLocalFile(storagePath: string, localPath: string, contentType: string): Promise<void> {
    await getBucket().upload(localPath, { destination: storagePath, resumable: true, metadata: { contentType } });
}

export async function downloadToFile(storagePath: string, localPath: string): Promise<void> {
    await getBucket().file(storagePath).download({ destination: localPath });
}

export function storageUri(storagePath: string): string {
    return `gs://${getBucket().name}/${storagePath}`;
}

export function streamFile(storagePath: string, start?: number, end?: number): Readable {
    return getBucket().file(storagePath).createReadStream({ ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) });
}

export async function deleteFile(storagePath: string): Promise<void> {
    await getBucket().file(storagePath).delete({ ignoreNotFound: true });
}

export async function moveFile(fromPath: string, toPath: string): Promise<void> {
    await copyFile(fromPath, toPath);
    await getBucket().file(fromPath).delete({ ignoreNotFound: true });
}

export async function copyFile(fromPath: string, toPath: string): Promise<void> {
    await getBucket().file(fromPath).copy(getBucket().file(toPath));
}

export async function downloadFile(storagePath: string): Promise<Buffer> {
    const [content] = await getBucket().file(storagePath).download();
    return content;
}

export async function getFileSize(storagePath: string): Promise<number> {
    const [metadata] = await getBucket().file(storagePath).getMetadata();
    return Number(metadata.size ?? 0);
}

export async function getBucketStorageUsage(): Promise<number> {
    const [objects] = await getBucket().getFiles();
    return objects.reduce((total, object) => total + Number(object.metadata.size ?? 0), 0);
}

export async function createFolderPrefix(folderId: string): Promise<void> {
    await getBucket().file(`${storageFolderPath(folderId)}.keep`).save(Buffer.alloc(0), { resumable: false });
}

export async function deleteFolderPrefix(folderPath: string): Promise<void> {
    const [objects] = await getBucket().getFiles({ prefix: storageFolderPath(folderPath) });
    await Promise.all(objects.map((object) => object.delete({ ignoreNotFound: true })));
}

export async function moveFolderPrefix(fromPath: string, toPath: string): Promise<void> {
    await copyFolderPrefix(fromPath, toPath);
    await deleteFolderPrefix(fromPath);
}

export async function copyFolderPrefix(fromPath: string, toPath: string): Promise<void> {
    const [objects] = await getBucket().getFiles({ prefix: storageFolderPath(fromPath) });
    const sourcePrefix = storageFolderPath(fromPath);
    const destinationPrefix = storageFolderPath(toPath);
    await Promise.all(objects.map(async (object) => {
        const destination = `${destinationPrefix}${object.name.slice(sourcePrefix.length)}`;
        await object.copy(getBucket().file(destination));
    }));
}