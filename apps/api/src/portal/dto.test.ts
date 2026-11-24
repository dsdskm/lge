import assert from "node:assert/strict";
import test from "node:test";
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { knowledgeAgents } from "@workflow/shared";
import { CreateWorkflowDto } from "./dto/create-workflow.dto.js";
import { CreateAgentDto } from "./dto/create-agent.dto.js";
import { RunWorkflowDto } from "./dto/run-workflow.dto.js";

test("workflow definitions are standalone and names are trimmed", async () => {
  const valid = plainToInstance(CreateWorkflowDto, { name: "  Robot design  " });
  assert.equal(valid.name, "Robot design");
  assert.deepEqual(await validate(valid), []);

  const invalid = plainToInstance(CreateWorkflowDto, { name: "   " });
  const errors = await validate(invalid);
  assert.ok(errors.some((error) => error.property === "name"));
});

test("workflow definitions validate their fixed stages and executable nodes", async () => {
  const valid = plainToInstance(CreateWorkflowDto, {
    name: "URDF flow",
    definition: {
      stages: ["planning", "design", "model-simulation", "implementation", "validation"].map(
        (id) => ({
          id,
          nodes:
            id === "design"
              ? [{ id: "design-1", kind: "agent", agent: "custom-preview" }]
              : [],
          knowledgeAgentIds: knowledgeAgents.map((agent) => agent.id),
        }),
      ),
    },
  });
  assert.deepEqual(await validate(valid), []);

  const invalid = plainToInstance(CreateWorkflowDto, {
    name: "Bad flow",
    definition: { stages: [{ id: "unknown", nodes: [] }] },
  });
  assert.ok((await validate(invalid)).length > 0);
});

test("workflow stages reject unknown and duplicate knowledge Agent IDs", async () => {
  for (const knowledgeAgentIds of [
    ["knowledge-unknown"],
    [knowledgeAgents[0]!.id, knowledgeAgents[0]!.id],
  ]) {
    const invalid = plainToInstance(CreateWorkflowDto, {
      name: "Bad knowledge links",
      definition: {
        stages: ["planning", "design", "model-simulation", "implementation", "validation"].map(
          (id, index) => ({
            id,
            nodes: [],
            ...(index === 0 ? { knowledgeAgentIds } : {}),
          }),
        ),
      },
    });
    assert.ok((await validate(invalid)).length > 0);
  }
});

test("Agent registration accepts only the five supported stage types and REST paths", async () => {
  const valid = plainToInstance(CreateAgentDto, {
    stageId: "model-simulation",
    name: "  Preview Agent  ",
    description: "  Runs a local simulation.  ",
    baseUrl: "http://127.0.0.1:4330",
    executionPath: "/run",
  });
  assert.equal(valid.name, "Preview Agent");
  assert.equal(valid.description, "Runs a local simulation.");
  assert.deepEqual(await validate(valid), []);

  const invalid = plainToInstance(CreateAgentDto, {
    stageId: "custom",
    name: " ",
    description: "",
    baseUrl: "file:///etc",
    executionPath: "/run?target=unsafe",
  });
  assert.ok((await validate(invalid)).length > 0);
});

test("workflow run transforms numeric form input and rejects unsafe bounds", async () => {
  const dto = plainToInstance(RunWorkflowDto, {
    requirements: {
      robotName: "  Mobile Rover  ",
      dimensions: {
        baseLength: "0.42",
        baseWidth: "0.32",
        bodyHeight: "0.14",
        wheelRadius: "0.075",
        wheelWidth: "0.035",
        wheelTrack: "0.28",
        chassisMass: "8",
      },
    },
    scenario: {
      durationSec: "2",
      linearVelocity: "0.25",
      angularVelocity: "0",
      timeStep: "0.1",
      obstacles: [],
    },
  });
  assert.equal(dto.requirements.robotName, "Mobile Rover");
  assert.deepEqual(await validate(dto), []);

  const invalid = plainToInstance(RunWorkflowDto, {
    requirements: {
      robotName: " ",
      dimensions: { ...dto.requirements.dimensions, baseLength: 100 },
    },
    scenario: {
      durationSec: 2,
      linearVelocity: 0,
      angularVelocity: 0,
      timeStep: 0.1,
      obstacles: [],
    },
  });
  assert.ok((await validate(invalid)).length > 0);
});
