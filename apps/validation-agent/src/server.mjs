import {
  HttpError,
  readKnowledgeContext,
  startAgentServer,
} from "@workflow/agent-runtime";
import { validateUrdf } from "@workflow/robot-model";
import { pathToFileURL } from "node:url";

export function validate(body) {
  const knowledgeContext = readKnowledgeContext(body?.knowledgeContext);
  if (typeof body.urdf !== "string" || body.urdf.length === 0) {
    throw new HttpError(400, "urdf is required.");
  }
  if (body.urdf.length > 900_000) {
    throw new HttpError(413, "urdf must be 900 KB or smaller.");
  }
  const strictness = body.options?.strictness ?? "standard";
  if (strictness !== "standard" && strictness !== "strict") {
    throw new HttpError(400, "strictness must be 'standard' or 'strict'.");
  }
  const report = validateUrdf(body.urdf);
  const errors =
    strictness === "strict"
      ? [...report.errors, ...report.warnings.map((warning) => `Strict mode: ${warning}`)]
      : report.errors;
  return {
    ...report,
    valid: errors.length === 0,
    errors,
    knowledgeContext,
    knowledgeReview: knowledgeContext.map(({ name, guidance }) => ({
      agent: name,
      guidance,
      verified: false,
    })),
    strictness,
    checkedAt: new Date().toISOString(),
    checks: [
      "XML syntax",
      "link and joint names",
      "parent-child references",
      "single connected kinematic tree",
      "joint axes and limits",
      "mass and diagonal inertia",
    ],
    limitations: [
      "This prototype does not replace urdfdom, ROS 2 tooling, or engineering review.",
      "Mesh resource paths and simulator-specific tags are not resolved.",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startAgentServer({
    name: "validation-agent",
    port: Number(process.env.VALIDATION_AGENT_PORT || 4322),
    routes: {
      "POST /validate": validate,
    },
  });
}
