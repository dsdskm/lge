import assert from "node:assert/strict";
import test from "node:test";
import { designRobot } from "../../design-agent/src/design.mjs";
import { simulate } from "./server.mjs";

test("simulation agent calculates a differential-drive trajectory", async () => {
  const previousEngine = process.env.DESIGN_AGENT_ENGINE;
  process.env.DESIGN_AGENT_ENGINE = "template";
  try {
    const design = await designRobot({
      requirements: {
        robotName: "Simulation Rover",
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
      id: "knowledge-control",
      type: "제어",
      name: "제어 지식 Agent",
      description: "제어 지침",
      guidance: "분리된 실기 검증 항목을 명시합니다.",
    }];
    const result = simulate({
      urdf: design.urdf,
      knowledgeContext,
      scenario: {
        durationSec: 2,
        linearVelocity: 0.25,
        angularVelocity: 0,
        timeStep: 0.1,
        obstacles: [],
      },
    });
    assert.equal(result.fidelity, "kinematic-preview");
    assert.deepEqual(result.knowledgeContext, knowledgeContext);
    assert.deepEqual(result.knowledgeReview, [{
      agent: knowledgeContext[0].name,
      guidance: knowledgeContext[0].guidance,
      verified: false,
    }]);
    assert.equal(result.metrics.passed, true);
    assert.equal(result.trajectory.length, 21);
    assert.ok(Math.abs(result.metrics.finalPose.x - 0.5) < 1e-9);
    assert.equal(result.metrics.finalPose.y, 0);
  } finally {
    if (previousEngine === undefined) delete process.env.DESIGN_AGENT_ENGINE;
    else process.env.DESIGN_AGENT_ENGINE = previousEngine;
  }
});

test("simulation agent reports a collision in the preview model", async () => {
  const previousEngine = process.env.DESIGN_AGENT_ENGINE;
  process.env.DESIGN_AGENT_ENGINE = "template";
  try {
    const design = await designRobot({
      requirements: {
        robotName: "Collision Rover",
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
    const result = simulate({
      urdf: design.urdf,
      scenario: {
        durationSec: 1,
        linearVelocity: 0,
        angularVelocity: 0,
        timeStep: 0.1,
        obstacles: [{ x: 0, y: 0, radius: 0.1 }],
      },
    });
    assert.equal(result.metrics.passed, false);
    assert.equal(result.metrics.firstCollision?.time, 0);
  } finally {
    if (previousEngine === undefined) delete process.env.DESIGN_AGENT_ENGINE;
    else process.env.DESIGN_AGENT_ENGINE = previousEngine;
  }
});
