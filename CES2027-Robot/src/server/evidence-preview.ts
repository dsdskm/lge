import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { PDFParse } from "pdf-parse";

import { database } from "./database";
import { downloadFile } from "./file-storage";

const run = promisify(execFile);
let slideRenderer: Promise<string | null> | undefined;

function getSlideRenderer(): Promise<string | null> {
    slideRenderer ??= (async () => {
        for (const command of [process.env.LIBREOFFICE_BIN, "soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"].filter((value): value is string => Boolean(value))) {
            try {
                await run(command, ["--version"], { timeout: 5000 });
                return command;
            } catch { continue; }
        }
        return null;
    })();
    return slideRenderer;
}

export async function canRenderSlides(): Promise<boolean> {
    return Boolean(await getSlideRenderer());
}

async function renderPdfPage(content: Buffer, page: number): Promise<Buffer> {
    const parser = new PDFParse({ data: content });
    try {
        const screenshot = await parser.getScreenshot({ partial: [page], desiredWidth: 960, imageDataUrl: false });
        if (screenshot.pages.length !== 1) throw new Error("Page does not exist.");
        return Buffer.from(screenshot.pages[0].data);
    } finally {
        await parser.destroy();
    }
}

export async function renderEvidencePage(fileId: string, page: number): Promise<Buffer> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 500) throw new Error("Invalid page number.");
    const file = await database.file.findUnique({ where: { id: fileId }, select: { name: true, storagePath: true } });
    if (!file?.storagePath) throw new Error("File does not exist.");
    const extension = path.extname(file.name).toLowerCase();
    const renderer = extension === ".pptx" ? await getSlideRenderer() : null;
    if (extension !== ".pdf" && !renderer) throw new Error("Slide previews are unavailable.");
    const content = await downloadFile(file.storagePath);
    if (extension === ".pdf") return renderPdfPage(content, page);

    const directory = await mkdtemp(path.join(os.tmpdir(), "evidence-preview-"));
    try {
        const presentation = path.join(directory, "source.pptx");
        await writeFile(presentation, content);
        await run(renderer!, ["-env:UserInstallation=file://" + path.join(directory, "profile"), "--headless", "--convert-to", "pdf", "--outdir", directory, presentation], { timeout: 60000 });
        return await renderPdfPage(await readFile(path.join(directory, "source.pdf")), page);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}