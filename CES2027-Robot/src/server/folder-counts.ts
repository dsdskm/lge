export function countFilesInSubtree(
    folders: Array<{ id: string; parentId: string | null }>,
    files: Array<{ folderId: string }>,
): Map<string, number> {
    const parentById = new Map(folders.map((folder) => [folder.id, folder.parentId]));
    const counts = new Map(folders.map((folder) => [folder.id, 0]));

    for (const file of files) {
        let folderId: string | null | undefined = file.folderId;
        const visited = new Set<string>();
        while (folderId && parentById.has(folderId) && !visited.has(folderId)) {
            counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
            visited.add(folderId);
            folderId = parentById.get(folderId);
        }
    }
    return counts;
}