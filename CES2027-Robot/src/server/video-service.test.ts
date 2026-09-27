import assert from "node:assert/strict";
import { test } from "node:test";

import { hasNoAudioStream, parseVertexTranscript, transcriptChunks } from "./video-service";

test("distinguishes silent videos from other FFmpeg failures", () => {
    assert.equal(hasNoAudioStream({ stderr: "Stream map '0:a:0' matches no streams." }), true);
    assert.equal(hasNoAudioStream({ stderr: "Output file does not contain any stream" }), true);
    assert.equal(hasNoAudioStream({ stderr: "Invalid data found when processing input" }), false);
});

test("groups spoken segments into timestamped chunks", () => {
    const chunks = transcriptChunks([
        { alternatives: [{ transcript: "가정존 소개" }], resultEndTime: { seconds: 10 } },
        { alternatives: [{ transcript: "로봇이 물건을 정리합니다" }], resultEndTime: { seconds: 22 } },
        { alternatives: [{ transcript: "상업존 안내" }], resultEndTime: { seconds: 48 } },
    ]);
    assert.equal(chunks.length, 2);
    assert.deepEqual(chunks[0].metadata, { startSeconds: "0", endSeconds: "22", recordType: "video-transcript" });
    assert.match(chunks[0].content, /가정존 소개.*로봇이 물건을 정리합니다/);
    assert.deepEqual(chunks[1].metadata, { startSeconds: "22", endSeconds: "48", recordType: "video-transcript" });
    assert.doesNotMatch(chunks[1].content, /가정존 소개/);
});

test("rejects empty speech segments", () => {
    assert.deepEqual(transcriptChunks([{ alternatives: [{ transcript: "  " }], resultEndTime: { seconds: 15 } }]), []);
});

test("offsets Vertex audio segments to the original video timeline", () => {
    const chunks = parseVertexTranscript([{ startSeconds: 2, endSeconds: 18.5, text: "A robot cleaning the house" }], 300);
    assert.equal(chunks.length, 1);
    assert.deepEqual(chunks[0].metadata, { startSeconds: "302", endSeconds: "319", recordType: "video-transcript" });
    assert.match(chunks[0].content, /5:02-5:19/);
});

test("does not index non-transcription model output", () => {
    assert.deepEqual(parseVertexTranscript([{ text: "Visual guess", startSeconds: -1, endSeconds: 10 }], 0), []);
    assert.throws(() => parseVertexTranscript({ text: "not a list" }, 0));
});