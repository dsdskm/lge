import type { WorkspaceFolder } from "../files/types";

export function compareFolderNames(left: WorkspaceFolder, right: WorkspaceFolder): number {
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

export function orderFolderTree(folders: WorkspaceFolder[]): Array<{ folder: WorkspaceFolder; depth: number }> {
    const ids = new Set(folders.map((folder) => folder.id));
    const children = new Map<string | undefined, WorkspaceFolder[]>();
    for (const folder of folders) {
        const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : undefined;
        const siblings = children.get(parent) ?? [];
        siblings.push(folder);
        children.set(parent, siblings);
    }

    const ordered: Array<{ folder: WorkspaceFolder; depth: number }> = [];
    const visited = new Set<string>();
    function visit(folder: WorkspaceFolder, depth: number) {
        if (visited.has(folder.id)) return;
        visited.add(folder.id);
        ordered.push({ folder, depth });
        for (const child of (children.get(folder.id) ?? []).sort(compareFolderNames)) visit(child, depth + 1);
    }
    for (const root of (children.get(undefined) ?? []).sort(compareFolderNames)) visit(root, 0);
    for (const folder of folders.filter((item) => !visited.has(item.id)).sort(compareFolderNames)) visit(folder, 0);
    return ordered;
}