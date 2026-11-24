import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import {
  defaultAgentSettings,
  emptyWorkflowDefinition,
  knowledgeAgents,
  legacyWorkflowDefinition,
  workflowStages,
  workflowAgents,
} from "@workflow/shared";
import type {
  AgentAvailability,
  AgentInput,
  AgentSettingsMap,
  DashboardData,
  KnowledgeAgentId,
  PrototypeRunInput,
  PrototypeRunOutput,
  WorkflowDefinition,
  WorkflowAgentId,
  WorkflowNode,
  Workflow,
  WorkflowRun,
  WorkflowRunStep,
} from "@workflow/shared";
import { DatabaseService } from "../database/database.service.js";
import type { CreateWorkflowDto } from "./dto/create-workflow.dto.js";
import type { UpdateWorkflowDefinitionDto } from "./dto/workflow-definition.dto.js";

type WorkflowRow = {
  id: string;
  name: string;
  description: string;
  status: Workflow["status"];
  version: number;
  definition: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RunRow = {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  status: WorkflowRun["status"];
  startedAt: Date | string;
  finishedAt: Date | string | null;
  errorSummary: string | null;
  input: PrototypeRunInput;
  output: PrototypeRunOutput | null;
};

type RunStepRow = {
  id: string;
  sequence: number;
  agent: string;
  status: WorkflowRunStep["status"];
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorSummary: string | null;
  startedAt: Date | string;
  finishedAt: Date | string | null;
};

type RunStepWithRunIdRow = RunStepRow & { runId: string };
type AgentSettingsRow = { agentId: string; settings: unknown };
type AgentCatalogRow = AgentInput & {
  id: string;
  isBuiltin: boolean;
};
type AgentCatalogDbRow = AgentCatalogRow;

function toIsoString(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    definition: normalizeWorkflowDefinition(row.definition),
    createdAt: toIsoString(row.createdAt)!,
    updatedAt: toIsoString(row.updatedAt)!,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSettingsKeys(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new BadRequestException("Agent settings contain unsupported fields.");
  }
}

function boundedSetting(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new BadRequestException(
      `${field} must be a number between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function normalizeAgentSettings(
  agentId: "planning",
  value: unknown,
): AgentSettingsMap["planning"];
function normalizeAgentSettings(
  agentId: "design",
  value: unknown,
): AgentSettingsMap["design"];
function normalizeAgentSettings(
  agentId: "simulation",
  value: unknown,
): AgentSettingsMap["simulation"];
function normalizeAgentSettings(
  agentId: "implementation",
  value: unknown,
): AgentSettingsMap["implementation"];
function normalizeAgentSettings(
  agentId: "validation",
  value: unknown,
): AgentSettingsMap["validation"];
function normalizeAgentSettings(
  agentId: WorkflowAgentId,
  value: unknown,
): AgentSettingsMap[WorkflowAgentId] {
  if (!isRecord(value)) {
    throw new BadRequestException("Agent settings must be an object.");
  }

  switch (agentId) {
    case "planning":
      assertSettingsKeys(value, ["outputLanguage", "detailLevel"]);
      if (
        (value.outputLanguage !== "ko" && value.outputLanguage !== "en") ||
        (value.detailLevel !== "concise" && value.detailLevel !== "detailed")
      ) {
        throw new BadRequestException("Planning Agent settings are invalid.");
      }
      return {
        outputLanguage: value.outputLanguage,
        detailLevel: value.detailLevel,
      };
    case "design":
      assertSettingsKeys(value, ["engine"]);
      if (value.engine !== "claude-cli" && value.engine !== "template") {
        throw new BadRequestException("Design Agent engine is invalid.");
      }
      return { engine: value.engine };
    case "simulation":
      assertSettingsKeys(value, [
        "durationSec",
        "linearVelocity",
        "angularVelocity",
        "timeStep",
      ]);
      return {
        durationSec: boundedSetting(value.durationSec, "durationSec", 0.1, 60),
        linearVelocity: boundedSetting(
          value.linearVelocity,
          "linearVelocity",
          -1,
          1,
        ),
        angularVelocity: boundedSetting(
          value.angularVelocity,
          "angularVelocity",
          -3.14,
          3.14,
        ),
        timeStep: boundedSetting(value.timeStep, "timeStep", 0.02, 0.5),
      };
    case "implementation":
      assertSettingsKeys(value, ["packageSuffix", "rosDistro"]);
      if (
        typeof value.packageSuffix !== "string" ||
        !/^[a-z][a-z0-9_]{0,20}$/.test(value.packageSuffix) ||
        typeof value.rosDistro !== "string" ||
        !/^[a-z][a-z0-9_-]{0,30}$/.test(value.rosDistro)
      ) {
        throw new BadRequestException("Implementation Agent settings are invalid.");
      }
      return {
        packageSuffix: value.packageSuffix,
        rosDistro: value.rosDistro,
      };
    case "validation":
      assertSettingsKeys(value, ["strictness"]);
      if (value.strictness !== "standard" && value.strictness !== "strict") {
        throw new BadRequestException("Validation Agent strictness is invalid.");
      }
      return { strictness: value.strictness };
  }
}

function normalizeWorkflowDefinition(value: unknown): WorkflowDefinition {
  if (!isRecord(value) || !Array.isArray(value.stages) || value.stages.length === 0) {
    return structuredClone(legacyWorkflowDefinition);
  }
  if (value.stages.length !== workflowStages.length) {
    throw new Error("Stored workflow definition must contain all five stages.");
  }

  const seen = new Set<string>();
  const stages = value.stages.map((stage, index) => {
    if (
      !isRecord(stage) ||
      stage.id !== workflowStages[index]!.id ||
      !Array.isArray(stage.nodes)
    ) {
      throw new Error("Stored workflow stages are invalid or out of order.");
    }
    const nodes = stage.nodes.map((node): WorkflowNode => {
      if (!isRecord(node) || typeof node.id !== "string" || seen.has(node.id)) {
        throw new Error("Stored workflow node IDs must be unique strings.");
      }
      seen.add(node.id);
      if (node.kind === "agent") {
        if (typeof node.agent !== "string" || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(node.agent)) {
          throw new Error(`Workflow Agent node ${node.id} has an invalid Agent ID.`);
        }
        return {
          id: node.id,
          kind: "agent",
          agent: node.agent,
          inputMappings: normalizeMappings(node.inputMappings ?? [], "input mapping"),
        };
      }
      if (
        node.kind === "work" &&
        typeof node.name === "string" &&
        node.name.trim() &&
        Array.isArray(node.mappings)
      ) {
        const mappings = normalizeMappings(node.mappings, "work mapping");
        if (mappings.length === 0) {
          throw new BadRequestException(`Work node ${node.id} needs at least one mapping.`);
        }
        return {
          id: node.id,
          kind: "work",
          name: node.name,
          mappings,
        };
      }
      throw new Error(`Workflow node ${node.id} is invalid.`);
    });
    return {
      id: workflowStages[index]!.id,
      nodes,
      knowledgeAgentIds: normalizeKnowledgeAgentIds(stage.knowledgeAgentIds),
    };
  });
  const availableNodeIds = new Set<string>();
  for (const stage of stages) {
    for (const node of stage.nodes) {
      const mappings = node.kind === "work" ? node.mappings : node.inputMappings;
      for (const mapping of mappings) {
        const parts = mapping.source.split(".");
        if (parts[0] === "steps" && !availableNodeIds.has(parts[1]!)) {
          throw new BadRequestException(
            `Node ${node.id} must reference a previous node in its data mapping.`,
          );
        }
      }
      availableNodeIds.add(node.id);
    }
  }
  return { stages };
}

function normalizeKnowledgeAgentIds(value: unknown): KnowledgeAgentId[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException("Stage knowledgeAgentIds must be an array.");
  }
  const selected: KnowledgeAgentId[] = [];
  for (const id of value) {
    const agent = knowledgeAgents.find((candidate) => candidate.id === id);
    if (!agent) {
      throw new BadRequestException(`Unknown Knowledge Agent: ${String(id)}.`);
    }
    if (selected.includes(agent.id)) {
      throw new BadRequestException(`Knowledge Agent ${agent.id} is selected more than once.`);
    }
    selected.push(agent.id);
  }
  return selected;
}

function normalizeAgentInput(value: AgentInput): AgentInput {
  if (!workflowStages.some((stage) => stage.id === value.stageId)) {
    throw new BadRequestException("Agent stage type is invalid.");
  }
  const name = value.name.trim();
  const description = value.description.trim();
  if (!name || name.length > 80 || description.length > 500) {
    throw new BadRequestException("Agent name or description is invalid.");
  }
  let url: URL;
  try {
    url = new URL(value.baseUrl);
  } catch {
    throw new BadRequestException("Agent base URL is invalid.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new BadRequestException("Agent base URL must contain only an HTTP(S) origin.");
  }
  if (!/^\/(?:[A-Za-z0-9._~-]+\/?)*$/.test(value.executionPath)) {
    throw new BadRequestException("Agent execution path is invalid.");
  }
  return {
    stageId: value.stageId,
    name,
    description,
    baseUrl: url.origin,
    executionPath: value.executionPath,
  };
}

function normalizeMappings(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new Error(`Workflow ${label}s must be an array.`);
  }
  return value.map((mapping) => {
    if (
      !isRecord(mapping) ||
      typeof mapping.target !== "string" ||
      typeof mapping.source !== "string" ||
      !mapping.target.trim() ||
      !mapping.source.trim()
    ) {
      throw new Error(`Workflow ${label} is invalid.`);
    }
    const target = mapping.target.trim();
    const source = mapping.source.trim();
    const targetParts = target.split(".");
    const sourceParts = source.split(".");
    if (
      targetParts.some((part) => !part || isUnsafePathPart(part)) ||
      sourceParts.some((part) => !part || isUnsafePathPart(part)) ||
      (sourceParts[0] !== "input" && sourceParts[0] !== "steps")
    ) {
      throw new Error(`Workflow ${label} contains an invalid data path.`);
    }
    return { target, source };
  });
}

function isUnsafePathPart(part: string) {
  return part === "__proto__" || part === "prototype" || part === "constructor";
}

function getPath(source: string, input: PrototypeRunInput, steps: Record<string, Record<string, unknown>>) {
  const parts = source.split(".");
  if (parts.some((part) => !part || isUnsafePathPart(part))) {
    throw new Error(`Invalid data path: ${source}`);
  }
  let value: unknown;
  if (parts[0] === "input") {
    value = input;
    parts.shift();
  } else if (parts[0] === "steps") {
    value = steps;
    parts.shift();
  } else {
    throw new Error(`Data path must start with input or steps: ${source}`);
  }
  for (const part of parts) {
    if (!isRecord(value) || !(part in value)) {
      throw new Error(`Data path not found: ${source}`);
    }
    value = value[part];
  }
  return value;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  if (parts.some((part) => !part || isUnsafePathPart(part))) {
    throw new Error(`Invalid Agent input path: ${path}`);
  }
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next !== undefined && !isRecord(next)) {
      throw new Error(`Agent input path conflicts with an existing value: ${path}`);
    }
    if (next === undefined) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

function mapRun(row: RunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    workflowVersion: row.workflowVersion,
    status: row.status,
    startedAt: toIsoString(row.startedAt)!,
    finishedAt: toIsoString(row.finishedAt),
    errorSummary: row.errorSummary,
    input: row.input,
    output: row.output,
  };
}

function mapRunStep(row: RunStepRow): WorkflowRunStep {
  return {
    id: row.id,
    sequence: row.sequence,
    agent: row.agent,
    status: row.status,
    input: row.input,
    output: row.output,
    errorSummary: row.errorSummary,
    startedAt: toIsoString(row.startedAt)!,
    finishedAt: toIsoString(row.finishedAt),
  };
}

@Injectable()
export class PortalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async health(): Promise<{ status: "ok" }> {
    await this.database.query("SELECT 1");
    return { status: "ok" };
  }

  async listAgents(): Promise<AgentAvailability[]> {
    const agents = await this.getAgentCatalog();
    return Promise.all(agents.map((agent) => this.checkAgentAvailability(agent)));
  }

  async createAgent(value: AgentInput): Promise<AgentAvailability> {
    const agent = normalizeAgentInput(value);
    const result = await this.database.query<AgentCatalogDbRow>(
      `INSERT INTO agent_catalog
        (id, stage_id, name, description, base_url, execution_path)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, stage_id AS "stageId", name, description,
                 base_url AS "baseUrl", execution_path AS "executionPath",
                 is_builtin AS "isBuiltin"`,
      [`custom-${randomUUID()}`, agent.stageId, agent.name, agent.description, agent.baseUrl, agent.executionPath],
    );
    return this.checkAgentAvailability(result.rows[0]!);
  }

  async updateAgent(id: string, value: Partial<AgentInput>): Promise<AgentAvailability> {
    const current = await this.getActiveAgent(id);
    const agent = normalizeAgentInput({
      stageId: value.stageId ?? current.stageId,
      name: value.name ?? current.name,
      description: value.description ?? current.description,
      baseUrl: value.baseUrl ?? current.baseUrl,
      executionPath: value.executionPath ?? current.executionPath,
    });
    if (agent.stageId !== current.stageId) {
      await this.assertAgentNotUsedOutsideStage(id, agent.stageId);
    }
    const result = await this.database.query<AgentCatalogDbRow>(
      `UPDATE agent_catalog
       SET stage_id = $2, name = $3, description = $4, base_url = $5,
           execution_path = $6, updated_at = NOW()
       WHERE id = $1 AND is_active = TRUE
       RETURNING id, stage_id AS "stageId", name, description,
                 base_url AS "baseUrl", execution_path AS "executionPath",
                 is_builtin AS "isBuiltin"`,
      [id, agent.stageId, agent.name, agent.description, agent.baseUrl, agent.executionPath],
    );
    if (result.rowCount === 0) throw new NotFoundException("Agent not found.");
    return this.checkAgentAvailability(result.rows[0]!);
  }

  async deleteAgent(id: string): Promise<{ deleted: true }> {
    await this.getActiveAgent(id);
    await this.assertAgentNotInWorkflows(id);
    const result = await this.database.query(
      `UPDATE agent_catalog
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND is_active = TRUE`,
      [id],
    );
    if (result.rowCount === 0) throw new NotFoundException("Agent not found.");
    return { deleted: true };
  }

  private async getAgentCatalog(): Promise<AgentCatalogRow[]> {
    const result = await this.database.query<AgentCatalogDbRow>(
      `SELECT id, stage_id AS "stageId", name, description,
              base_url AS "baseUrl", execution_path AS "executionPath",
              is_builtin AS "isBuiltin"
       FROM agent_catalog
       WHERE is_active = TRUE
       ORDER BY created_at, id`,
    );
    return result.rows;
  }

  private async getActiveAgent(id: string): Promise<AgentCatalogRow> {
    const result = await this.database.query<AgentCatalogDbRow>(
      `SELECT id, stage_id AS "stageId", name, description,
              base_url AS "baseUrl", execution_path AS "executionPath",
              is_builtin AS "isBuiltin"
       FROM agent_catalog
       WHERE id = $1 AND is_active = TRUE`,
      [id],
    );
    if (result.rowCount === 0) throw new NotFoundException("Agent not found.");
    return result.rows[0]!;
  }

  private async checkAgentAvailability(
    agent: AgentCatalogRow,
  ): Promise<AgentAvailability> {
    try {
      const response = await fetch(`${agent.baseUrl}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) {
        return {
          ...agent,
          status: "unavailable",
          error: `Health endpoint returned HTTP ${response.status}.`,
        };
      }
      return { ...agent, status: "available", error: null };
    } catch (error) {
      return {
        ...agent,
        status: "unavailable",
        error: error instanceof Error ? error.message : "Health check failed.",
      };
    }
  }

  private async assertAgentNotInWorkflows(id: string): Promise<void> {
    const result = await this.database.query<Pick<WorkflowRow, "name" | "definition">>(
      "SELECT name, definition FROM workflows",
    );
    for (const workflow of result.rows) {
      const definition = normalizeWorkflowDefinition(workflow.definition);
      if (definition.stages.some((stage) =>
        stage.nodes.some((node) => node.kind === "agent" && node.agent === id)
      )) {
        throw new BadRequestException(
          `Agent is used by Workflow "${workflow.name}". Remove it from the Workflow before deleting it.`,
        );
      }
    }
  }

  private async assertAgentNotUsedOutsideStage(
    id: string,
    stageId: AgentInput["stageId"],
  ): Promise<void> {
    const result = await this.database.query<Pick<WorkflowRow, "name" | "definition">>(
      "SELECT name, definition FROM workflows",
    );
    for (const workflow of result.rows) {
      const definition = normalizeWorkflowDefinition(workflow.definition);
      if (definition.stages.some((stage) =>
        stage.id !== stageId &&
        stage.nodes.some((node) => node.kind === "agent" && node.agent === id)
      )) {
        throw new BadRequestException(
          `Agent is used in Workflow "${workflow.name}". Remove it from the Workflow before changing its stage type.`,
        );
      }
    }
  }

  private async assertWorkflowAgents(
    definition: WorkflowDefinition,
    catalog?: AgentCatalogRow[],
  ): Promise<void> {
    const agents = catalog ?? await this.getAgentCatalog();
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    for (const stage of definition.stages) {
      for (const node of stage.nodes) {
        if (node.kind !== "agent") continue;
        const agent = agentsById.get(node.agent);
        if (!agent) {
          throw new BadRequestException(`Agent "${node.agent}" is not registered.`);
        }
        if (agent.stageId !== stage.id) {
          throw new BadRequestException(
            `${agent.name} can only be placed in its ${agent.stageId} stage.`,
          );
        }
      }
    }
  }

  async getAgentSettings(): Promise<AgentSettingsMap> {
    const result = await this.database.query<AgentSettingsRow>(
      `SELECT agent_id AS "agentId", settings
       FROM agent_settings`,
    );
    const settings = structuredClone(defaultAgentSettings);
    for (const row of result.rows) {
      switch (row.agentId) {
        case "planning":
          settings.planning = normalizeAgentSettings("planning", row.settings);
          break;
        case "design":
          settings.design = normalizeAgentSettings("design", row.settings);
          break;
        case "simulation":
          settings.simulation = normalizeAgentSettings("simulation", row.settings);
          break;
        case "implementation":
          settings.implementation = normalizeAgentSettings("implementation", row.settings);
          break;
        case "validation":
          settings.validation = normalizeAgentSettings("validation", row.settings);
          break;
        default:
          throw new Error(`Unknown Agent settings entry: ${row.agentId}.`);
      }
    }
    return settings;
  }

  async updateAgentSettings(
    agentId: string,
    value: unknown,
  ): Promise<AgentSettingsMap[WorkflowAgentId]> {
    let settings: AgentSettingsMap[WorkflowAgentId];
    switch (agentId) {
      case "planning":
        settings = normalizeAgentSettings("planning", value);
        break;
      case "design":
        settings = normalizeAgentSettings("design", value);
        break;
      case "simulation":
        settings = normalizeAgentSettings("simulation", value);
        break;
      case "implementation":
        settings = normalizeAgentSettings("implementation", value);
        break;
      case "validation":
        settings = normalizeAgentSettings("validation", value);
        break;
      default:
        throw new NotFoundException("Agent not found.");
    }
    await this.database.query(
      `INSERT INTO agent_settings (agent_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (agent_id)
       DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
      [agentId, JSON.stringify(settings)],
    );
    return settings;
  }

  async getDashboard(): Promise<DashboardData> {
    const [workflows, recentRuns] = await Promise.all([
      this.listWorkflows(),
      this.listRecentRuns(),
    ]);

    return {
      workflows,
      recentRuns,
      counts: {
        workflows: workflows.length,
        activeWorkflows: workflows.filter((workflow) => workflow.status === "active")
          .length,
        recentRuns: recentRuns.length,
      },
    };
  }

  async listWorkflows(): Promise<Workflow[]> {
    const result = await this.database.query<WorkflowRow>(
      `SELECT w.id, w.name, w.description, w.status, w.version, w.definition,
              w.created_at AS "createdAt", w.updated_at AS "updatedAt"
       FROM workflows w
       ORDER BY w.updated_at DESC`,
    );
    return result.rows.map(mapWorkflow);
  }

  async createWorkflow(input: CreateWorkflowDto): Promise<Workflow> {
    const definition = normalizeWorkflowDefinition(
      input.definition ?? emptyWorkflowDefinition,
    );
    await this.assertWorkflowAgents(definition);
    const result = await this.database.query<WorkflowRow>(
      `INSERT INTO workflows (id, name, description, definition)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, name, description, status, version, definition,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        randomUUID(),
        input.name,
        input.description?.trim() ?? "",
        JSON.stringify(definition),
      ],
    );
    return mapWorkflow(result.rows[0]!);
  }

  async updateWorkflowDefinition(
    workflowId: string,
    input: UpdateWorkflowDefinitionDto,
  ): Promise<Workflow> {
    const definition = normalizeWorkflowDefinition(input.definition);
    await this.assertWorkflowAgents(definition);
    if (!definition.stages.some((stage) => stage.nodes.length > 0)) {
      throw new BadRequestException("Workflow must contain at least one node.");
    }
    const result = await this.database.query<WorkflowRow>(
      `UPDATE workflows
       SET definition = $2::jsonb, version = version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, status, version, definition,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [workflowId, JSON.stringify(definition)],
    );
    if (result.rowCount === 0) throw new NotFoundException("Workflow not found");
    return mapWorkflow(result.rows[0]!);
  }

  async listWorkflowRuns(workflowId: string): Promise<WorkflowRun[]> {
    const workflow = await this.database.query(
      "SELECT 1 FROM workflows WHERE id = $1",
      [workflowId],
    );
    if (workflow.rowCount === 0) {
      throw new NotFoundException("Workflow not found");
    }
    const result = await this.database.query<RunRow>(
      `SELECT r.id, r.workflow_id AS "workflowId", w.name AS "workflowName",
              r.workflow_version AS "workflowVersion", r.status,
              r.started_at AS "startedAt", r.finished_at AS "finishedAt",
              r.error_summary AS "errorSummary", r.input, r.output
       FROM workflow_runs r
       JOIN workflows w ON w.id = r.workflow_id
       WHERE r.workflow_id = $1
       ORDER BY r.started_at DESC
       LIMIT 20`,
      [workflowId],
    );
    if (result.rows.length === 0) return [];
    const ids = result.rows.map((row) => row.id);
    const steps = await this.database.query<RunStepWithRunIdRow>(
      `SELECT id, run_id AS "runId", sequence, agent, status, input, output,
              error_summary AS "errorSummary", started_at AS "startedAt",
              finished_at AS "finishedAt"
       FROM workflow_run_steps
       WHERE run_id = ANY($1::uuid[])
       ORDER BY sequence`,
      [ids],
    );
    const stepsByRun = new Map<string, WorkflowRunStep[]>();
    for (const step of steps.rows) {
      const runSteps = stepsByRun.get(step.runId) ?? [];
      runSteps.push(mapRunStep(step));
      stepsByRun.set(step.runId, runSteps);
    }
    return result.rows.map((row) => ({
      ...mapRun(row),
      steps: stepsByRun.get(row.id) ?? [],
    }));
  }

  async runWorkflow(
    workflowId: string,
    input: PrototypeRunInput,
  ): Promise<WorkflowRun> {
    const workflow = await this.database.query<Pick<WorkflowRow, "version" | "definition">>(
      "SELECT version, definition FROM workflows WHERE id = $1",
      [workflowId],
    );
    if (workflow.rowCount === 0) {
      throw new NotFoundException("Workflow not found");
    }
    const definition = normalizeWorkflowDefinition(workflow.rows[0]!.definition);
    const agentCatalog = await this.getAgentCatalog();
    await this.assertWorkflowAgents(definition, agentCatalog);
    if (!definition.stages.some((stage) => stage.nodes.length > 0)) {
      throw new BadRequestException("Workflow has no configured nodes.");
    }

    const agentOptions = await this.getAgentSettings();
    const runId = randomUUID();
    await this.database.query(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_version, status, input)
       VALUES ($1, $2, $3, 'running', $4::jsonb)`,
      [runId, workflowId, workflow.rows[0]!.version, JSON.stringify(input)],
    );

    const agentsById = new Map(agentCatalog.map((agent) => [agent.id, agent]));
    const outputs: PrototypeRunOutput = { steps: {} };
    let sequence = 0;

    for (const stage of definition.stages) {
      const selectedKnowledgeAgents = new Set(stage.knowledgeAgentIds);
      const knowledgeContext = knowledgeAgents
        .filter((agent) => selectedKnowledgeAgents.has(agent.id))
        .map(({ id, type, name, description, guidance }) => ({
          id,
          type,
          name,
          description,
          guidance,
        }));
      for (const node of stage.nodes) {
        sequence += 1;
        const stepId = randomUUID();
        const stageLabel = workflowStages.find((item) => item.id === stage.id)!.label;
        const agent = node.kind === "agent" ? agentsById.get(node.agent) : undefined;
        const agentName =
          node.kind === "agent"
            ? `${stageLabel} · ${agent!.name}`
            : `${stageLabel} · Work: ${node.name}`;
        const stepStartedAt = new Date().toISOString();
        let stepInput: Record<string, unknown> = {};

        try {
          let stepOutput: Record<string, unknown>;
          if (node.kind === "work") {
            stepInput = { mappings: node.mappings };
            stepOutput = {};
            for (const mapping of node.mappings) {
              const value = getPath(mapping.source, input, outputs.steps ?? {});
              setPath(stepOutput, mapping.target, value);
            }
          } else {
            const designOutput = outputs.design;
            switch (stage.id) {
              case "planning":
                stepInput = { requirements: input.requirements };
                break;
              case "design":
                stepInput = {
                  requirements: isRecord(outputs.planning?.requirements)
                    ? outputs.planning.requirements
                    : input.requirements,
                };
                break;
              case "model-simulation":
                if (!designOutput || typeof designOutput.urdf !== "string") {
                  throw new Error(`${agent!.name} requires an earlier design Agent result.`);
                }
                stepInput = { urdf: designOutput.urdf, scenario: input.scenario };
                break;
              case "implementation":
                if (!designOutput || typeof designOutput.urdf !== "string") {
                  throw new Error(`${agent!.name} requires an earlier design Agent result.`);
                }
                stepInput = {
                  urdf: designOutput.urdf,
                  simulation: outputs.simulation ?? null,
                  requirements: input.requirements,
                };
                break;
              case "validation":
                if (!designOutput || typeof designOutput.urdf !== "string") {
                  throw new Error(`${agent!.name} requires an earlier design Agent result.`);
                }
                stepInput = { urdf: designOutput.urdf };
                break;
            }
            const builtin = workflowAgents.find((item) => item.id === node.agent);
            if (builtin) {
              stepInput.options = agentOptions[builtin.id];
            }
            for (const mapping of node.inputMappings) {
              const value = getPath(mapping.source, input, outputs.steps ?? {});
              setPath(stepInput, mapping.target, value);
            }
            if (knowledgeContext.length > 0) {
              stepInput.knowledgeContext = knowledgeContext;
            }
            stepOutput = await this.callAgent(
              `${agent!.baseUrl.replace(/\/$/, "")}${agent!.executionPath}`,
              stepInput,
            );
            if (
              stage.id === "design" &&
              (typeof stepOutput.urdf !== "string" || stepOutput.urdf.length === 0)
            ) {
              throw new Error("Design Agent response did not contain a URDF string.");
            }
            if (stage.id === "validation" && stepOutput.valid !== true) {
              throw new Error("URDF validation did not pass.");
            }
          }

          await this.database.query(
            `INSERT INTO workflow_run_steps
              (id, run_id, sequence, agent, status, input, output, started_at, finished_at)
             VALUES ($1, $2, $3, $4, 'succeeded', $5::jsonb, $6::jsonb, $7, NOW())`,
            [
              stepId,
              runId,
              sequence,
              agentName,
              JSON.stringify(stepInput),
              JSON.stringify(stepOutput),
              stepStartedAt,
            ],
          );
          outputs.steps![node.id] = stepOutput;
          if (node.kind === "agent") {
            const outputKey = stage.id === "model-simulation" ? "simulation" : stage.id;
            outputs[outputKey] = stepOutput;
          }
        } catch (error) {
          const errorSummary =
            error instanceof Error ? error.message : "Workflow node failed.";
          await this.database.query(
            `INSERT INTO workflow_run_steps
              (id, run_id, sequence, agent, status, input, error_summary, started_at, finished_at)
             VALUES ($1, $2, $3, $4, 'failed', $5::jsonb, $6, $7, NOW())`,
            [
              stepId,
              runId,
              sequence,
              agentName,
              JSON.stringify(stepInput),
              errorSummary,
              stepStartedAt,
            ],
          );
          await this.database.query(
            `UPDATE workflow_runs
             SET status = 'failed', error_summary = $2, finished_at = NOW(),
                 output = $3::jsonb
             WHERE id = $1`,
            [runId, `${agentName}: ${errorSummary}`, JSON.stringify(outputs)],
          );
          return (await this.getRun(runId))!;
        }
      }
    }

    await this.database.query(
      `UPDATE workflow_runs
       SET status = 'succeeded', output = $2::jsonb, finished_at = NOW()
       WHERE id = $1`,
      [runId, JSON.stringify(outputs)],
    );
    return (await this.getRun(runId))!;
  }

  private async listRecentRuns(): Promise<WorkflowRun[]> {
    const result = await this.database.query<RunRow>(
      `SELECT r.id, r.workflow_id AS "workflowId", w.name AS "workflowName",
              r.workflow_version AS "workflowVersion", r.status,
              r.started_at AS "startedAt", r.finished_at AS "finishedAt",
              r.error_summary AS "errorSummary"
       FROM workflow_runs r
       JOIN workflows w ON w.id = r.workflow_id
       ORDER BY r.started_at DESC
       LIMIT 8`,
    );
    return result.rows.map(mapRun);
  }

  private async callAgent(
    url: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const timeoutMs = Number(
      this.config.get("AGENT_HTTP_TIMEOUT_MS", "180000"),
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Connection failed.";
      throw new Error(`Could not call agent at ${url}: ${reason}`);
    }

    const bodyText = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error(`Agent at ${url} returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const detail =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : `HTTP ${response.status}`;
      throw new Error(`Agent at ${url} failed: ${detail}`);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error(`Agent at ${url} returned an invalid response object.`);
    }
    return body as Record<string, unknown>;
  }

  private async getRun(runId: string): Promise<WorkflowRun | null> {
    const result = await this.database.query<RunRow>(
      `SELECT r.id, r.workflow_id AS "workflowId", w.name AS "workflowName",
              r.workflow_version AS "workflowVersion", r.status,
              r.started_at AS "startedAt", r.finished_at AS "finishedAt",
              r.error_summary AS "errorSummary", r.input, r.output
       FROM workflow_runs r
       JOIN workflows w ON w.id = r.workflow_id
       WHERE r.id = $1`,
      [runId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const steps = await this.database.query<RunStepRow>(
      `SELECT id, sequence, agent, status, input, output,
              error_summary AS "errorSummary", started_at AS "startedAt",
              finished_at AS "finishedAt"
       FROM workflow_run_steps
       WHERE run_id = $1
       ORDER BY sequence`,
      [runId],
    );
    return { ...mapRun(row), steps: steps.rows.map(mapRunStep) };
  }
}
