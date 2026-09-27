import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";

import { database, ensureRuntimeSchema } from "./database";
import type { SearchProgress } from "./rag-service";

export type HistoryStep = { elapsedMs: number; message: string; search?: SearchProgress };
export type HistorySource = { fileId: string; fileName: string; chunkIndex: number; page?: number; slide?: number; startSeconds?: number; endSeconds?: number; previewAvailable?: boolean };

export async function startChatHistory(question: string): Promise<string> {
    await ensureRuntimeSchema();
    const id = randomUUID();
    await database.chatHistory.create({ data: { id, question } });
    return id;
}

export async function finishChatHistory(id: string, update: { answer?: string; error?: string; sources?: HistorySource[]; steps: HistoryStep[] }): Promise<void> {
    await database.chatHistory.update({
        where: { id }, data: {
            answer: update.answer ?? null, error: update.error ?? null,
            sources: (update.sources ?? []) as Prisma.InputJsonValue,
            steps: update.steps as Prisma.InputJsonValue,
        }
    });
}

export async function listChatHistory() {
    await ensureRuntimeSchema();
    const entries = await database.chatHistory.findMany({ orderBy: [{ at: "desc" }, { id: "desc" }], take: 30 });
    return entries.map((entry) => ({ ...entry, at: entry.at.toISOString() }));
}

export async function clearChatHistory(): Promise<void> {
    await ensureRuntimeSchema();
    await database.chatHistory.deleteMany();
}