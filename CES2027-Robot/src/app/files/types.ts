export type WorkspaceFolder = { id: string; name: string; parentId?: string; path?: string; count: number };
export type WorkspaceFile = { id: string; folderId: string; name: string; type: string; updated: string; owner: string; active: boolean; sizeBytes: number; chunkCount: number };
export type WorkspaceData = { folders: WorkspaceFolder[]; files: WorkspaceFile[]; storage: { usedBytes: number; totalBytes: number } };
export type VideoJob = { id: string; fileId: string; status: "queued" | "processing" | "completed" | "failed"; progress: string; error?: string | null };
export type TransferRequest = { kind: "folder" | "file"; id: string; operation: "copy" | "move" };
export type DialogState = { kind: "input" | "confirm"; title: string; message?: string; label?: string; defaultValue?: string; confirmText?: string; danger?: boolean; resolve: (value: string | boolean | undefined) => void };

export function formatBytes(bytes: number): string {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
}