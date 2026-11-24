import {
  HttpError,
  readKnowledgeContext,
  startAgentServer,
} from "@workflow/agent-runtime";
import { pathToFileURL } from "node:url";

export function plan(body) {
  const knowledgeContext = readKnowledgeContext(body?.knowledgeContext);
  const requirements = body?.requirements;
  if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) {
    throw new HttpError(400, "requirements must be an object.");
  }
  const robotName = requirements.robotName?.trim();
  if (typeof robotName !== "string" || robotName.length === 0) {
    throw new HttpError(400, "requirements.robotName is required.");
  }
  if (robotName.length > 80) {
    throw new HttpError(400, "requirements.robotName must be 80 characters or fewer.");
  }
  const designBrief =
    typeof requirements.designBrief === "string" ? requirements.designBrief.trim() : "";
  if (designBrief.length > 4000) {
    throw new HttpError(400, "requirements.designBrief must be 4000 characters or fewer.");
  }

  const options = body.options ?? {};
  const outputLanguage = options.outputLanguage === "en" ? "en" : "ko";
  const detailLevel = options.detailLevel === "concise" ? "concise" : "detailed";
  const normalizedBrief =
    designBrief ||
    (outputLanguage === "en"
      ? `Define the intended use and operating environment for ${robotName}.`
      : `${robotName}의 사용 목적과 운용 환경을 구체화합니다.`);
  const plannedRequirements = { ...requirements, robotName, designBrief: normalizedBrief };
  const criteria =
    outputLanguage === "en"
      ? [
          "The URDF link/joint structure and kinematic tree must be valid.",
          "Simulation inputs and implementation outputs must be ready.",
          "Hardware integration items must be reviewed separately.",
        ]
      : [
          "URDF 링크·조인트 구조가 유효할 것",
          "모델/시뮬레이션 입력이 준비될 것",
          "구현 산출물의 하드웨어 연동 항목을 별도로 확인할 것",
        ];
  return {
    robotName,
    outputLanguage,
    detailLevel,
    designBrief: normalizedBrief,
    knowledgeContext,
    knowledgeReview: knowledgeContext.map(({ name, guidance }) => ({
      agent: name,
      guidance,
      verified: false,
    })),
    requirements: plannedRequirements,
    plan: [
      {
        step: 1,
        title: outputLanguage === "en" ? "Requirements" : "요구사항 정리",
        output: normalizedBrief,
      },
      {
        step: 2,
        title: outputLanguage === "en" ? "Design inputs" : "설계 입력 확인",
        output: {
          robotName,
          dimensions: requirements.dimensions ?? null,
        },
      },
      {
        step: 3,
        title: outputLanguage === "en" ? "Validation criteria" : "검증 기준 설정",
        output: detailLevel === "detailed" ? criteria : [criteria[0], criteria[2]],
      },
    ],
    handoff: {
      designRequirements: "requirements",
      summary: "plan",
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startAgentServer({
    name: "planning-agent",
    port: Number(process.env.PLANNING_AGENT_PORT || 4324),
    routes: { "POST /plan": plan },
  });
}
