import { DeleteOutlined, EditOutlined, FolderAddOutlined, SwapOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";

import { responseError } from "../progress";
import type { DialogState, WorkspaceFolder } from "../files/types";

export function createFolderActions({ backendFetch, refreshWorkspace, openInputDialog, openConfirmDialog, onTransfer }: {
    backendFetch: (input: RequestInfo | URL, init?: RequestInit, loadingMessage?: string) => Promise<Response>;
    refreshWorkspace: () => Promise<void>;
    openInputDialog: (options: Omit<DialogState, "kind" | "resolve">) => Promise<string | undefined>;
    openConfirmDialog: (options: Omit<DialogState, "kind" | "resolve">) => Promise<boolean>;
    onTransfer: (id: string, operation: "copy" | "move") => void;
}) {
    async function addFolder() {
        const name = await openInputDialog({ title: "Create root folder", label: "Folder name", confirmText: "Create" });
        if (!name?.trim()) return;
        const response = await backendFetch("/api/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }, "루트 폴더를 만드는 중입니다.");
        if (!response.ok) throw await responseError(response, "Folder creation failed.");
        await refreshWorkspace();
    }

    async function addChildFolder(folder: WorkspaceFolder) {
        const name = await openInputDialog({ title: "Create subfolder", message: `Inside ${folder.name}`, label: "Folder name", confirmText: "Create" });
        if (!name?.trim()) return;
        const response = await backendFetch("/api/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parentId: folder.id }) }, "하위 폴더를 만드는 중입니다.");
        if (!response.ok) throw await responseError(response, "Subfolder creation failed.");
        await refreshWorkspace();
    }

    async function renameFolder(folder: WorkspaceFolder) {
        const name = await openInputDialog({ title: "Rename folder", label: "Folder name", defaultValue: folder.name, confirmText: "Rename" });
        if (!name?.trim()) return;
        const response = await backendFetch(`/api/folders/${folder.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }, "폴더 이름을 변경하는 중입니다.");
        if (!response.ok) throw await responseError(response, "Folder rename failed.");
        await refreshWorkspace();
    }

    async function deleteFolder(folder: WorkspaceFolder) {
        if (!await openConfirmDialog({ title: "Delete folder", message: `Delete ${folder.name} and its stored files?`, confirmText: "Delete", danger: true })) return;
        const response = await backendFetch(`/api/folders/${folder.id}`, { method: "DELETE" }, "폴더를 삭제하는 중입니다.");
        if (!response.ok) throw await responseError(response, "Folder deletion failed.");
        await refreshWorkspace();
    }

    function folderActions(folder: WorkspaceFolder): MenuProps["items"] {
        return [
            { key: "add", label: "Add subfolder", icon: <FolderAddOutlined />, onClick: () => void addChildFolder(folder) },
            { key: "copy", label: "Copy", icon: <SwapOutlined />, onClick: () => onTransfer(folder.id, "copy") },
            { key: "move", label: "Move", icon: <SwapOutlined />, onClick: () => onTransfer(folder.id, "move") },
            { key: "rename", label: "Rename", icon: <EditOutlined />, onClick: () => void renameFolder(folder) },
            { type: "divider" },
            { key: "delete", label: "Delete", icon: <DeleteOutlined />, danger: true, onClick: () => void deleteFolder(folder) },
        ];
    }

    return { addFolder, folderActions };
}