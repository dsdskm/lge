import React from "react";
import { Alert, App as AntApp, Button, Card, Col, Row, Space, Spin, Statistic, Table, Tag, Typography, Input } from "antd";
import type { TableColumnsType } from "antd";

import { responseError } from "./progress";

type AdminAccount = { id: string; displayName: string; email: string; role: string; status: string };
type AdminData = { prompt: { key: string; content: string } | null; accounts: AdminAccount[]; stats: { folderCount: number; fileCount: number; chunkCount: number; usedBytes: number; totalBytes: number } };

const { Text, Title } = Typography;
const { TextArea } = Input;
const accountColumns: TableColumnsType<AdminAccount> = [
    { title: "Name", dataIndex: "displayName" },
    { title: "Email", dataIndex: "email" },
    { title: "Role", dataIndex: "role", width: 100, render: (role) => <Tag color="blue">{role}</Tag> },
    { title: "Status", dataIndex: "status", width: 100 },
];

export function AdminPanel({ formatBytes }: { formatBytes: (bytes: number) => string }) {
    const { message } = AntApp.useApp();
    const [adminData, setAdminData] = React.useState<AdminData>();
    const [error, setError] = React.useState<string>();
    const [promptDraft, setPromptDraft] = React.useState("");
    const [promptSaving, setPromptSaving] = React.useState(false);

    React.useEffect(() => {
        fetch("/api/admin").then(async (response) => {
            if (!response.ok) throw await responseError(response, "Admin data is unavailable.");
            return response.json() as Promise<AdminData>;
        }).then((data) => {
            setAdminData(data);
            setPromptDraft(data.prompt?.content ?? "");
        }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Admin data is unavailable."));
    }, []);

    async function savePrompt() {
        setPromptSaving(true);
        try {
            const response = await fetch("/api/admin/prompt", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: promptDraft }) });
            if (!response.ok) throw await responseError(response, "Prompt save failed.");
            const prompt = await response.json();
            setAdminData((current) => current ? { ...current, prompt } : current);
            message.success("Prompt saved");
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : "Prompt save failed.");
        } finally {
            setPromptSaving(false);
        }
    }

    if (error) return <Alert type="error" showIcon title="Admin data unavailable" description={error} />;
    if (!adminData) return <div className="center-state"><Spin size="large" description="Loading administration..." /></div>;
    const stats = adminData.stats;
    return <Card className="screen-card">
        <Title level={3}>Workspace administration</Title>
        <Text type="secondary">RAG 기본 프롬프트와 접근 계정을 관리합니다.</Text>
        <Row gutter={[12, 12]} className="admin-metrics">
            <Col xs={12} md={6}><Card><Statistic title="Folders" value={stats.folderCount} /></Card></Col>
            <Col xs={12} md={6}><Card><Statistic title="Files" value={stats.fileCount} /></Card></Col>
            <Col xs={12} md={6}><Card><Statistic title="Chunks" value={stats.chunkCount} /></Card></Col>
            <Col xs={12} md={6}><Card><Statistic title="Storage" value={formatBytes(stats.usedBytes)} /></Card></Col>
        </Row>
        <Card title="Default RAG prompt"><Space direction="vertical" size="middle" className="full-width"><TextArea value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} autoSize={{ minRows: 5, maxRows: 10 }} /><Button type="primary" loading={promptSaving} onClick={savePrompt}>Save prompt</Button></Space></Card>
        <Card title="Authorized accounts"><Table rowKey="id" columns={accountColumns} dataSource={adminData.accounts} pagination={false} size="small" /></Card>
    </Card>;
}