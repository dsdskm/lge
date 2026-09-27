import { FileOutlined, FolderOutlined, MoreOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Dropdown, Flex, Row, Space, Table, Tag, Typography, Upload } from "antd";
import type { MenuProps, TableColumnsType } from "antd";

import { formatBytes } from "./types";
import type { VideoJob, WorkspaceFile, WorkspaceFolder } from "./types";

const { Text, Title } = Typography;

export function FileList({ folder, subfolders, files, videoJobs, onSelectFolder, onUpload, actions }: {
    folder?: WorkspaceFolder;
    subfolders: WorkspaceFolder[];
    files: WorkspaceFile[];
    videoJobs: VideoJob[];
    onSelectFolder: (folderId: string) => void;
    onUpload: (file: File) => void;
    actions: (file: WorkspaceFile) => MenuProps["items"];
}) {
    const columns: TableColumnsType<WorkspaceFile> = [
        { title: "Name", dataIndex: "name", render: (_value, file) => <Button type="link" icon={<FileOutlined />} onClick={() => window.open(`/api/files/${file.id}/content`, "_blank", "noopener,noreferrer")}>{file.name}</Button> },
        {
            title: "Status", dataIndex: "active", width: 145, render: (active, file) => {
                const job = videoJobs.find((item) => item.fileId === file.id);
                return <Tag color={job?.status === "failed" ? "error" : job && job.status !== "completed" ? "processing" : active ? "success" : "default"}>{job?.status === "failed" ? "실패" : job?.status === "queued" ? "대기 중" : job?.status === "processing" ? "색인 중" : active ? "업로드 완료" : "비활성"}</Tag>;
            }
        },
        { title: "Chunks", dataIndex: "chunkCount", width: 82, align: "right" },
        { title: "Size", dataIndex: "sizeBytes", width: 110, render: (sizeBytes) => formatBytes(sizeBytes) },
        { title: "Uploader", dataIndex: "owner", width: 130 },
        { title: "Updated", dataIndex: "updated", width: 160 },
        { title: "", width: 56, render: (_value, file) => <Dropdown menu={{ items: actions(file) }} trigger={["click"]}><Button type="text" icon={<MoreOutlined />} /></Dropdown> },
    ];
    return <Card className="screen-card">
        <Flex justify="space-between" align="flex-start" gap={16} wrap>
            <div><Text type="secondary">Workspace /</Text><Title level={3}>{folder?.name ?? "No folder selected"}</Title><Text type="secondary">{files.length} files</Text></div>
            <Upload showUploadList={false} beforeUpload={(file) => { onUpload(file); return Upload.LIST_IGNORE; }} accept=".txt,.md,.csv,.json,.pdf,.pptx,.xlsx,.mp4,.mov,.webm">
                <Button type="primary" icon={<PlusOutlined />} disabled={!folder}>Upload files</Button>
            </Upload>
        </Flex>
        {videoJobs.filter((job) => job.status !== "completed").map((job) => <Alert key={job.id} type={job.status === "failed" ? "error" : "info"} showIcon title={`${files.find((file) => file.id === job.fileId)?.name ?? "파일"} · ${job.progress}`} description={job.error ?? (job.status === "queued" ? "색인을 기다리고 있습니다." : "검색용 청크를 준비하고 있습니다.")} />)}
        <Row gutter={[12, 12]}>{subfolders.map((subfolder) => <Col xs={24} sm={12} md={8} key={subfolder.id}><Card size="small" hoverable onClick={() => onSelectFolder(subfolder.id)}><Space><FolderOutlined /><Text strong>{subfolder.name}</Text><Tag>{subfolder.count} files</Tag></Space></Card></Col>)}</Row>
        <Title level={5} className="section-title">Files</Title>
        <Table rowKey="id" columns={columns} dataSource={files} pagination={false} size="middle" scroll={{ x: 720 }} />
    </Card>;
}