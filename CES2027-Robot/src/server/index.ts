import { randomUUID } from "crypto";
import fs from "fs";
import { promises as files } from "fs";
import https from "https";
import os from "os";
import path from "path";
import type { Request, Response } from "express";
import express from "express";
import multer from "multer";

import { App, ExpressAdapter, IPlugin } from "@microsoft/teams.apps";
import { ConsoleLogger } from "@microsoft/teams.common/logging";
import { DevtoolsPlugin } from "@microsoft/teams.dev";

import { copyFileToFolder, copyFolder, createFolder, getAdminData, getFileContent, getFolderFiles, getWorkspace, moveFileToFolder, reindexFile, removeFile, removeFolder, renameFile, replaceFileContent, updateDefaultPrompt, updateFileActive, updateFolder } from "./workspace-store";
import { answerQuestion, type SearchProgress } from "./rag-service";
import { renderEvidencePage } from "./evidence-preview";
import { clearChatHistory, finishChatHistory, listChatHistory, startChatHistory, type HistoryStep } from "./chat-history";
import { normalizeUploadName } from "./upload-filename";
import { createVideoJob, listVideoJobs, resumeVideoJobs, retryVideoJob, videoExtensions } from "./video-service";
import { createDocumentJob, listDocumentJobs, resumeDocumentJobs, retryDocumentJob } from "./document-jobs";
import { database } from "./database";
import { streamFile } from "./file-storage";

const sslOptions = {
  key: process.env.SSL_KEY_FILE ? fs.readFileSync(process.env.SSL_KEY_FILE) : undefined,
  cert: process.env.SSL_CRT_FILE ? fs.readFileSync(process.env.SSL_CRT_FILE) : undefined,
};

// Workaround for SDK bug in v2.0.6+: ExpressAdapter uses `instanceof http.Server`
// which fails for https.Server (extends tls.Server, not http.Server).
// Fix: create the adapter, then replace its internal http.Server with our https.Server.
const adapter = new ExpressAdapter();
if (sslOptions.cert && sslOptions.key) {
  const httpsServer = https.createServer(sslOptions, (adapter as any).express);
  (adapter as any).server = httpsServer;
}

// DevTools is opt-in because it binds a separate local port.
const plugins: IPlugin[] = [];
if (process.env.ENABLE_TEAMS_DEVTOOLS === "true") {
  plugins.push(new DevtoolsPlugin());
}
const app = new App({
  logger: new ConsoleLogger("tab", { level: "debug" }),
  plugins: plugins,
  httpServerAdapter: adapter,
  skipAuth: true,
});

adapter.use(express.json());
const upload = multer({ storage: multer.diskStorage({ destination: os.tmpdir(), filename: (_request, _file, next) => next(null, randomUUID()) }), limits: { fileSize: 200 * 1024 * 1024 } });

function receiveUpload(request: Request, response: Response, next: (error?: unknown) => void) {
  const startedAt = Date.now();
  const route = request.path;
  console.info(`[upload] ${route} request received`, { contentLength: request.headers["content-length"] });
  response.on("finish", () => console.info(`[upload] ${route} response finished`, { status: response.statusCode, elapsedMs: Date.now() - startedAt }));
  response.on("close", () => {
    if (!response.writableFinished) console.warn(`[upload] ${route} connection closed before response finished`, { elapsedMs: Date.now() - startedAt });
  });
  upload.single("file")(request, response, (error) => {
    if (error) {
      console.error(`[upload] ${route} multipart failed after ${Date.now() - startedAt}ms`, error);
      response.status(error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? "File exceeds the 200 MB upload limit." : "File upload could not be received." });
      return;
    }
    if (request.file) {
      const originalName = request.file.originalname;
      request.file.originalname = normalizeUploadName(originalName);
      if (originalName !== request.file.originalname) console.info(`[upload] ${route} filename normalized`, { from: originalName, to: request.file.originalname });
    }
    console.info(`[upload] ${route} multipart received`, { sizeBytes: request.file?.size, elapsedMs: Date.now() - startedAt });
    next();
  });
}

function streamProgress(response: Response) {
  response.status(200).type("application/x-ndjson");
  return (message: string, search?: SearchProgress) => response.write(`${JSON.stringify({ type: "progress", message, ...(search ? { search } : {}) })}\n`);
}

