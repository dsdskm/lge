import { FolderOutlined, MoreOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Dropdown, Flex, Layout, Progress, Tag, Typography } from "antd";
import type { MenuProps } from "antd";

import { formatBytes } from "../files/types";
import type { WorkspaceData, WorkspaceFolder } from "../files/types";
import { orderFolderTree } from "./folder-order";

const { Sider } = Layout;
const { Text, Title } = Typography;

export function FolderSidebar({ workspace, selectedFolder, onAdd, onSelect, actions }: {
    workspace: WorkspaceData;
    selectedFolder?: WorkspaceFolder;
    onAdd: () => void;
    onSelect: (folderId: string) => void;
    actions: (folder: WorkspaceFolder) => MenuProps["items"];
}) {
    const hasStorageLimit = workspace.storage.totalBytes > 0;
    const usedPercent = hasStorageLimit ? Math.round(workspace.storage.usedBytes / workspace.storage.totalBytes * 100) : 0;
    return <Sider width={280} className="app-sider">
        <Flex justify="space-between" align="center" className="sider-head">
            <div><Text type="secondary">Workspace</Text><Title level={5}>Knowledge base</Title></div>
            <Button type="primary" icon={<PlusOutlined />} onClick={onAdd} />
        </Flex>
        <Card size="small" className="folder-card" styles={{ body: { padding: 6 } }}>
            <div className="folder-list">{orderFolderTree(workspace.folders).map(({ folder, depth }) => <div className={`folder-list-item ${selectedFolder?.id === folder.id ? "selected" : ""}`} key={folder.id}>
                <button type="button" className="folder-select" style={{ paddingLeft: 8 + depth * 16 }} onClick={() => onSelect(folder.id)}>
                    <FolderOutlined className="folder-icon" />
                    <span className="folder-name">{folder.name || folder.path || "Untitled folder"}</span>
                </button>
                <Tag className="folder-count">{folder.count}</Tag>
                <Dropdown menu={{ items: actions(folder) }} trigger={["click"]}><Button type="text" icon={<MoreOutlined />} /></Dropdown>
            </div>)}</div>
        </Card>
        <Card size="small" className="storage-card">
            <Flex justify="space-between"><Text strong>Storage</Text><Text>{hasStorageLimit ? `${usedPercent}%` : "Used"}</Text></Flex>
            {hasStorageLimit && <Progress percent={usedPercent} size="small" showInfo={false} />}
            <Text type="secondary">{hasStorageLimit ? `${formatBytes(workspace.storage.usedBytes)} of ${formatBytes(workspace.storage.totalBytes)}` : `${formatBytes(workspace.storage.usedBytes)} used in GCS bucket`}</Text>
        </Card>
    </Sider>;
}