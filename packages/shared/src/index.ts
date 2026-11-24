export type WorkflowStatus = "draft" | "active" | "archived";
export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export const workflowStages = [
  { id: "planning", label: "기획" },
  { id: "design", label: "설계" },
  { id: "model-simulation", label: "모델/시뮬" },
  { id: "implementation", label: "구현" },
  { id: "validation", label: "검증" },
] as const;

export type WorkflowStageId = (typeof workflowStages)[number]["id"];

export const knowledgeAgents = [
  {
    id: "knowledge-hw",
    type: "HW",
    name: "HW 지식 Agent",
    description: "보드, 연산 자원, 전원, 통신 및 센서·액추에이터 인터페이스를 고려합니다.",
    guidance:
      "보드·MCU/SoC, 연산·메모리·I/O, 전원 예산, 통신, 센서·액추에이터 인터페이스, 발열과 조달 제약을 확인하고 미확인 사양은 가정으로 표시합니다.",
  },
  {
    id: "knowledge-mechanical",
    type: "기구",
    name: "기구 지식 Agent",
    description: "기구 배치, 치수, 재료, 하중, 공차와 제작·정비성을 고려합니다.",
    guidance:
      "기구 배치, 치수, 재료, 하중, 공차, 조립·제작·정비성을 함께 검토하고 구조 가정과 검증이 필요한 항목을 구분합니다.",
  },
  {
    id: "knowledge-bsp",
    type: "BSP",
    name: "BSP 지식 Agent",
    description: "대상 보드의 BSP, OS·커널, 드라이버와 ROS 2 호환성을 고려합니다.",
    guidance:
      "대상 보드와 BSP, OS·커널, device tree, 드라이버, 부팅 설정, ROS 2 배포판 및 바이너리 호환성을 확인하고 확인되지 않은 버전은 명시합니다.",
  },
  {
    id: "knowledge-control",
    type: "제어",
    name: "제어 지식 Agent",
    description: "운동 모델, 센서 피드백, 제어 주기, 구동 한계와 안전 상태를 고려합니다.",
    guidance:
      "운동 모델, 센서 피드백, 제어 주기, 구동기 한계, 안정성, 튜닝과 정지 상태를 고려하고 시뮬레이션·실기 검증 항목을 분리합니다.",
  },
  {
    id: "knowledge-planning",
    type: "기획",
    name: "기획 지식 Agent",
    description: "요구사항 추적성, 가정, 수용 기준, 위험과 검증 계획을 고려합니다.",
    guidance:
      "요구사항과 산출물의 추적성, 가정, 수용 기준, 위험, 단계별 의존성과 검증 계획을 명시하고 누락된 요구사항은 질문으로 남깁니다.",
  },
] as const;

export type KnowledgeAgentId = (typeof knowledgeAgents)[number]["id"];

export const workflowAgents = [
  {
    id: "planning",
    stageId: "planning",
    name: "기획 Agent",
    description: "요구사항을 구조화하고 설계 입력과 검증 기준을 정리합니다.",
    port: 4324,
    executionPath: "/plan",
  },
  {
    id: "design",
    stageId: "design",
    name: "설계 Agent",
    description: "로봇 치수와 설계 브리프로 primitive URDF를 생성합니다.",
    port: 4321,
    executionPath: "/design",
  },
  {
    id: "simulation",
    stageId: "model-simulation",
    name: "모델/시뮬 Agent",
    description: "URDF 모델을 바탕으로 2D 차동구동 운동학을 계산합니다.",
    port: 4323,
    executionPath: "/simulate",
  },
  {
    id: "implementation",
    stageId: "implementation",
    name: "구현 Agent",
    description: "URDF에서 ROS 2 구동 패키지 초안과 설정 파일을 생성합니다.",
    port: 4325,
    executionPath: "/implement",
  },
  {
    id: "validation",
    stageId: "validation",
    name: "검증 Agent",
    description: "URDF 링크·조인트 구조와 운동학 트리를 검사합니다.",
    port: 4322,
    executionPath: "/validate",
  },
] as const;

export type WorkflowAgentId = (typeof workflowAgents)[number]["id"];

export interface PlanningAgentSettings {
  outputLanguage: "ko" | "en";
  detailLevel: "concise" | "detailed";
}

export interface DesignAgentSettings {
  engine: "claude-cli" | "template";
}

