import React from "react";
import { DeleteOutlined, DownloadOutlined, EditOutlined, FileOutlined, FolderOutlined, PlusOutlined, ReloadOutlined, SwapOutlined } from "@ant-design/icons";
import { Alert, App as AntApp, Form, Input, Layout, Modal, Spin, Typography } from "antd";
import type { MenuProps } from "antd";

import { responseError } from "../progress";
import { FileList } from "./FileList";
import { FolderSidebar } from "../folders/FolderSidebar";
import { compareFolderNames } from "../folders/folder-order";
import { createFolderActions } from "../folders/folderActions";
import type { DialogState, TransferRequest, VideoJob, WorkspaceData, WorkspaceFile } from "./types";

const { Content } = Layout;
const { Paragraph, Text, Title } = Typography;

export function FilesWorkspace() {
    const { message } = AntApp.useApp();
    const [workspace, setWorkspace] = React.useState<WorkspaceData>();
    const [error, setError] = React.useState<string>();
    const [selectedFolderId, setSelectedFolderId] = React.useState<string>();
    const [folderFiles, setFolderFiles] = React.useState<WorkspaceFile[]>([]);
    const [videoJobs, setVideoJobs] = React.useState<VideoJob[]>([]);
    const syncedJobs = React.useRef(new Set<string>());
    const [transferRequest, setTransferRequest] = React.useState<TransferRequest>();
    const [transferTargetId, setTransferTargetId] = React.useState<string>();
    const [isUploading, setIsUploading] = React.useState(false);
    const [uploadElapsedSeconds, setUploadElapsedSeconds] = React.useState(0);
    const [dialog, setDialog] = React.useState<DialogState>();
    const [dialogValue, setDialogValue] = React.useState("");
    const [backendLoadingCount, setBackendLoadingCount] = React.useState(0);
    const [backendLoadingMessage, setBackendLoadingMessage] = React.useState("요청을 처리하는 중입니다.");

    React.useEffect(() => {
        fetch("/api/workspace").then(async (response) => {
            if (!response.ok) throw await responseError(response, "Workspace data is unavailable.");
            return response.json() as Promise<WorkspaceData>;
        }).then((data) => {
            setWorkspace(data);
            setSelectedFolderId(data.folders[0]?.id);
            setFolderFiles(data.files.filter((file) => file.folderId === data.folders[0]?.id));
        }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Workspace data is unavailable."));
    }, []);

    React.useEffect(() => {
        if (!isUploading) return;
        const startedAt = Date.now();
        setUploadElapsedSeconds(0);
        const timer = window.setInterval(() => setUploadElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
        return () => window.clearInterval(timer);
    }, [isUploading]);

    React.useEffect(() => {
        if (!selectedFolderId) return;
        let active = true;
        const refreshJobs = async () => {
            try {
                const response = await fetch(`/api/folders/${selectedFolderId}/video-jobs`);
                if (!response.ok) throw await responseError(response, "Video jobs could not be loaded.");
                const jobs = await response.json() as VideoJob[];
                if (!active) return;
                setVideoJobs(jobs);
                if (jobs.some((job) => job.status === "completed" && !syncedJobs.current.has(job.id))) {
                    for (const job of jobs) if (job.status === "completed") syncedJobs.current.add(job.id);
                    const workspaceResponse = await fetch("/api/workspace");
                    if (workspaceResponse.ok && active) {
                        const data = await workspaceResponse.json() as WorkspaceData;
                        setWorkspace(data);
                        setFolderFiles(data.files.filter((file) => file.folderId === selectedFolderId));
                    }
                }
            } catch (reason) {
                if (active) console.error("[video] status refresh failed", reason);
            }
        };
        void refreshJobs();
        const timer = window.setInterval(() => void refreshJobs(), 3000);
        return () => { active = false; window.clearInterval(timer); };
    }, [selectedFolderId]);

    async function backendFetch(input: RequestInfo | URL, init?: RequestInit, loadingMessage = "요청을 처리하는 중입니다."): Promise<Response> {
        setBackendLoadingMessage(loadingMessage);
        setBackendLoadingCount((current) => current + 1);
        try {
            return await fetch(input, init);
        } finally {
            setBackendLoadingCount((current) => Math.max(0, current - 1));
        }
    }

    async function refreshWorkspace() {
        const response = await backendFetch("/api/workspace", undefined, "워크스페이스를 새로고침하는 중입니다.");
        if (!response.ok) throw await responseError(response, "Workspace refresh failed.");
        const data = await response.json() as WorkspaceData;
        setWorkspace(data);
        setSelectedFolderId((current) => data.folders.some((folder) => folder.id === current) ? current : data.folders[0]?.id);
        const currentFolderId = data.folders.some((folder) => folder.id === selectedFolderId) ? selectedFolderId : data.folders[0]?.id;
        if (currentFolderId) {
            const filesResponse = await backendFetch(`/api/folders/${currentFolderId}/files`, undefined, "파일 목록을 불러오는 중입니다.");
            if (filesResponse.ok) setFolderFiles(await filesResponse.json() as WorkspaceFile[]);
        }
    }

    async function selectFolder(folderId: string) {
        setSelectedFolderId(folderId);
        const response = await fetch(`/api/folders/${folderId}/files`);
        if (!response.ok) throw await responseError(response, "Folder files could not be loaded.");
        setFolderFiles(await response.json() as WorkspaceFile[]);
    }

    function openInputDialog(options: Omit<DialogState, "kind" | "resolve">): Promise<string | undefined> {
        setDialogValue(options.defaultValue ?? "");
        return new Promise((resolve) => setDialog({ ...options, kind: "input", resolve: (value) => resolve(typeof value === "string" ? value : undefined) }));
    }

    function openConfirmDialog(options: Omit<DialogState, "kind" | "resolve">): Promise<boolean> {
        setDialogValue("");
        return new Promise((resolve) => setDialog({ ...options, kind: "confirm", resolve: (value) => resolve(value === true) }));
    }

    function closeDialog(value?: string | boolean) {
        dialog?.resolve(value);
        setDialog(undefined);
        setDialogValue("");
    }

    const { addFolder, folderActions } = createFolderActions({
        backendFetch, refreshWorkspace, openInputDialog, openConfirmDialog,
        onTransfer: (id, operation) => { setTransferTargetId(undefined); setTransferRequest({ kind: "folder", id, operation }); },
    });

    async function uploadSelectedFile(file: File) {
        if (file.size > 200 * 1024 * 1024) { message.error("200MB 이하의 파일만 업로드할 수 있습니다."); return; }
        const folder = workspace?.folders.find((item) => item.id === selectedFolderId) ?? workspace?.folders[0];
        if (!folder) return;
        const startedAt = Date.now();
        console.info("[upload] started", { fileName: file.name, sizeBytes: file.size, folderId: folder.id });
        setIsUploading(true);
        setBackendLoadingMessage("파일을 서버로 전송하고 있습니다.");
        try {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch(`/api/folders/${folder.id}/files`, { method: "POST", body: formData });
            if (!response.ok) throw await responseError(response, "File upload failed.");
            const { jobId } = await response.json() as { jobId: string };
            console.info("[upload] queued", { jobId, elapsedMs: Date.now() - startedAt });
            setBackendLoadingMessage("파일을 목록에 반영하고 있습니다.");
            await refreshWorkspace();
            console.info("[upload] workspace refreshed", { elapsedMs: Date.now() - startedAt });
            message.success("파일이 저장됐습니다. 색인이 완료되면 검색할 수 있습니다.");
        } catch (reason) {
            console.error("[upload] failed", { elapsedMs: Date.now() - startedAt, error: reason });
            message.error(reason instanceof Error ? reason.message : "File upload failed.");
        } finally {
            setIsUploading(false);
        }
    }

    async function replaceFile(file: WorkspaceFile, replacement: File) {
        const startedAt = Date.now();
        console.info("[upload] replacement started", { fileId: file.id, sizeBytes: replacement.size });
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", replacement);
            const response = await backendFetch(`/api/files/${file.id}/content`, { method: "PUT", body: formData }, "파일을 교체하고 청크를 재계산하는 중입니다.");
            if (!response.ok) throw await responseError(response, "File replacement failed.");
            console.info("[upload] replacement processed", { elapsedMs: Date.now() - startedAt });
            await refreshWorkspace();
            console.info("[upload] replacement workspace refreshed", { elapsedMs: Date.now() - startedAt });
            message.success("File replaced and re-indexed");
        } catch (reason) {
            console.error("[upload] replacement failed", { elapsedMs: Date.now() - startedAt, error: reason });
            message.error(reason instanceof Error ? reason.message : "File replacement failed.");
        } finally {
            setIsUploading(false);
        }
    }

    function chooseReplacement(file: WorkspaceFile) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".txt,.md,.csv,.json,.pdf,.pptx,.xlsx,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        input.onchange = () => {
            const replacement = input.files?.[0];
            if (replacement) void replaceFile(file, replacement);
        };
        input.click();
    }

    async function updateFileActive(file: WorkspaceFile, active: boolean) {
        const previousFiles = folderFiles;
        setFolderFiles((current) => current.map((item) => item.id === file.id ? { ...item, active } : item));
        const response = await backendFetch(`/api/files/${file.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) }, active ? "파일을 RAG 검색에 포함하는 중입니다." : "파일을 RAG 검색에서 제외하는 중입니다.");
        if (!response.ok) {
            setFolderFiles(previousFiles);
            throw await responseError(response, "File active update failed.");
        }
        await refreshWorkspace();
    }

    async function renameFile(file: WorkspaceFile) {
        const name = await openInputDialog({ title: "Rename file", label: "File name", defaultValue: file.name, confirmText: "Rename" });
        if (!name?.trim()) return;
        const response = await backendFetch(`/api/files/${file.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }, "파일 이름을 변경하는 중입니다.");
        if (!response.ok) throw await responseError(response, "File rename failed.");
        await refreshWorkspace();
    }

    async function reindexFile(file: WorkspaceFile) {
        const response = await backendFetch(`/api/files/${file.id}/reindex`, { method: "POST" }, "파일을 다시 분석하고 색인하는 중입니다.");
        if (!response.ok) throw await responseError(response, "File reindex failed.");
        if (response.status === 202) { message.success("영상 색인을 다시 시작했습니다."); return; }
        await refreshWorkspace();
        message.success("File re-indexed");
    }

    async function deleteFile(file: WorkspaceFile) {
        if (!await openConfirmDialog({ title: "Delete file", message: `Delete ${file.name}?`, confirmText: "Delete", danger: true })) return;
        const response = await backendFetch(`/api/files/${file.id}`, { method: "DELETE" }, "파일을 삭제하는 중입니다.");
        if (!response.ok) throw await responseError(response, "File deletion failed.");
        await refreshWorkspace();
    }

    async function confirmTransfer() {
        if (!transferRequest || !transferTargetId) return;
        let response: Response;
        if (transferRequest.kind === "folder") {
            response = transferRequest.operation === "copy"
                ? await backendFetch(`/api/folders/${transferRequest.id}/copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetParentId: transferTargetId }) }, "폴더를 복사하는 중입니다.")
                : await backendFetch(`/api/folders/${transferRequest.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: workspace?.folders.find((folder) => folder.id === transferRequest.id)?.name, parentId: transferTargetId }) }, "폴더를 이동하는 중입니다.");
        } else {
            response = await backendFetch(`/api/files/${transferRequest.id}/transfer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetFolderId: transferTargetId, copy: transferRequest.operation === "copy" }) }, transferRequest.operation === "copy" ? "파일을 복사하는 중입니다." : "파일을 이동하는 중입니다.");
        }
        if (!response.ok) throw await responseError(response, `${transferRequest.operation} failed.`);
        setTransferRequest(undefined);
        setTransferTargetId(undefined);
        await refreshWorkspace();
    }

    if (error) return <main className="center-state"><Alert type="error" showIcon title="Workspace unavailable" description={error} /></main>;
    if (!workspace) return <main className="center-state"><Spin size="large" description="Loading workspace..." /></main>;

    const selectedFolder = workspace.folders.find((folder) => folder.id === selectedFolderId) ?? workspace.folders.find((folder) => !folder.parentId) ?? workspace.folders[0];
    const visibleSubfolders = workspace.folders.filter((folder) => folder.parentId === selectedFolder?.id).sort(compareFolderNames);

    function fileActions(file: WorkspaceFile): MenuProps["items"] {
        const job = videoJobs.find((item) => item.fileId === file.id);
        const isVideo = /\.(mp4|mov|webm)$/i.test(file.name);
        const indexing = job && ["queued", "processing"].includes(job.status);
        return [
            { key: "preview", label: "Preview", icon: <FileOutlined />, onClick: () => window.open(`/api/files/${file.id}/content`, "_blank", "noopener,noreferrer") },
            { key: "download", label: "Download", icon: <DownloadOutlined />, onClick: () => window.open(`/api/files/${file.id}/content?download=1`, "_blank", "noopener,noreferrer") },
            ...(!isVideo ? [{ key: "replace", label: "Replace file", icon: <PlusOutlined />, disabled: Boolean(indexing), onClick: () => chooseReplacement(file) }] : []),
            ...(!isVideo || job?.status === "failed" ? [{ key: "reindex", label: job?.status === "failed" ? "Retry indexing" : "Re-index for RAG", icon: <ReloadOutlined />, disabled: Boolean(indexing), onClick: () => void reindexFile(file) }] : []),
            { key: "active", label: file.active ? "Deactivate for RAG" : "Activate for RAG", icon: <EditOutlined />, disabled: Boolean(job && job.status !== "completed"), onClick: () => void updateFileActive(file, !file.active) },
            { key: "copy", label: "Copy", icon: <SwapOutlined />, disabled: isVideo || Boolean(job), onClick: () => { setTransferTargetId(undefined); setTransferRequest({ kind: "file", id: file.id, operation: "copy" }); } },
            { key: "move", label: "Move", icon: <SwapOutlined />, disabled: Boolean(indexing), onClick: () => { setTransferTargetId(undefined); setTransferRequest({ kind: "file", id: file.id, operation: "move" }); } },
            { key: "rename", label: "Rename", icon: <EditOutlined />, onClick: () => void renameFile(file) },
            { type: "divider" },
            { key: "delete", label: "Delete", icon: <DeleteOutlined />, danger: true, disabled: Boolean(indexing), onClick: () => void deleteFile(file) },
        ];
    }

    return <>
        <Layout className="workspace-layout">
            <FolderSidebar workspace={workspace} selectedFolder={selectedFolder} onAdd={() => void addFolder()} onSelect={(id) => void selectFolder(id)} actions={folderActions} />
            <Content><FileList folder={selectedFolder} subfolders={visibleSubfolders} files={folderFiles} videoJobs={videoJobs} onSelectFolder={(id) => void selectFolder(id)} onUpload={(file) => void uploadSelectedFile(file)} actions={fileActions} /></Content>
        </Layout>
        <Modal open={backendLoadingCount > 0 || isUploading} footer={null} closable={false} centered mask={{ closable: false }}><div className="loading-panel"><Spin size="large" /><Title level={5}>처리 중입니다</Title><Text type="secondary">{backendLoadingMessage}</Text>{isUploading && <Text type="secondary">경과 시간: {Math.floor(uploadElapsedSeconds / 60)}분 {uploadElapsedSeconds % 60}초</Text>}</div></Modal>
        <Modal open={!!dialog} title={dialog?.title} okText={dialog?.confirmText ?? "OK"} okButtonProps={{ danger: dialog?.danger, disabled: dialog?.kind === "input" && !dialogValue.trim() }} onOk={() => closeDialog(dialog?.kind === "input" ? dialogValue : true)} onCancel={() => closeDialog(dialog?.kind === "confirm" ? false : undefined)} destroyOnHidden>
            {dialog?.message && <Paragraph>{dialog.message}</Paragraph>}
            {dialog?.kind === "input" && <Form layout="vertical"><Form.Item label={dialog.label ?? "Name"}><Input autoFocus value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} onPressEnter={(event) => { if (!event.nativeEvent.isComposing && dialogValue.trim()) closeDialog(dialogValue); }} /></Form.Item></Form>}
        </Modal>
        <Modal open={!!transferRequest} title={transferRequest?.operation === "copy" ? "Copy to folder" : "Move to folder"} okText={transferRequest?.operation === "copy" ? "Copy here" : "Move here"} okButtonProps={{ disabled: !transferTargetId }} onOk={() => void confirmTransfer()} onCancel={() => setTransferRequest(undefined)} destroyOnHidden>
            <div className="transfer-list">{workspace.folders.filter((folder) => folder.id !== transferRequest?.id).map((folder) => <button type="button" className={`transfer-row ${transferTargetId === folder.id ? "selected" : ""}`} key={folder.id} onClick={() => setTransferTargetId(folder.id)}><FolderOutlined /><span><Text strong>{folder.name}</Text><Text type="secondary">{folder.parentId ? "Subfolder" : "Root folder"}</Text></span></button>)}</div>
        </Modal>
    </>;
}