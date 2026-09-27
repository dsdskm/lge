import { PDFParse } from "pdf-parse";
import JSZip from "jszip";
import * as XLSX from "xlsx";

export type ExtractedChunk = { content: string; metadata?: Record<string, string> };
export type ExtractedDocument = { text: string; chunks?: ExtractedChunk[] };

function decodeXml(value: string): string {
    return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

async function extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        const chunks: ExtractedChunk[] = [];
        for (const page of result.pages) {
            const text = page.text.trim();
            for (let start = 0; start < text.length; start += 1500) {
                chunks.push({ content: `Page ${page.num}: ${text.slice(start, start + 1500)}`, metadata: { page: String(page.num) } });
            }
        }
        return { text: result.text, chunks };
    } finally {
        await parser.destroy();
    }
}

async function extractPptx(buffer: Buffer): Promise<ExtractedDocument> {
    const archive = await JSZip.loadAsync(buffer);
    const slideNames = Object.keys(archive.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((left, right) => Number(left.match(/slide(\d+)/)?.[1]) - Number(right.match(/slide(\d+)/)?.[1]));
    const slides: string[] = [];
    const chunks: ExtractedChunk[] = [];
    for (const slideName of slideNames) {
        const xml = await archive.files[slideName].async("text");
        const text = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
            .map((match) => decodeXml(match[1]))
            .join(" ")
            .trim();
        if (text) {
            const slide = Number(slideName.match(/slide(\d+)/)?.[1]);
            slides.push(text);
            for (let start = 0; start < text.length; start += 1500) {
                chunks.push({ content: `Slide ${slide}: ${text.slice(start, start + 1500)}`, metadata: { slide: String(slide) } });
            }
        }
    }
    return { text: slides.join("\n\n"), chunks };
}

async function extractXlsx(buffer: Buffer): Promise<ExtractedDocument> {
    const sheets: string[] = [];
    const chunks: ExtractedChunk[] = [];
    const workbook = XLSX.read(buffer, { type: "buffer", cellText: true, cellDates: true });
    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
        const headerRowIndex = rows.findIndex((row) => row.some((value) => String(value).trim()));
        if (headerRowIndex < 0) continue;
        const headers = rows[headerRowIndex].map((value, index) => String(value).trim() || `Column ${index + 1}`);
        const records = rows.slice(headerRowIndex + 1).map((row, index) => {
            const fields = row
                .map((value, columnIndex) => ({ header: headers[columnIndex] ?? `Column ${columnIndex + 1}`, value: String(value).trim() }))
                .filter((field) => field.value)
                .map((field) => `${field.header}: ${field.value}`);
            if (!fields.length) return "";
            const content = `Sheet: ${sheetName}\nRow: ${headerRowIndex + index + 2}\n${fields.join("\n")}`;
            const metadata = Object.fromEntries(row
                .map((value, columnIndex) => [headers[columnIndex] ?? `Column ${columnIndex + 1}`, String(value).trim()] as const)
                .filter(([, value]) => value));
            chunks.push({ content, metadata: { recordType: metadata["성명"] ? "person" : "table-row", sheet: sheetName, ...metadata } });
            return content;
        }).filter(Boolean);
        if (records.length) sheets.push(records.join("\n\n"));
    }
    return { text: sheets.join("\n\n"), chunks };
}

export async function extractDocumentText(buffer: Buffer, fileName: string, mimeType: string): Promise<ExtractedDocument> {
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (["txt", "md", "csv", "json"].includes(extension ?? "")) return { text: buffer.toString("utf8") };
    if (extension === "pdf" || mimeType === "application/pdf") return extractPdf(buffer);
    if (extension === "pptx" || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return extractPptx(buffer);
    if (extension === "xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return extractXlsx(buffer);
    throw new Error("지원되는 파일 형식은 TXT, MD, CSV, JSON, PDF, PPTX, XLSX입니다.");
}
