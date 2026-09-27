import React from "react";
import { Typography } from "antd";

import type { ChatSource } from "./HistoryPanel";

const { Text } = Typography;

export function EvidenceImages({ sources }: { sources: ChatSource[] }) {
    const [failed, setFailed] = React.useState<string[]>([]);
    const previews = [...new Map(sources.filter((source) => source.previewAvailable && (source.page || source.slide))
        .map((source) => [`${source.fileId}:${source.page ?? source.slide}`, source])).values()].slice(0, 3);
    const visible = previews.filter((source) => !failed.includes(`${source.fileId}:${source.page ?? source.slide}`));
    if (!visible.length) return null;

    return <div className="evidence-images"><Text type="secondary">원본 근거 이미지</Text><div className="evidence-grid">{visible.map((source) => {
        const page = source.page ?? source.slide!;
        const key = `${source.fileId}:${page}`;
        const original = `/api/files/${source.fileId}/content${source.page ? `#page=${page}` : ""}`;
        return <a key={key} href={original} target="_blank" rel="noopener noreferrer" className="evidence-image" title={`${source.fileName} ${source.page ? "페이지" : "슬라이드"} ${page}`}>
            <img src={`/api/files/${source.fileId}/pages/${page}/preview`} alt={`${source.fileName} ${source.page ? "페이지" : "슬라이드"} ${page} 원본 이미지`} onError={() => setFailed((current) => [...current, key])} />
            <span>{source.fileName} · {source.page ? "페이지" : "슬라이드"} {page}</span>
        </a>;
    })}</div></div>;
}