export interface SimulationAgentSettings {
  durationSec: number;
  linearVelocity: number;
  angularVelocity: number;
  timeStep: number;
}

export interface ImplementationAgentSettings {
  packageSuffix: string;
  rosDistro: string;
}

export interface ValidationAgentSettings {
  strictness: "standard" | "strict";
}

export interface AgentSettingsMap {
  planning: PlanningAgentSettings;
  design: DesignAgentSettings;
  simulation: SimulationAgentSettings;
  implementation: ImplementationAgentSettings;
  validation: ValidationAgentSettings;
}

export const defaultAgentSettings: AgentSettingsMap = {
  planning: { outputLanguage: "ko", detailLevel: "detailed" },
  design: { engine: "claude-cli" },
  simulation: {
    durationSec: 8,
    linearVelocity: 0.25,
    angularVelocity: 0.1,
    timeStep: 0.1,
  },
  implementation: { packageSuffix: "bringup", rosDistro: "jazzy" },
  validation: { strictness: "standard" },
};

export interface AgentAvailability {
  id: string;
  stageId: WorkflowStageId;
  name: string;
  description: string;
  baseUrl: string;
  executionPath: string;
  isBuiltin: boolean;
  status: "available" | "unavailable";
  error: string | null;
}

export interface AgentInput {
  stageId: WorkflowStageId;
  name: string;
  description: string;
  baseUrl: string;
  executionPath: string;
}

export interface WorkMapping {
  target: string;
  source: string;
}

export interface WorkflowAgentNode {
  id: string;
  kind: "agent";
  agent: string;
  inputMappings: WorkMapping[];
}

export interface WorkflowWorkNode {
  id: string;
  kind: "work";
  name: string;
  mappings: WorkMapping[];
}

export type WorkflowNode = WorkflowAgentNode | WorkflowWorkNode;

export interface WorkflowStage {
  id: WorkflowStageId;
  nodes: WorkflowNode[];
  knowledgeAgentIds: KnowledgeAgentId[];
}

export interface WorkflowDefinition {
  stages: WorkflowStage[];
}

const defaultNode = (id: string, agent: WorkflowAgentId): WorkflowAgentNode => ({
  id,
  kind: "agent",
  agent,
  inputMappings: [],
});

export const emptyWorkflowDefinition: WorkflowDefinition = {
  stages: workflowStages.map(({ id }) => ({
    id,
    nodes: [],
    knowledgeAgentIds: [],
  })),
};

export const legacyWorkflowDefinition: WorkflowDefinition = {
  stages: [
    { id: "planning", nodes: [], knowledgeAgentIds: [] },
    { id: "design", nodes: [defaultNode("design-agent", "design")], knowledgeAgentIds: [] },
    { id: "model-simulation", nodes: [defaultNode("simulation-agent", "simulation")], knowledgeAgentIds: [] },
    { id: "implementation", nodes: [], knowledgeAgentIds: [] },
    { id: "validation", nodes: [defaultNode("validation-agent", "validation")], knowledgeAgentIds: [] },
  ],
};

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  definition: WorkflowDefinition;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName?: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string | null;
  errorSummary: string | null;
  input?: PrototypeRunInput;
  output?: PrototypeRunOutput | null;
  steps?: WorkflowRunStep[];
}

export interface PrototypeRunInput {
  requirements: {
    robotName: string;
    designBrief: string;
    dimensions: {
      baseLength: number;
      baseWidth: number;
      bodyHeight: number;
      wheelRadius: number;
      wheelWidth: number;
      wheelTrack: number;
      chassisMass: number;
    };
  };
  scenario: {
    durationSec: number;
    linearVelocity: number;
    angularVelocity: number;
    timeStep: number;
    obstacles: Array<{ x: number; y: number; radius: number }>;
  };
}

export interface PrototypeRunOutput {
  planning?: Record<string, unknown>;
  design?: Record<string, unknown>;
  simulation?: Record<string, unknown>;
  implementation?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  steps?: Record<string, Record<string, unknown>>;
}

export interface WorkflowRunStep {
  id: string;
  sequence: number;
  agent: string;
  status: WorkflowRunStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DashboardData {
  workflows: Workflow[];
  recentRuns: WorkflowRun[];
  counts: {
    workflows: number;
    activeWorkflows: number;
    recentRuns: number;
  };
}
