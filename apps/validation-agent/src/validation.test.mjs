import assert from "node:assert/strict";
import test from "node:test";
import { designRobot } from "../../design-agent/src/design.mjs";
import { validate } from "./server.mjs";

test("validation agent reports structural URDF checks", async () => {
  const previousEngine = process.env.DESIGN_AGENT_ENGINE;
  process.env.DESIGN_AGENT_ENGINE = "template";
  try {
    const design = await designRobot({
      requirements: {
        robotName: "Validation Rover",
        dimensions: {
          baseLength: 0.42,
          baseWidth: 0.32,
          bodyHeight: 0.14,
          wheelRadius: 0.075,
          wheelWidth: 0.035,
          wheelTrack: 0.28,
          chassisMass: 8,
        },
      },
    });
    const knowledgeContext = [{
      id: "knowledge-planning",
      type: "기획",
      name: "기획 지식 Agent",
      description: "기획 지침",
      guidance: "요구사항과 수용 기준의 추적성을 확인합니다.",
    }];
    const report = validate({ urdf: design.urdf, knowledgeContext });
    assert.equal(report.valid, true);
    assert.equal(report.linkCount, 4);
    assert.equal(report.jointCount, 3);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.knowledgeContext, knowledgeContext);
    assert.deepEqual(report.knowledgeReview, [{
      agent: "기획 지식 Agent",
      guidance: "요구사항과 수용 기준의 추적성을 확인합니다.",
      verified: false,
    }]);
  } finally {
    if (previousEngine === undefined) delete process.env.DESIGN_AGENT_ENGINE;
    else process.env.DESIGN_AGENT_ENGINE = previousEngine;
  }
});

test("validation agent rejects a missing URDF", () => {
  assert.throws(() => validate({}), /urdf is required/);
});

test("strict validation promotes URDF warnings to errors", () => {
  const report = validate({
    urdf: '<robot name="minimal"><link name="base_link"/></robot>',
    options: { strictness: "strict" },
  });

  assert.equal(report.strictness, "strict");
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.startsWith("Strict mode:")));
});
