import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeUploadName } from "./upload-filename";

test("restores Korean UTF-8 multipart filenames and composes Hangul", () => {
    const name = "시나리오_통합_큐시트_v0.5.pptx";
    const macName = name.normalize("NFD");
    assert.equal(normalizeUploadName(Buffer.from(macName, "utf8").toString("latin1")), name);
});

test("preserves already decoded Unicode and ASCII names", () => {
    assert.equal(normalizeUploadName("상업존.pdf"), "상업존.pdf");
    assert.equal(normalizeUploadName("report.pdf"), "report.pdf");
    assert.equal(normalizeUploadName("café.pdf"), "café.pdf");
});