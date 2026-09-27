import type { SearchProgress } from "./HistoryPanel";

type ProgressEvent<T> = { type: "progress"; message: string; search?: SearchProgress } | { type: "result"; result: T } | { type: "error"; error: string };

export async function responseError(response: Response, fallback: string): Promise<Error> {
    const text = await response.text();
    if (!text) return new Error(fallback);
    try {
        const body = JSON.parse(text) as { error?: string };
        return new Error(body.error ?? fallback);
    } catch {
        return new Error(fallback);
    }
}

export async function fetchProgress<T>(input: RequestInfo | URL, init: RequestInit, onProgress: (message: string, search?: SearchProgress) => void): Promise<T> {
    const response = await fetch(input, init);
    if (!response.ok || !response.body) throw await responseError(response, "Request failed.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as ProgressEvent<T>;
            if (event.type === "progress") onProgress(event.message, event.search);
            if (event.type === "error") throw new Error(event.error);
            if (event.type === "result") return event.result;
        }
        if (done) break;
    }
    throw new Error("The server ended before returning a result.");
}