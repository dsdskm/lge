import React from "react";
import { FileOutlined, FolderOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Flex, Form, Input, Spin, Tag, Typography } from "antd";

import type { ChatSource, SearchProgress } from "./HistoryPanel";
import { fetchProgress } from "./progress";
import { EvidenceImages } from "./EvidenceImages";

const { Paragraph, Text, Title } = Typography;
const { TextArea } = Input;

type ChatMessage = { id: string; role: "user" | "assistant"; text: string; sources?: ChatSource[] };

function messageId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function ChatPanel() {
    const activeRequest = React.useRef<AbortController | null>(null);
    const [chatInput, setChatInput] = React.useState("");
    const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([
        { id: "welcome", role: "assistant", text: "질문을 보내면 관련 문서를 찾아 답변과 출처를 반환합니다." },
    ]);
    const [isChatSending, setIsChatSending] = React.useState(false);
    const [chatProgress, setChatProgress] = React.useState("");
    const [chatSearch, setChatSearch] = React.useState<SearchProgress>();
    const [chatError, setChatError] = React.useState<string>();

    React.useEffect(() => () => activeRequest.current?.abort(), []);

    function stopAnswer() {
        activeRequest.current?.abort();
        activeRequest.current = null;
        setIsChatSending(false);
        setChatMessages((current) => [...current, { id: messageId("assistant-stopped"), role: "assistant", text: "답변 생성을 중지했습니다." }]);
    }

    async function sendChatMessage(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const question = chatInput.trim();
        if (!question || activeRequest.current) return;
        const controller = new AbortController();
        activeRequest.current = controller;
        setChatMessages((current) => [...current, { id: messageId("user"), role: "user", text: question }]);
        setChatInput("");
        setChatError(undefined);
        setIsChatSending(true);
        setChatProgress("질문을 전송하고 있습니다.");
        setChatSearch(undefined);
        const startedAt = Date.now();
        console.info("[chat] question sent", { question });
        try {
            const body = await fetchProgress<{ answer: string; sources: ChatSource[] }>("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }), signal: controller.signal }, (stage, search) => {
                if (controller.signal.aborted) return;
                console.info("[chat] progress", { stage, search, elapsedMs: Date.now() - startedAt });
                setChatProgress(stage);
                if (search) setChatSearch(search);
            });
            if (controller.signal.aborted) return;
            console.info("[chat] answer received", { sources: body.sources, answerLength: body.answer.length, elapsedMs: Date.now() - startedAt });
            setChatMessages((current) => [...current, { id: messageId("assistant"), role: "assistant", text: body.answer, sources: body.sources }]);
        } catch (reason) {
            if (controller.signal.aborted) return;
            console.error("[chat] failed", { error: reason, elapsedMs: Date.now() - startedAt });
            const errorMessage = reason instanceof Error ? reason.message : "Chat response failed.";
            setChatError(errorMessage);
            setChatMessages((current) => [...current, { id: messageId("assistant-error"), role: "assistant", text: `응답을 가져오지 못했습니다. ${errorMessage}` }]);
        } finally {
            if (activeRequest.current === controller) {
                activeRequest.current = null;
                setIsChatSending(false);
            }
        }
    }

    function handleChatKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
    }

    return <Card className="screen-card chat-card">
        <Flex justify="space-between" align="flex-start" gap={16} wrap>
            <div><Text type="secondary">RAG Chat</Text><Title level={3}>Chat</Title><Text type="secondary">질문 내용에 맞는 문서를 자동으로 찾아 답변합니다.</Text></div>
            <Button onClick={() => setChatMessages([{ id: "welcome", role: "assistant", text: "새 대화를 시작합니다. 문서 기반으로 질문해 주세요." }])}>New chat</Button>
        </Flex>
        <div className="chat-messages" aria-live="polite">
            {chatMessages.map((item) => <article className={`chat-message ${item.role}`} key={item.id}><div className="message-bubble"><Paragraph>{item.text}</Paragraph>{!!item.sources?.length && <><EvidenceImages sources={item.sources} /><div className="source-list"><Text type="secondary">참조 파일</Text><Flex wrap gap={4}>{[...new Map(item.sources.map((source) => [source.fileId, source])).values()].map((source) => <Button key={source.fileId} type="link" size="small" icon={<FileOutlined />} onClick={() => window.open(`/api/files/${source.fileId}/content${source.startSeconds !== undefined ? `#t=${source.startSeconds}` : ""}`, "_blank", "noopener,noreferrer")}>{source.fileName}{source.startSeconds !== undefined ? ` · ${Math.floor(source.startSeconds / 60)}:${String(source.startSeconds % 60).padStart(2, "0")}` : ""}</Button>)}</Flex></div></>}</div></article>)}
            {isChatSending && <article className="chat-message assistant" aria-live="polite"><div className="message-bubble assistant-thinking"><Spin size="small" /><div><Text>{chatProgress}<span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span></Text>{chatSearch && <div className="chat-search-scope"><Text type="secondary">{chatSearch.phase === "scope" ? "검색 대상" : "매칭 후보"}</Text>{chatSearch.folders.length ? chatSearch.folders.map((folder) => <div className="chat-search-folder" key={folder.path}><Text strong><FolderOutlined /> {folder.path}</Text><div className="chat-search-files">{folder.files.map((file) => <Tag key={file.name} color={file.selected ? "green" : undefined} title={file.selected ? `근거 청크 ${file.chunks}개 선택` : chatSearch.phase === "matches" ? "후보에서 선택되지 않음" : "검색 대상 파일"}>{file.name}{file.selected ? ` (${file.chunks})` : ""}</Tag>)}</div></div>) : <Text type="secondary">{chatSearch.phase === "scope" ? "검색 가능한 활성 문서가 없습니다." : "매칭된 파일이 없습니다."}</Text>}</div>}</div></div></article>}
        </div>
        <Form className="chat-composer" onSubmitCapture={sendChatMessage}>
            {chatError && <Alert type="error" showIcon title={chatError} />}
            <TextArea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={handleChatKeyDown} placeholder="문서에 대해 질문하세요" autoSize={{ minRows: 3, maxRows: 6 }} />
            <Flex justify="space-between" align="center"><Text type="secondary">문서 전체에서 관련 내용을 검색합니다</Text><Flex gap={8}>{isChatSending && <Button type="default" htmlType="button" danger icon={<StopOutlined />} onClick={stopAnswer}>답변 중지</Button>}<Button type="primary" htmlType="submit" icon={<SendOutlined />} disabled={!chatInput.trim() || isChatSending}>Send</Button></Flex></Flex>
        </Form>
    </Card>;
}