adapter.get("/api/workspace", async (_request: Request, response: Response) => {
  try {
    response.json(await getWorkspace());
  } catch (error) {
    response.status(503).json({
      error: "Workspace data is unavailable.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

adapter.post("/api/chat", async (request: Request, response: Response) => {
  const startedAt = Date.now();
  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableFinished) controller.abort(new Error("사용자가 답변 생성을 중지했습니다."));
  });
  let stage = "validating question";
  const steps: HistoryStep[] = [];
  let historyId: string | undefined;
  const writeProgress = streamProgress(response);
  const reportProgress = (message: string, search?: SearchProgress) => {
    controller.signal.throwIfAborted();
    stage = message;
    steps.push({ elapsedMs: Date.now() - startedAt, message, ...(search ? { search } : {}) });
    writeProgress(message, search);
  };
  try {
    const { question } = request.body as { question?: string };
    if (!question?.trim()) throw new Error("question is required.");
    historyId = await startChatHistory(question.trim());
    const result = await answerQuestion(question.trim(), reportProgress, controller.signal);
    controller.signal.throwIfAborted();
    await finishChatHistory(historyId, { answer: result.answer, sources: result.sources, steps });
    console.info("[chat] completed", { stage, sources: result.sources, answerLength: result.answer.length, elapsedMs: Date.now() - startedAt });
    if (!response.destroyed) response.end(`${JSON.stringify({ type: "result", result })}\n`);
  } catch (error) {
    const stopped = controller.signal.aborted;
    if (stopped) console.info("[chat] stopped", { stage, elapsedMs: Date.now() - startedAt });
    else console.error("[chat] failed", { stage, elapsedMs: Date.now() - startedAt, error });
    if (historyId) {
      try { await finishChatHistory(historyId, { error: stopped ? "사용자가 답변 생성을 중지했습니다." : error instanceof Error ? error.message : String(error), steps }); }
      catch (historyError) { console.error("[chat] could not save failure history", historyError); }
    }
    if (!response.destroyed) response.end(`${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) })}\n`);
  }
});

adapter.get("/api/history", async (_request: Request, response: Response) => {
  try {
    response.json(await listChatHistory());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.delete("/api/history", async (_request: Request, response: Response) => {
  try {
    await clearChatHistory();
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.get("/api/admin", async (_request: Request, response: Response) => {
  try {
    response.json(await getAdminData());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.put("/api/admin/prompt", async (request: Request, response: Response) => {
  try {
    const { content } = request.body as { content?: string };
    if (!content?.trim()) return response.status(400).json({ error: "Prompt content is required." });
    response.json(await updateDefaultPrompt(content.trim()));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.post("/api/folders", async (request: Request, response: Response) => {
  try {
    const { name, parentId } = request.body as { name?: string; parentId?: string };
    if (!name?.trim()) return response.status(400).json({ error: "Folder name is required." });
    response.status(201).json(await createFolder(name.trim(), parentId));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.patch("/api/folders/:id", async (request: Request, response: Response) => {
  try {
    const { name, parentId } = request.body as { name?: string; parentId?: string };
    if (!name?.trim()) return response.status(400).json({ error: "Folder name is required." });
    const folderId = request.params.id as string;
    await updateFolder(folderId, name.trim(), parentId);
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.delete("/api/folders/:id", async (request: Request, response: Response) => {
  try {
    const folderId = request.params.id as string;
    await removeFolder(folderId);
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.post("/api/folders/:id/copy", async (request: Request, response: Response) => {
  try {
    await copyFolder(request.params.id as string, (request.body as { targetParentId?: string }).targetParentId);
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.post("/api/folders/:id/files", receiveUpload, async (request: Request, response: Response) => {
  try {
    if (!request.file) return response.status(400).json({ error: "A file is required." });
    const folderId = request.params.id as string;
    const result = videoExtensions.has(request.file.originalname.split(".").pop()?.toLowerCase() ?? "")
      ? await createVideoJob(folderId, request.file)
      : await createDocumentJob(folderId, request.file);
    response.status(202).json(result);
  } catch (error) {
    if (response.headersSent) response.end(`${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) })}\n`);
    else response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (request.file?.path) await files.rm(request.file.path, { force: true });
  }
});

adapter.get("/api/folders/:id/video-jobs", async (request: Request, response: Response) => {
  try {
    const folderId = request.params.id as string;
    const [videos, documents] = await Promise.all([listVideoJobs(folderId), listDocumentJobs(folderId)]);
    response.json([...videos, ...documents]);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.get("/api/folders/:id/files", async (request: Request, response: Response) => {
  try {
    const folderId = request.params.id as string;
    response.json(await getFolderFiles(folderId));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.patch("/api/files/:id", async (request: Request, response: Response) => {
  try {
    const { name, active } = request.body as { name?: string; active?: boolean };
    if (name !== undefined) {
      if (!name.trim()) return response.status(400).json({ error: "File name is required." });
      await renameFile(request.params.id as string, name.trim());
    }
    if (active !== undefined) await updateFileActive(request.params.id as string, active);
    if (name === undefined && active === undefined) return response.status(400).json({ error: "No file update requested." });
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.put("/api/files/:id/content", receiveUpload, async (request: Request, response: Response) => {
  try {
    if (!request.file) return response.status(400).json({ error: "A file is required." });
    response.json(await replaceFileContent(request.params.id as string, { ...request.file, buffer: await files.readFile(request.file.path) }));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (request.file?.path) await files.rm(request.file.path, { force: true });
  }
});

adapter.post("/api/files/:id/reindex", async (request: Request, response: Response) => {
  try {
    const file = await database.file.findUnique({ where: { id: request.params.id as string }, select: { type: true } });
    if (file && videoExtensions.has(file.type.toLowerCase())) {
      await retryVideoJob(request.params.id as string);
      return response.status(202).json({ status: "queued" });
    }
    const documentJob = await database.documentJob.findUnique({ where: { fileId: request.params.id as string } });
    if (documentJob?.status === "failed") {
      await retryDocumentJob(request.params.id as string);
      return response.status(202).json({ status: "queued" });
    }
    if (documentJob && ["queued", "processing"].includes(documentJob.status)) return response.status(409).json({ error: "색인 중입니다." });
    await reindexFile(request.params.id as string);
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.delete("/api/files/:id", async (request: Request, response: Response) => {
  try {
    await removeFile(request.params.id as string);
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.get("/api/files/:id/pages/:page/preview", async (request: Request, response: Response) => {
  try {
    const image = await renderEvidencePage(request.params.id as string, Number(request.params.page));
    response.type("image/png").setHeader("Cache-Control", "private, max-age=300");
    response.send(image);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.get("/api/files/:id/content", async (request: Request, response: Response) => {
  try {
    const video = await database.file.findUnique({ where: { id: request.params.id as string }, select: { name: true, storagePath: true, sizeBytes: true } });
    const videoType = video?.name.split(".").pop()?.toLowerCase();
    if (video?.storagePath && videoType && videoExtensions.has(videoType)) {
      const size = Number(video.sizeBytes);
      const range = request.headers.range;
      const match = range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range && !match) return response.status(416).setHeader("Content-Range", `bytes */${size}`).end();
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : match ? Math.min(start + 2 * 1024 * 1024 - 1, size - 1) : size - 1;
      if (start >= size || start > end) return response.status(416).setHeader("Content-Range", `bytes */${size}`).end();
      response.status(match ? 206 : 200).type({ mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" }[videoType] ?? "application/octet-stream");
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Length", end - start + 1);
      response.setHeader("Content-Disposition", `${request.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(video.name)}`);
      if (match) response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      streamFile(video.storagePath, start, end).on("error", (error) => response.destroy(error)).pipe(response);
      return;
    }
    const file = await getFileContent(request.params.id as string);
    const extension = file.name.split(".").pop()?.toLowerCase();
    const contentTypes: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain", csv: "text/csv" };
    response.type(contentTypes[extension ?? ""] ?? "application/octet-stream");
    response.setHeader("Content-Disposition", `${request.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    response.send(file.content);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

adapter.post("/api/files/:id/transfer", async (request: Request, response: Response) => {
  try {
    const { targetFolderId, copy } = request.body as { targetFolderId?: string; copy?: boolean };
    if (!targetFolderId) return response.status(400).json({ error: "Target folder is required." });
    if (copy) await copyFileToFolder(request.params.id as string, targetFolderId);
    else await moveFileToFolder(request.params.id as string, targetFolderId);
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.message(/.*/, async (ctx) => {
  await ctx.reply({
    type: "message",
    text: "CES2027 Robot is connected. RAG search will be attached here next.",
  });
});

const isDev = process.env.NODE_ENV !== "production";

async function mountTab() {
  if (!isDev) {
    const clientPath = path.join(__dirname, "../client");
    app.tab("files", clientPath);
    app.tab("chat", clientPath);
    app.tab("history", clientPath);
    app.tab("admin", clientPath);
  }
}

(async () => {
  await mountTab();
  await resumeDocumentJobs();
  await resumeVideoJobs();
  await app.start(process.env.PORT || 3978);
})();
