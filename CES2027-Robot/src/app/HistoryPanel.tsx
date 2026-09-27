import React from "react";
import { FolderOutlined } from "@ant-design/icons";
import { Alert, Button, Flex, Spin, Tag, Typography } from "antd";
import { responseError } from "./progress";
import { EvidenceImages } from "./EvidenceImages";

const { Paragraph, Text, Title } = Typography;

export type ChatSource = { fileId: string; fileName: string; chunkIndex: number; page?: number; slide?: number; startSeconds?: number; endSeconds?: number; previewAvailable?: boolean };
export type SearchProgress = {
    phase: "scope" | "matches";
    folders: Array<{ path: string; files: Array<{ name: string; selected?: boolean; chunks?: number }> }>;
    candidates?: Array<{ fileId: string; file: string; chunk: number; selected: boolean; vectorSimilarity: number; keywordMatches: number; folderMatches: number; titleMatches: number; headerMatches: number; score: number; selectionReason: string }>;
    topSimilar?: Array<{ fileId: string; file: string; chunk: number; similarity: number; preview?: string }>;
    relatedFiles?: Array<{ name: string; active: boolean; chunkCount: number; reason: string }>;
    reason?: string;
};
export type ChatHistoryEntry = { id: string; at: string; question: string; answer?: string; error?: string; sources: ChatSource[]; steps: Array<{ elapsedMs: number; message: string; search?: SearchProgress }> };

export function HistoryPanel() {
    const [entries, setEntries] = React.useState<ChatHistoryEntry[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string>();

    React.useEffect(() => {
        fetch("/api/history").then(async (response) => {
            if (!response.ok) throw await responseError(response, "History could not be loaded.");
            return response.json() as Promise<ChatHistoryEntry[]>;
        }).then(setEntries).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
            .finally(() => setLoading(false));
    }, []);

    async function clearHistory() {
        try {
            const response = await fetch("/api/history", { method: "DELETE" });
            if (!response.ok) throw await responseError(response, "History could not be cleared.");
            setEntries([]);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        }
    }

    return <section className="history-panel">
        <Flex justify="space-between" align="center" wrap gap={12}>
            <div><Title level={3}>History</Title><Text type="secondary">저장된 최근 채팅 {entries.length}건</Text></div>
            <Button danger disabled={!entries.length} onClick={() => void clearHistory()}>Clear history</Button>
        </Flex>
        {error && <Alert type="error" showIcon title={error} />}
        {loading ? <Spin /> : !entries.length && <div className="history-empty"><Text type="secondary">아직 채팅 기록이 없습니다.</Text></div>}
        <div className="history-list">{entries.map((entry) => <details className="history-entry" key={entry.id}>
            <summary><span className="history-question">{entry.question}</span><Text type="secondary">{new Date(entry.at).toLocaleString()}</Text><Tag color={entry.error ? "error" : entry.sources.length ? "success" : "warning"}>{entry.error ? "실패" : entry.sources.length ? "답변" : "검색 결과 없음"}</Tag></summary>
            <div className="history-detail">
                {entry.answer && <section><Text strong>답변</Text><Paragraph>{entry.answer}</Paragraph><EvidenceImages sources={entry.sources} /></section>}
                {entry.error && <Alert type="error" showIcon title="요청 실패" description={entry.error} />}
                {!!entry.sources.length && <section><Text strong>답변 근거</Text><div className="history-tags">{entry.sources.map((source) => <Tag key={`${source.fileId}-${source.chunkIndex}`}>{source.fileName} {source.startSeconds !== undefined ? `${Math.floor(source.startSeconds / 60)}:${String(source.startSeconds % 60).padStart(2, "0")}` : `#${source.chunkIndex}`}</Tag>)}</div></section>}
                <section><Text strong>처리 로그</Text><ol className="history-steps">{entry.steps.map((step, index) => <li key={index}><Text type="secondary">{(step.elapsedMs / 1000).toFixed(1)}s</Text> {step.message}</li>)}</ol></section>
                {entry.steps.filter((step) => step.search).map((step, index) => <section key={index} className="history-search">
                    <Text strong>{step.search?.phase === "scope" ? "검색 범위" : "매칭 판단"}</Text>
                    {step.search?.folders.map((folder) => <div key={folder.path}><Text><FolderOutlined /> {folder.path}</Text><div className="history-tags">{folder.files.map((file) => <Tag key={file.name} color={file.selected ? "green" : undefined}>{file.name}{file.selected ? ` · ${file.chunks}개 선택` : ""}</Tag>)}</div></div>)}
                    {!step.search?.folders.length && <Text type="secondary">해당 단계에 표시할 파일이 없습니다.</Text>}
                    {step.search?.reason && <Alert type="warning" showIcon title={step.search.reason} />}
                    {!!step.search?.topSimilar?.length && <div><Text strong>벡터 유사도 상위 {step.search.topSimilar.length}개 (전체 활성 청크)</Text><ol className="history-steps">{step.search.topSimilar.map((candidate) => <li key={`${candidate.fileId}-${candidate.chunk}`}>{candidate.file} #{candidate.chunk} · 유사도 {candidate.similarity.toFixed(3)}{candidate.preview && <div><Text type="secondary">{candidate.preview}</Text></div>}</li>)}</ol></div>}
                    {!!step.search?.relatedFiles?.length && <div><Text strong>파일명 관련 문서</Text>{step.search.relatedFiles.map((file) => <div key={file.name}>{file.name} · {file.active ? "활성" : "비활성"} · {file.chunkCount}개 청크 · {file.reason}</div>)}</div>}
                    {!!step.search?.candidates?.length && <div className="history-table-wrap"><table className="history-table"><thead><tr><th>판정</th><th>파일 / 청크</th><th>벡터 유사도</th><th>본문</th><th>폴더명</th><th>파일명</th><th>인물 필드</th><th>합산 점수</th></tr></thead><tbody>{step.search.candidates.map((candidate) => <tr key={`${candidate.fileId}-${candidate.chunk}`}><td>{candidate.selected ? "선택" : candidate.selectionReason === "person field filter" ? "인물 조건 불일치" : "상위 순위 밖"}</td><td>{candidate.file} #{candidate.chunk}</td><td>{candidate.vectorSimilarity}</td><td>{candidate.keywordMatches}</td><td>{candidate.folderMatches ?? 0}</td><td>{candidate.titleMatches}</td><td>{candidate.headerMatches}</td><td>{candidate.score}</td></tr>)}</tbody></table></div>}
                </section>)}
            </div>
        </details>)}</div>
    </section>;
}