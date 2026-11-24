import assert from "node:assert/strict";
import test from "node:test";
import { plan } from "./server.mjs";

test("planning agent returns normalized requirements and handoff criteria", () => {
  const result = plan({
    requirements: {
      robotName: "  Mobile Rover ",
      designBrief: "  Indoor delivery robot ",
      dimensions: { baseLength: 0.42 },
    },
  });

  assert.equal(result.robotName, "Mobile Rover");
  assert.equal(result.requirements.designBrief, "Indoor delivery robot");
  assert.equal(result.plan.length, 3);
  assert.equal(result.handoff.designRequirements, "requirements");
});

test("planning agent rejects a missing robot name", () => {
  assert.throws(() => plan({ requirements: { robotName: " " } }), /robotName is required/);
});

test("planning agent applies configured language and detail level", () => {
  const result = plan({
    requirements: { robotName: "Mobile Rover" },
    options: { outputLanguage: "en", detailLevel: "concise" },
  });

  assert.equal(result.outputLanguage, "en");
  assert.equal(result.detailLevel, "concise");
  assert.equal(result.plan[0].title, "Requirements");
  assert.equal(result.plan[2].output.length, 2);
});

test("planning agent preserves valid knowledge context and rejects invalid context", () => {
  const profile = {
    id: "knowledge-hw",
    type: "HW",
    name: "HW knowledge Agent",
    description: "Hardware guidance",
    guidance: "Check power and I/O budgets.",
  };
  const result = plan({
    requirements: { robotName: "Mobile Rover" },
    knowledgeContext: [profile],
  });

  assert.deepEqual(result.knowledgeContext, [profile]);
  assert.deepEqual(result.knowledgeReview, [{
    agent: profile.name,
    guidance: profile.guidance,
    verified: false,
  }]);
  assert.throws(
    () => plan({ requirements: { robotName: "Mobile Rover" }, knowledgeContext: Array(6).fill(profile) }),
    /at most five profiles/,
  );
  assert.throws(
    () => plan({ requirements: { robotName: "Mobile Rover" }, knowledgeContext: [{ id: "bad" }] }),
    /knowledgeContext\[0\] is invalid/,
  );
});
