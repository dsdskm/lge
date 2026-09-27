import React from "react";
import * as teamsJs from "@microsoft/teams-js";
import { App as AntApp, Avatar, ConfigProvider, Layout, Space, Typography, theme } from "antd";

import { AdminPanel } from "./AdminPanel";
import { ChatPanel } from "./ChatPanel";
import { HistoryPanel } from "./HistoryPanel";
import { FilesWorkspace } from "./files/FilesWorkspace";
import { formatBytes } from "./files/types";

import "antd/dist/reset.css";
import "./App.css";
import "./WorkspaceOverrides.css";

type AppTab = "files" | "chat" | "history" | "admin";
type Account = { displayName: string; email: string };

const { Header, Content } = Layout;
const { Text } = Typography;

function routeToTab(pathname: string): AppTab {
    if (pathname.endsWith("/admin")) return "admin";
    if (pathname.endsWith("/history")) return "history";
    if (pathname.endsWith("/chat")) return "chat";
    return "files";
}

function AppContent() {
    const activeTab = routeToTab(window.location.pathname);
    const [account, setAccount] = React.useState<Account>({ displayName: "Teams user", email: "" });

    React.useEffect(() => {
        teamsJs.app.initialize().then(() => teamsJs.app.getContext()).then((context) => {
            const user = context?.user;
            setAccount({ displayName: user?.displayName ?? "Teams user", email: user?.userPrincipalName ?? user?.id ?? "" });
        }).catch(() => undefined);
    }, []);

    return <Layout className="app-shell">
        <Header className="app-header"><div /><Space><div className="account-text"><Text strong>{account.displayName}</Text><Text type="secondary">{account.email}</Text></div><Avatar>{account.displayName.slice(0, 2).toUpperCase()}</Avatar></Space></Header>
        <Content className={`app-content ${activeTab === "chat" ? "chat-content" : ""} ${activeTab === "admin" ? "admin-content" : ""}`}>
            {activeTab === "admin" ? <AdminPanel formatBytes={formatBytes} /> : activeTab === "history" ? <HistoryPanel /> : activeTab === "chat" ? <ChatPanel /> : <FilesWorkspace />}
        </Content>
    </Layout>;
}

export default function App() {
    return <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: "#4f6f52", borderRadius: 6, fontFamily: "Avenir Next, Segoe UI, sans-serif" } }}><AntApp><AppContent /></AntApp></ConfigProvider>;
}