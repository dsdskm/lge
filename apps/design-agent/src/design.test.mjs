import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getDifferentialDriveGeometry, validateUrdf } from "@workflow/robot-model";
import { designRobot } from "./design.mjs";

const requirements = {
  robotName: "Prototype Rover",
  designBrief: "Compact indoor robot",
  dimensions: {
    baseLength: 0.42,
    baseWidth: 0.32,
    bodyHeight: 0.14,
    wheelRadius: 0.075,
    wheelWidth: 0.035,
    wheelTrack: 0.28,
    chassisMass: 8,
  },
};

test("design agent produces a valid differential-drive URDF", async () => {
  const previousEngine = process.env.DESIGN_AGENT_ENGINE;
  process.env.DESIGN_AGENT_ENGINE = "claude-cli";
  try {
    const design = await designRobot({
      options: { engine: "template" },
      requirements,
      knowledgeContext: [{
        id: "knowledge-mechanical",
        type: "기구",
        name: "기구 지식 Agent",
        description: "기구 설계 지침",
        guidance: "제작성과 정비성을 고려합니다.",
      }],
    });

    assert.equal(design.engine, "template");
    assert.equal(design.knowledgeContext[0].id, "knowledge-mechanical");
    assert.equal(validateUrdf(design.urdf).valid, true);
    assert.deepEqual(getDifferentialDriveGeometry(design.urdf), {
      baseLength: 0.42,
      baseWidth: 0.32,
      wheelRadius: 0.075,
      wheelTrack: 0.28,
    });
  } finally {
    if (previousEngine === undefined) delete process.env.DESIGN_AGENT_ENGINE;
    else process.env.DESIGN_AGENT_ENGINE = previousEngine;
  }
});

test("Claude CLI receives the design prompt and knowledge guidance on stdin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "design-agent-test-"));
  const fakeCli = join(directory, "claude");
  const previousCliPath = process.env.CLAUDE_CLI_PATH;
  await writeFile(
    fakeCli,
    `#!/usr/bin/env node
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ is_error: false, result: prompt }));
});
`,
  );
  await chmod(fakeCli, 0o755);

  try {
    process.env.CLAUDE_CLI_PATH = fakeCli;
    const design = await designRobot({
      options: { engine: "claude-cli" },
      requirements,
      knowledgeContext: [{
        id: "knowledge-hw",
        type: "HW",
        name: "HW knowledge Agent",
        description: "Hardware guidance",
        guidance: "Check power and I/O budgets.",
      }],
    });

    assert.ok(design.concept.includes("You are the exterior concept designer"));
    assert.ok(design.concept.includes("HW knowledge Agent (HW): Check power and I/O budgets."));
  } finally {
    if (previousCliPath === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previousCliPath;
    await rm(directory, { recursive: true, force: true });
  }
});
