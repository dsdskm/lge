import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentAvailability,
  AgentInput,
  AgentSettingsMap,
  DashboardData,
  KnowledgeAgentId,
  WorkflowDefinition,
  WorkflowAgentId,
  WorkflowNode,
  PrototypeRunInput,
  Workflow,
  WorkflowRun,
} from "@workflow/shared";
import {
  defaultAgentSettings,
  emptyWorkflowDefinition,
  knowledgeAgents,
  workflowStages,
  workflowAgents,
} from "@workflow/shared";

type Section = "overview" | "workflows" | "agents" | "runs";
type Dialog = "workflow" | null;

const sectionStorageKey = "robot-workflow-portal-section";
const workflowStorageKey = "robot-workflow-portal-workflow";

function isSection(value: string | null): value is Section {
  return (
    value === "overview" ||
    value === "workflows" ||
    value === "agents" ||
    value === "runs"
  );
}

function getInitialSection(): Section {
  const requestedSection = new URLSearchParams(window.location.search).get("tab");
  if (isSection(requestedSection)) return requestedSection;
  const savedSection = window.localStorage.getItem(sectionStorageKey);
  return isSection(savedSection) ? savedSection : "overview";
}

function getInitialWorkflowId(): string | null {
  if (getInitialSection() !== "workflows") return null;
  const queryWorkflow = new URLSearchParams(window.location.search).get("workflow");
  return queryWorkflow || window.localStorage.getItem(workflowStorageKey);
}

function storeNavigationState(section: Section, workflowId: string | null): void {
  window.localStorage.setItem(sectionStorageKey, section);
  const url = new URL(window.location.href);
  if (section === "overview") url.searchParams.delete("tab");
  else url.searchParams.set("tab", section);
  if (section === "workflows" && workflowId) {
    url.searchParams.set("workflow", workflowId);
    window.localStorage.setItem(workflowStorageKey, workflowId);
  } else {
    url.searchParams.delete("workflow");
    window.localStorage.removeItem(workflowStorageKey);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "요청을 처리하지 못했습니다.";
    throw new Error(message);
  }
  return body as T;
}

const emptyDashboard: DashboardData = {
  workflows: [],
  recentRuns: [],
  counts: { workflows: 0, activeWorkflows: 0, recentRuns: 0 },
};

function Icon({
  name,
  size = 18,
}: {
  name: "orbit" | "grid" | "workflow" | "activity" | "plus" | "arrow" | "robot";
  size?: number;
}) {
  const paths: Record<typeof name, React.ReactNode> = {
    orbit: <><circle cx="12" cy="12" r="3" /><ellipse cx="12" cy="12" rx="9" ry="4.5" transform="rotate(-35 12 12)" /><circle cx="18.9" cy="6.8" r="1" fill="currentColor" stroke="none" /></>,
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    workflow: <><rect x="3.5" y="4" width="6" height="6" rx="2" /><rect x="14.5" y="14" width="6" height="6" rx="2" /><path d="M9.5 7h3a2 2 0 0 1 2 2v5" /><path d="M12.5 14h2" /></>,
    activity: <><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    robot: <><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6" /><path d="M2 12h2M20 12h2" /></>,
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [agents, setAgents] = useState<AgentAvailability[]>([]);
  const [agentSettings, setAgentSettings] =
    useState<AgentSettingsMap>(defaultAgentSettings);
  const [section, setSection] = useState<Section>(getInitialSection);
  const [selectedWorkflowId, setSelectedWorkflowId] =
    useState<string | null>(getInitialWorkflowId);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [data, availableAgents, configuredAgentSettings] = await Promise.all([
        request<DashboardData>("/api/dashboard"),
        request<AgentAvailability[]>("/api/agents"),
        request<AgentSettingsMap>("/api/agent-settings"),
      ]);
      setDashboard(data);
      setAgents(availableAgents);
      setAgentSettings(configuredAgentSettings);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;
    const refreshAgentStatus = async () => {
      try {
        const availableAgents = await request<AgentAvailability[]>("/api/agents");
        if (active) setAgents(availableAgents);
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Agent 상태를 불러오지 못했습니다.");
        }
      }
    };
    const intervalId = window.setInterval(() => void refreshAgentStatus(), 5000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    storeNavigationState(section, selectedWorkflowId);
  }, [section, selectedWorkflowId]);

  useEffect(() => {
    if (section !== "workflows" || !selectedWorkflowId || loading) return;
    const workflow = dashboard.workflows.find((item) => item.id === selectedWorkflowId);
    if (!workflow) {
      setSelectedWorkflow(null);
      setSelectedWorkflowId(null);
      return;
    }
    if (selectedWorkflow?.id === workflow.id) return;
    setSelectedWorkflow(workflow);
    void request<WorkflowRun[]>(`/api/workflows/${workflow.id}/runs`)
      .then(setRuns)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "실행 이력을 불러오지 못했습니다.");
      });
  }, [dashboard.workflows, loading, section, selectedWorkflow?.id, selectedWorkflowId]);

  const openWorkflow = async (workflow: Workflow) => {
    storeNavigationState("workflows", workflow.id);
    setSelectedWorkflow(workflow);
    setSection("workflows");
    setSelectedWorkflowId(workflow.id);
    try {
      setRuns(await request<WorkflowRun[]>(`/api/workflows/${workflow.id}/runs`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "실행 이력을 불러오지 못했습니다.");
    }
  };

  const navigate = (nextSection: Section) => {
    storeNavigationState(nextSection, null);
    setSection(nextSection);
    setSelectedWorkflow(null);
    setSelectedWorkflowId(null);
  };

  const createWorkflow = async (values: { name: string; description: string }) => {
    const workflow = await request<Workflow>("/api/workflows", {
      method: "POST",
      body: JSON.stringify({
        ...values,
        definition: emptyWorkflowDefinition,
      }),
    });
    setDialog(null);
    await refresh();
    await openWorkflow(workflow);
  };

  const updateWorkflowDefinition = async (definition: WorkflowDefinition) => {
    if (!selectedWorkflow) throw new Error("Workflow를 선택해 주세요.");
    const updated = await request<Workflow>(
      `/api/workflows/${selectedWorkflow.id}/definition`,
      { method: "PATCH", body: JSON.stringify({ definition }) },
    );
    setSelectedWorkflow(updated);
    await refresh();
  };

  const updateAgentSettings = async (
    agentId: WorkflowAgentId,
    settings: AgentSettingsMap[WorkflowAgentId],
  ) => {
    const savedSettings = await request<AgentSettingsMap[WorkflowAgentId]>(
      `/api/agent-settings/${agentId}`,
      { method: "PUT", body: JSON.stringify({ settings }) },
    );
    setAgentSettings((current) => ({ ...current, [agentId]: savedSettings }));
  };

  const createAgent = async (agent: AgentInput) => {
    await request<AgentAvailability>("/api/agents", {
      method: "POST",
      body: JSON.stringify(agent),
    });
    await refresh();
  };

  const updateAgent = async (id: string, agent: AgentInput) => {
    await request<AgentAvailability>(`/api/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(agent),
    });
    await refresh();
  };

  const deleteAgent = async (id: string) => {
    await request<{ deleted: true }>(`/api/agents/${id}`, { method: "DELETE" });
    await refresh();
  };

  const runWorkflow = async (input: PrototypeRunInput) => {
    if (!selectedWorkflow) throw new Error("Workflow를 선택해 주세요.");
    const run = await request<WorkflowRun>(
      `/api/workflows/${selectedWorkflow.id}/runs`,
      { method: "POST", body: JSON.stringify(input) },
    );
    setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 20));
    await refresh();
    return run;
  };

  const title =
    section === "overview"
      ? "Robotics Workflow"
      : section === "workflows"
        ? selectedWorkflow?.name ?? "Workflows"
        : section === "agents"
          ? "Agents"
        : "실행 이력";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => navigate("overview")}>
          <span className="brand-mark"><Icon name="orbit" size={23} /></span>
          <span className="brand-name">orbit<span>.</span></span>
          <span className="brand-tag">LOCAL</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">R</span>
          <span className="workspace-text"><strong>Robot Lab</strong><small>로컬 워크스페이스</small></span>
          <span className="chevron">⌄</span>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="메인 메뉴">
          <NavButton active={section === "overview"} icon="workflow" onClick={() => navigate("overview")}>대시보드</NavButton>
          <NavButton active={section === "workflows"} icon="workflow" onClick={() => navigate("workflows")}>Workflows</NavButton>
          <NavButton active={section === "agents"} icon="robot" onClick={() => navigate("agents")}>Agents</NavButton>
          <NavButton active={section === "runs"} icon="activity" onClick={() => navigate("runs")}>실행 이력</NavButton>
        </nav>
        <div className="sidebar-bottom">
          <div className="server-status"><span className="status-dot" /> 로컬 서버 연결됨</div>
          <div className="profile">
            <div className="profile-avatar">R</div>
            <div><strong>Robot Engineer</strong><small>개인 워크스페이스</small></div>
            <span className="profile-more">···</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Robot Lab</span><span className="breadcrumb-separator">/</span><strong>{title}</strong></div>
          <div className="topbar-actions">
            <span className="local-pill"><span className="status-dot" /> Local</span>
            <button className="icon-button" aria-label="도움말">?</button>
            <button className="user-chip" aria-label="사용자 메뉴">R</button>
          </div>
        </header>

        <div className="page-content">
          {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void refresh()}>다시 시도</button></div>}
          {loading ? (
            <div className="loading-state"><span className="spinner" /> 포털 데이터를 불러오는 중...</div>
          ) : section === "overview" ? (
            <Overview
              dashboard={dashboard}
              agents={agents}
              onCreateWorkflow={() => setDialog("workflow")}
              onShowWorkflows={() => navigate("workflows")}
              onShowAgents={() => navigate("agents")}
              onOpenWorkflow={openWorkflow}
              onShowRuns={() => navigate("runs")}
            />
          ) : section === "workflows" ? (
            selectedWorkflow ? (
              <WorkflowDetail
                workflow={selectedWorkflow}
                agents={agents}
                simulationSettings={agentSettings.simulation}
                runs={runs}
                onBack={() => {
                  storeNavigationState("workflows", null);
                  setSelectedWorkflow(null);
                  setSelectedWorkflowId(null);
                }}
                onRun={runWorkflow}
                onSaveDefinition={updateWorkflowDefinition}
              />
            ) : (
              <WorkflowList workflows={dashboard.workflows} onCreate={() => setDialog("workflow")} onOpen={openWorkflow} />
            )
          ) : section === "agents" ? (
            <AgentsPage
              agents={agents}
              settings={agentSettings}
              onRefresh={() => void refresh()}
              onSaveSettings={updateAgentSettings}
              onCreateAgent={createAgent}
              onUpdateAgent={updateAgent}
              onDeleteAgent={deleteAgent}
            />
          ) : (
            <RunList runs={dashboard.recentRuns} workflows={dashboard.workflows} onOpenWorkflow={openWorkflow} />
          )}
        </div>
      </main>

      {dialog && (
        <CreateDialog
          onClose={() => setDialog(null)}
          onCreateWorkflow={createWorkflow}
        />
      )}
    </div>
  );
}

function NavButton({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: "workflow" | "activity" | "robot";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return <button className={`nav-item${active ? " active" : ""}`} onClick={onClick}><Icon name={icon} size={17} /><span>{children}</span></button>;
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Overview({
  dashboard,
  agents,
  onCreateWorkflow,
  onShowWorkflows,
  onShowAgents,
  onOpenWorkflow,
  onShowRuns,
}: {
  dashboard: DashboardData;
  agents: AgentAvailability[];
  onCreateWorkflow: () => void;
  onShowWorkflows: () => void;
  onShowAgents: () => void;
  onOpenWorkflow: (workflow: Workflow) => void;
  onShowRuns: () => void;
}) {
  return (
    <>
      <PageHeading eyebrow="ROBOTICS WORKFLOW" title="Robotics Workflow" description="고정된 다섯 단계에 Agent와 Work를 조합해 Workflow를 만들고 실행합니다." action={<button className="button button-primary" onClick={onCreateWorkflow}><Icon name="plus" size={16} /> Workflow 만들기</button>} />
      <section className="welcome-strip">
        <div className="welcome-icon"><Icon name="workflow" size={21} /></div>
        <div className="welcome-copy"><strong>기획 → 설계 → 모델/시뮬 → 구현 → 검증</strong><span>이 다섯 단계는 공통으로 유지되고, 각 Workflow마다 단계 안의 Agent와 Work 구성을 다르게 설정할 수 있습니다.</span></div>
        <div className="welcome-note"><span className="status-dot" /> 로컬 서버에 저장됩니다</div>
      </section>
      <section className="metrics-grid">
        <MetricCard label="Workflows" value={dashboard.counts.workflows} icon="workflow" caption={`${dashboard.counts.activeWorkflows}개 활성`} tone="violet" />
        <MetricCard label="최근 실행" value={dashboard.counts.recentRuns} icon="activity" caption="저장된 실행 기록" tone="amber" />
        <MetricCard label="진행 중" value={dashboard.recentRuns.filter((run) => run.status === "running").length} icon="orbit" caption="현재 실행 중인 작업" tone="green" />
        <MetricCard label="사용 가능 Agent" value={agents.filter((agent) => agent.status === "available").length} icon="robot" caption={`${agents.length}개 단계별 프로토타입`} tone="blue" />
      </section>
      <div className="content-grid">
        <section className="panel workflow-panel">
          <div className="panel-heading"><div><h2>Workflows</h2><p>각자 다른 단계 구성을 가진 Workflow</p></div><div><button className="text-button" onClick={onShowAgents}>Agents 보기 <Icon name="arrow" size={14} /></button><button className="text-button" onClick={onShowWorkflows} disabled={dashboard.workflows.length === 0}>전체 보기 <Icon name="arrow" size={14} /></button></div></div>
          {dashboard.workflows.length === 0 ? (
            <EmptyState icon="workflow" title="아직 Workflow가 없습니다" description="다섯 단계에 Agent와 Work를 배치하는 첫 Workflow를 만들어보세요." action={<button className="button button-outline" onClick={onCreateWorkflow}><Icon name="plus" size={15} /> Workflow 만들기</button>} />
          ) : (
            <div className="workflow-table">
              <div className="table-header"><span>이름</span><span>단계 구성</span><span>상태</span><span>업데이트</span></div>
              {dashboard.workflows.slice(0, 5).map((workflow) => <WorkflowRow key={workflow.id} workflow={workflow} onClick={() => onOpenWorkflow(workflow)} />)}
            </div>
          )}
        </section>
        <section className="panel activity-panel">
          <div className="panel-heading"><div><h2>최근 실행</h2><p>Workflow 실행 기록</p></div><button className="text-button" onClick={onShowRuns}>전체 보기 <Icon name="arrow" size={14} /></button></div>
          {dashboard.recentRuns.length === 0 ? (
            <EmptyState icon="activity" title="실행 기록이 없습니다" description="Workflow 실행 이력이 여기에 표시됩니다." compact />
          ) : (
            <div className="run-list">{dashboard.recentRuns.slice(0, 5).map((run) => <RunRow key={run.id} run={run} onClick={() => {
              const workflow = dashboard.workflows.find((item) => item.id === run.workflowId);
              if (workflow) onOpenWorkflow(workflow);
            }} />)}</div>
          )}
        </section>
      </div>
      <footer className="page-footer"><span>ORBIT WORKFLOW PORTAL</span><span>로컬 개발 워크스페이스 <span className="footer-dot">·</span> v0.1</span></footer>
    </>
  );
}

function MetricCard({
  label,
  value,
  icon,
  caption,
  tone,
}: {
  label: string;
  value: number;
  icon: "workflow" | "activity" | "orbit" | "robot";
  caption: string;
  tone: string;
}) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon name={icon} size={17} /></span></div><div className="metric-value">{value.toString().padStart(2, "0")}</div><div className="metric-caption">{caption}</div></article>;
}

function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: "workflow" | "activity" | "robot";
  title: string;
  description: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return <div className={`empty-state${compact ? " compact" : ""}`}><div className="empty-icon"><Icon name={icon} size={19} /></div><strong>{title}</strong><p>{description}</p>{action}</div>;
}

function WorkflowRow({ workflow, onClick }: { workflow: Workflow; onClick: () => void }) {
  const count = workflow.definition.stages.reduce((total, stage) => total + stage.nodes.length, 0);
  return <button className="workflow-row" onClick={onClick}><span className="workflow-name-cell"><span className="workflow-type-icon"><Icon name="workflow" size={16} /></span><span><strong>{workflow.name}</strong><small>v{workflow.version}</small></span></span><span className="table-config">{count}개 노드 · 5단계</span><span><StatusBadge status={workflow.status} /></span><span className="table-date">{formatDate(workflow.updatedAt)}</span></button>;
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { draft: "초안", active: "활성", archived: "보관", queued: "대기", running: "실행 중", succeeded: "성공", failed: "실패", cancelled: "취소" };
  return <span className={`status-badge ${status}`}><span className="badge-dot" />{labels[status] ?? status}</span>;
}

function RunRow({ run, onClick }: { run: WorkflowRun; onClick: () => void }) {
  return <button className="run-row" onClick={onClick}><span className={`run-status-icon ${run.status}`}><Icon name={run.status === "succeeded" ? "arrow" : "activity"} size={14} /></span><span className="run-row-copy"><strong>{run.workflowName ?? "Workflow 실행"}</strong><small>v{run.workflowVersion} · {formatDate(run.startedAt)}</small></span><StatusBadge status={run.status} /></button>;
}

function WorkflowList({
  workflows,
  onCreate,
  onOpen,
}: {
  workflows: Workflow[];
  onCreate: () => void;
  onOpen: (workflow: Workflow) => void;
}) {
  return <><PageHeading eyebrow="WORKFLOW LIBRARY" title="Workflows" description="공통 다섯 단계에 Agent와 Work를 조합해 구성하고 실행합니다." action={<button className="button button-primary" onClick={onCreate}><Icon name="plus" size={16} /> Workflow 만들기</button>} /><section className="panel full-panel">{workflows.length === 0 ? <EmptyState icon="workflow" title="Workflow가 없습니다" description="고정된 다섯 단계에 필요한 Agent와 Work를 배치하세요." action={<button className="button button-outline" onClick={onCreate}><Icon name="plus" size={15} /> Workflow 만들기</button>} /> : <div className="workflow-table"><div className="table-header"><span>이름</span><span>단계 구성</span><span>상태</span><span>업데이트</span></div>{workflows.map((workflow) => <WorkflowRow key={workflow.id} workflow={workflow} onClick={() => onOpen(workflow)} />)}</div>}</section></>;
}

function AgentsPage({
  agents,
  settings,
  onRefresh,
  onSaveSettings,
  onCreateAgent,
  onUpdateAgent,
  onDeleteAgent,
}: {
  agents: AgentAvailability[];
  settings: AgentSettingsMap;
  onRefresh: () => void;
  onCreateAgent: (agent: AgentInput) => Promise<void>;
  onUpdateAgent: (id: string, agent: AgentInput) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  onSaveSettings: (
    agentId: WorkflowAgentId,
    settings: AgentSettingsMap[WorkflowAgentId],
  ) => Promise<void>;
}) {
  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentAvailability | null>(null);
  const [editingSettingsId, setEditingSettingsId] = useState<WorkflowAgentId | null>(null);
  const [error, setError] = useState("");

  return (
    <>
      <PageHeading
        eyebrow="AGENT CATALOG"
        title="Agents"
        description="Agent를 등록하고, 다섯 단계 중 담당 유형을 지정해 Workflow에서 사용합니다."
        action={
          <div className="agent-page-actions">
            <button className="button button-outline" onClick={onRefresh}>연결 상태 새로고침</button>
            <button className="button button-primary" onClick={() => { setEditingAgent(null); setAgentFormOpen(true); }}>
              <Icon name="plus" size={15} /> Agent 등록
            </button>
          </div>
        }
      />
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="agent-grid">
        {agents.map((agent) => {
          const definition = workflowAgents.find((item) => item.id === agent.id);
          const stage = workflowStages.find((item) => item.id === agent.stageId)!;
          const available = agent.status === "available";
          return (
            <article className="agent-card" key={agent.id}>
              <div className="agent-card-top">
                <span className="agent-icon"><Icon name="robot" size={19} /></span>
                <span className={`agent-health ${available ? "available" : "unavailable"}`}>
                  <span className="status-dot" />{available ? "사용 가능" : "연결 안 됨"}
                </span>
              </div>
              <span className="agent-stage">{stage.label}</span>
              <h2>{agent.name}</h2>
              <p>{agent.description || "설명이 없습니다."}</p>
              <div className="agent-card-meta">
                <span>REST · {agent.baseUrl}{agent.executionPath}</span>
                <code>{agent.id}</code>
              </div>
              {!available && agent.error && <div className="agent-error">{agent.error}</div>}
              <div className="agent-card-actions">
                <button className="button button-outline" onClick={() => { setEditingAgent(agent); setAgentFormOpen(true); }}>
                  수정
                </button>
                {definition && (
                  <button className="button button-outline" onClick={() => setEditingSettingsId(definition.id)}>
                    세부 옵션
                  </button>
                )}
                <button
                  className="button button-quiet agent-delete-button"
                  onClick={async () => {
                    if (!window.confirm(`"${agent.name}" Agent를 삭제할까요?`)) return;
                    setError("");
                    try {
                      await onDeleteAgent(agent.id);
                    } catch (reason) {
                      setError(reason instanceof Error ? reason.message : "Agent를 삭제하지 못했습니다.");
                    }
                  }}
                >
                  삭제
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {agents.length === 0 && <EmptyState icon="robot" title="등록된 Agent가 없습니다" description="Agent를 등록해 Workflow 단계에서 사용할 수 있습니다." />}
      <section className="knowledge-agent-section">
        <div className="knowledge-agent-heading">
          <div>
            <span className="eyebrow">KNOWLEDGE CATALOG</span>
            <h2>지식 Agents</h2>
            <p>각 Workflow 단계에 연결하면 해당 단계의 실행 Agent 입력 컨텍스트로 전달됩니다.</p>
          </div>
          <span className="knowledge-agent-count">{knowledgeAgents.length}개 분야</span>
        </div>
        <div className="knowledge-agent-grid">
          {knowledgeAgents.map((knowledgeAgent) => (
            <article className="knowledge-agent-card" key={knowledgeAgent.id}>
              <span className="knowledge-agent-type">{knowledgeAgent.type}</span>
              <h3>{knowledgeAgent.name}</h3>
              <p>{knowledgeAgent.description}</p>
            </article>
          ))}
        </div>
        <p className="knowledge-agent-note">현재는 분야별 기본 지침 프로필이며, 사내 문서 검색·지식베이스 연동은 포함하지 않습니다.</p>
      </section>
      {agentFormOpen && (
        <AgentEditorDialog
          agent={editingAgent}
          onClose={() => setAgentFormOpen(false)}
          onSave={async (value) => {
            if (editingAgent) await onUpdateAgent(editingAgent.id, value);
            else await onCreateAgent(value);
            setAgentFormOpen(false);
          }}
        />
      )}
      {editingSettingsId && (
        <AgentSettingsDialog
          key={editingSettingsId}
          agentId={editingSettingsId}
          agentName={workflowAgents.find((item) => item.id === editingSettingsId)!.name}
          settings={settings[editingSettingsId]}
          onClose={() => setEditingSettingsId(null)}
          onSave={onSaveSettings}
        />
      )}
    </>
  );
}

function AgentEditorDialog({
  agent,
  onClose,
  onSave,
}: {
  agent: AgentAvailability | null;
  onClose: () => void;
  onSave: (value: AgentInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AgentInput>(() => ({
    stageId: agent?.stageId ?? "planning",
    name: agent?.name ?? "",
    description: agent?.description ?? "",
    baseUrl: agent?.baseUrl ?? "http://127.0.0.1:4326",
    executionPath: agent?.executionPath ?? "/run",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Agent를 저장하지 못했습니다.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form className="modal agent-settings-modal" onSubmit={(event) => void submit(event)}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">AGENT CATALOG</span>
            <h2>{agent ? "Agent 수정" : "Agent 등록"}</h2>
            <p>Agent가 응답하는 단계 유형과 REST 주소를 설정합니다.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기" disabled={saving}>×</button>
        </div>
        <label className="form-field">
          <span>단계 유형</span>
          <select value={draft.stageId} onChange={(event) => setDraft({ ...draft, stageId: event.target.value as AgentInput["stageId"] })}>
            {workflowStages.map((stage) => <option value={stage.id} key={stage.id}>{stage.label}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span>Agent 이름</span>
          <input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="form-field">
          <span>설명</span>
          <textarea maxLength={500} rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
        <label className="form-field">
          <span>서비스 주소</span>
          <input required type="url" placeholder="http://127.0.0.1:4326" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} />
          <small className="agent-url-hint">상태 확인에는 서비스 주소의 /health 경로를 사용합니다.</small>
        </label>
        <label className="form-field">
          <span>실행 경로</span>
          <input required placeholder="/run" value={draft.executionPath} onChange={(event) => setDraft({ ...draft, executionPath: event.target.value })} />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button button-quiet" onClick={onClose} disabled={saving}>취소</button>
          <button type="submit" className="button button-primary" disabled={saving}>{saving ? "저장 중..." : "Agent 저장"}</button>
        </div>
      </form>
    </div>
  );
}

type AgentSettingValue = AgentSettingsMap[WorkflowAgentId];

function AgentSettingsDialog({
 agentId,
 agentName,
 settings,
 onClose,
 onSave,
}: {
 agentId: WorkflowAgentId;
 agentName: string;
 settings: AgentSettingValue;
 onClose: () => void;
 onSave: (
   agentId: WorkflowAgentId,
   settings: AgentSettingValue,
 ) => Promise<void>;
}) {
 const [draft, setDraft] = useState(settings);
 const [saving, setSaving] = useState(false);
 const [error, setError] = useState("");

 const submit = async (event: React.FormEvent<HTMLFormElement>) => {
   event.preventDefault();
   setSaving(true);
   setError("");
   try {
     await onSave(agentId, draft);
     onClose();
   } catch (reason) {
     setError(reason instanceof Error ? reason.message : "Agent 설정을 저장하지 못했습니다.");
     setSaving(false);
   }
 };

 return (
   <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
     <form className="modal agent-settings-modal" onSubmit={(event) => void submit(event)}>
       <div className="modal-heading">
         <div>
           <span className="eyebrow">AGENT SETTINGS</span>
           <h2>{agentName} 세부 옵션</h2>
           <p>저장한 설정은 모든 Workflow에서 공통으로 사용됩니다.</p>
         </div>
         <button type="button" className="modal-close" onClick={onClose} aria-label="닫기" disabled={saving}>×</button>
       </div>
       <AgentSettingsFields
         settings={draft}
         onChange={(next) => setDraft(next)}
       />
       {error && <div className="form-error" role="alert">{error}</div>}
       <div className="modal-actions">
         <button type="button" className="button button-quiet" onClick={onClose} disabled={saving}>취소</button>
         <button type="submit" className="button button-primary" disabled={saving}>
           {saving ? "저장 중..." : "설정 저장"}
         </button>
       </div>
     </form>
   </div>
 );
}

function AgentSettingsFields({
 settings,
 onChange,
}: {
 settings: AgentSettingValue;
 onChange: (settings: AgentSettingValue) => void;
}) {
 if ("outputLanguage" in settings) {
   return (
     <>
       <label className="form-field">
         <span>출력 언어</span>
         <select
           value={settings.outputLanguage}
           onChange={(event) => onChange({
             ...settings,
             outputLanguage: event.target.value === "en" ? "en" : "ko",
           })}
         >
           <option value="ko">한국어</option>
           <option value="en">English</option>
         </select>
       </label>
       <label className="form-field">
         <span>정리 상세도</span>
         <select
           value={settings.detailLevel}
           onChange={(event) => onChange({
             ...settings,
             detailLevel: event.target.value === "concise" ? "concise" : "detailed",
           })}
         >
           <option value="concise">간결하게</option>
           <option value="detailed">상세하게</option>
         </select>
       </label>
     </>
   );
 }

 if ("engine" in settings) {
   return (
     <label className="form-field">
       <span>설계 엔진</span>
       <select
         value={settings.engine}
         onChange={(event) => onChange({
           ...settings,
           engine: event.target.value === "template" ? "template" : "claude-cli",
         })}
       >
         <option value="claude-cli">Claude CLI</option>
         <option value="template">템플릿 (즉시 실행)</option>
       </select>
     </label>
   );
 }

 if ("durationSec" in settings) {
   return (
     <>
       <SettingsNumberField label="기본 시간 (초)" value={settings.durationSec} min="0.1" max="60" step="0.1" onChange={(value) => onChange({ ...settings, durationSec: value })} />
       <SettingsNumberField label="기본 선속도 (m/s)" value={settings.linearVelocity} min="-1" max="1" step="0.05" onChange={(value) => onChange({ ...settings, linearVelocity: value })} />
       <SettingsNumberField label="기본 각속도 (rad/s)" value={settings.angularVelocity} min="-3.14" max="3.14" step="0.01" onChange={(value) => onChange({ ...settings, angularVelocity: value })} />
       <SettingsNumberField label="기본 시간 간격 (초)" value={settings.timeStep} min="0.02" max="0.5" step="0.01" onChange={(value) => onChange({ ...settings, timeStep: value })} />
     </>
   );
 }

 if ("packageSuffix" in settings) {
   return (
     <>
       <label className="form-field">
         <span>ROS 2 패키지 이름 접미사</span>
         <input
           required
           maxLength={21}
           pattern="[a-z][a-z0-9_]{0,20}"
           value={settings.packageSuffix}
           onChange={(event) => onChange({ ...settings, packageSuffix: event.target.value })}
         />
         <small className="field-hint">소문자 영문자로 시작하며 영문자, 숫자, 밑줄을 사용할 수 있습니다.</small>
       </label>
       <label className="form-field">
         <span>ROS 2 배포판</span>
         <input
           required
           maxLength={31}
           pattern="[a-z][a-z0-9_-]{0,30}"
           value={settings.rosDistro}
           onChange={(event) => onChange({ ...settings, rosDistro: event.target.value })}
         />
       </label>
     </>
   );
 }

 return (
   <label className="form-field">
     <span>검사 강도</span>
     <select
       value={settings.strictness}
       onChange={(event) => onChange({
         ...settings,
         strictness: event.target.value === "strict" ? "strict" : "standard",
       })}
     >
       <option value="standard">표준 — 오류만 실패 처리</option>
       <option value="strict">엄격 — 경고도 실패 처리</option>
     </select>
   </label>
 );
}

function SettingsNumberField({
 label,
 value,
 min,
 max,
 step,
 onChange,
}: {
 label: string;
 value: number;
 min: string;
 max: string;
 step: string;
 onChange: (value: number) => void;
}) {
 return (
   <label className="form-field">
     <span>{label}</span>
     <input
       type="number"
       required
       value={value}
       min={min}
       max={max}
       step={step}
       onChange={(event) => onChange(Number(event.target.value))}
     />
   </label>
 );
}

function WorkflowDetail({
  workflow,
  agents,
  simulationSettings,
  runs,
  onBack,
  onRun,
  onSaveDefinition,
}: {
  workflow: Workflow;
  agents: AgentAvailability[];
  simulationSettings: AgentSettingsMap["simulation"];
  runs: WorkflowRun[];
  onBack: () => void;
  onRun: (input: PrototypeRunInput) => Promise<WorkflowRun>;
  onSaveDefinition: (definition: WorkflowDefinition) => Promise<void>;
}) {
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runs[0]?.id ?? null);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;

  useEffect(() => {
    if (!runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id ?? null);
    }
  }, [runs, selectedRunId]);

  return (
    <>
      <button className="back-link" onClick={onBack}>← Workflow 목록</button>
      <PageHeading
        eyebrow="WORKFLOW DEFINITION"
        title={workflow.name}
        description={workflow.description || "고정된 다섯 단계 안에 Agent와 Work를 조합한 Workflow입니다."}
        action={
          <div className="workflow-actions">
            <button className="button button-outline" onClick={() => setShowBuilder(true)}>
              단계 구성 편집
            </button>
            <button className="button button-primary" onClick={() => setShowRunDialog(true)} disabled={!workflow.definition.stages.some((stage) => stage.nodes.length > 0)}>
              <Icon name="robot" size={15} /> Workflow 실행
            </button>
            <StatusBadge status={workflow.status} />
          </div>
        }
      />
      <div className="detail-meta">
        <span>버전 <strong>v{workflow.version}</strong></span>
        <span>생성일 <strong>{formatDate(workflow.createdAt)}</strong></span>
        <span>최근 수정 <strong>{formatDate(workflow.updatedAt)}</strong></span>
      </div>
      <div className="detail-grid">
        <section className="panel graph-panel">
          <div className="panel-heading">
            <div><h2>Workflow 단계</h2><p>이 Workflow의 고정 단계별 Agent와 Work 구성</p></div>
            <span className="coming-soon">5개 고정 단계</span>
          </div>
          <WorkflowStageView definition={workflow.definition} agents={agents} />
          <p className="prototype-note">
            Agent는 로컬 REST 앱으로 실행됩니다. Work 노드는 앞선 입력이나 실행 결과에서 값을 선택해 다른 입력 필드로 전달합니다.
          </p>
        </section>
        <section className="panel detail-runs">
          <div className="panel-heading">
            <div><h2>실행 이력</h2><p>이 Workflow의 최근 실행</p></div>
            <span className="run-count">{runs.length}</span>
          </div>
          {runs.length === 0 ? (
            <EmptyState icon="activity" title="아직 실행 기록이 없습니다" description="프로토타입 실행 결과가 여기에 표시됩니다." compact />
          ) : (
            <div className="run-list">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} onClick={() => setSelectedRunId(run.id)} />
              ))}
            </div>
          )}
        </section>
      </div>
      {selectedRun && <RunResult run={selectedRun} />}
      {showBuilder && (
        <WorkflowBuilderDialog
          definition={workflow.definition}
          agents={agents}
          onClose={() => setShowBuilder(false)}
          onSave={async (definition) => {
            await onSaveDefinition(definition);
            setShowBuilder(false);
          }}
        />
      )}
      {showRunDialog && (
        <RunDialog
          workflowName={workflow.name}
          simulationSettings={simulationSettings}
          onClose={() => setShowRunDialog(false)}
          onRun={async (input) => {
            const run = await onRun(input);
            setSelectedRunId(run.id);
            setShowRunDialog(false);
            return run;
          }}
        />
      )}
    </>
  );
}

function nodeLabel(node: WorkflowNode, agents: AgentAvailability[]) {
  return node.kind === "agent"
    ? agents.find((agent) => agent.id === node.agent)?.name ?? node.agent
    : node.name;
}

function WorkflowStageView({
  definition,
  agents,
}: {
  definition: WorkflowDefinition;
  agents: AgentAvailability[];
}) {
  return (
    <div className="workflow-stage-view">
      {workflowStages.map((stage, index) => {
        const configuredStage = definition.stages.find((item) => item.id === stage.id);
        const nodes = configuredStage?.nodes ?? [];
        const connectedKnowledgeAgents = knowledgeAgents.filter((agent) =>
          configuredStage?.knowledgeAgentIds.includes(agent.id),
        );
        return (
          <section className="workflow-stage-view-card" key={stage.id}>
            <span className="stage-index">{String(index + 1).padStart(2, "0")}</span>
            <strong>{stage.label}</strong>
            {nodes.length === 0 ? (
              <small className="stage-empty">아직 구성되지 않음</small>
            ) : (
              <div className="stage-node-list">
                {nodes.map((node) => <span className={`stage-node ${node.kind}`} key={node.id}>{nodeLabel(node, agents)}</span>)}
              </div>
            )}
            <div className="stage-knowledge-list">
              <small>지식 Agent</small>
              {connectedKnowledgeAgents.length > 0
                ? connectedKnowledgeAgents.map((agent) => <span key={agent.id}>{agent.type}</span>)
                : <small>연결 없음</small>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function WorkflowBuilderDialog({
  definition,
  agents,
  onClose,
  onSave,
}: {
  definition: WorkflowDefinition;
  agents: AgentAvailability[];
  onClose: () => void;
  onSave: (definition: WorkflowDefinition) => Promise<void>;
}) {
  const [draft, setDraft] = useState<WorkflowDefinition>(() => structuredClone(definition));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedAgentByStage, setSelectedAgentByStage] = useState<Record<string, string>>({});

  const updateStage = (
    stageId: WorkflowDefinition["stages"][number]["id"],
    update: (nodes: WorkflowNode[]) => WorkflowNode[],
  ) => {
    setDraft((current) => ({
      ...current,
      stages: current.stages.map((stage) =>
        stage.id === stageId ? { ...stage, nodes: update(stage.nodes) } : stage,
      ),
    }));
  };
  const updateStageKnowledge = (
    stageId: WorkflowDefinition["stages"][number]["id"],
    knowledgeAgentId: KnowledgeAgentId,
    connected: boolean,
  ) => {
    setDraft((current) => ({
      ...current,
      stages: current.stages.map((stage) => {
        if (stage.id !== stageId) return stage;
        const selected = new Set(stage.knowledgeAgentIds);
        if (connected) selected.add(knowledgeAgentId);
        else selected.delete(knowledgeAgentId);
        return { ...stage, knowledgeAgentIds: [...selected] };
      }),
    }));
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Workflow 단계를 저장하지 못했습니다.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form className="modal workflow-builder-modal" onSubmit={(event) => void submit(event)}>
        <div className="modal-heading">
          <div><span className="eyebrow">WORKFLOW COMPOSER</span><h2>단계 구성</h2><p>다섯 단계별 실행 Agent·Work 흐름과 지식 Agent 연결을 설정합니다.</p></div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기" disabled={saving}>×</button>
        </div>
        <div className="workflow-builder-stages">
          {workflowStages.map((stage, stageIndex) => {
            const configuredStage = draft.stages.find((item) => item.id === stage.id);
            const nodes = configuredStage?.nodes ?? [];
            const selectedKnowledgeAgents = new Set(configuredStage?.knowledgeAgentIds ?? []);
            const stageAgents = agents.filter((item) => item.stageId === stage.id);
            const preferredAgentId = selectedAgentByStage[stage.id];
            const selectedAgentId = preferredAgentId && stageAgents.some((item) => item.id === preferredAgentId)
              ? preferredAgentId
              : stageAgents[0]?.id ?? "";
            return (
              <section className="workflow-builder-stage" key={stage.id}>
                <header><span>{String(stageIndex + 1).padStart(2, "0")}</span><strong>{stage.label}</strong></header>
                <div className="workflow-builder-nodes">
                  {nodes.length === 0 && <p className="builder-empty">이 단계에 노드를 추가하세요.</p>}
                  {nodes.map((node, nodeIndex) => (
                    <article className="builder-node" key={node.id} data-node-id={node.id}>
                      <div className="builder-node-heading">
                        {node.kind === "agent" ? (
                          <span className="builder-agent-label">
                            <Icon name="robot" size={13} />
                            <select
                              aria-label="Agent 선택"
                              value={node.agent}
                              onChange={(event) => updateStage(stage.id, (items) => items.map((item) => item.id === node.id && item.kind === "agent" ? { ...item, agent: event.target.value } : item))}
                            >
                              {stageAgents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}
                            </select>
                          </span>
                        ) : (
                          <input aria-label="Work 이름" value={node.name} maxLength={100} onChange={(event) => updateStage(stage.id, (items) => items.map((item) => item.id === node.id && item.kind === "work" ? { ...item, name: event.target.value } : item))} />
                        )}
                        <div className="builder-node-actions">
                          <button type="button" aria-label="위로 이동" disabled={nodeIndex === 0} onClick={() => updateStage(stage.id, (items) => { const next = [...items]; [next[nodeIndex - 1], next[nodeIndex]] = [next[nodeIndex]!, next[nodeIndex - 1]!]; return next; })}>↑</button>
                          <button type="button" aria-label="아래로 이동" disabled={nodeIndex === nodes.length - 1} onClick={() => updateStage(stage.id, (items) => { const next = [...items]; [next[nodeIndex], next[nodeIndex + 1]] = [next[nodeIndex + 1]!, next[nodeIndex]!]; return next; })}>↓</button>
                          <button type="button" aria-label="노드 삭제" onClick={() => updateStage(stage.id, (items) => items.filter((item) => item.id !== node.id))}>×</button>
                        </div>
                      </div>
                      {(node.kind === "work" || (node.kind === "agent" && node.inputMappings.length > 0)) && (
                        <div className="builder-mappings">
                          {(node.kind === "work" ? node.mappings : node.inputMappings).map((mapping, mappingIndex) => (
                            <div className="builder-mapping" key={`${node.id}-${mappingIndex}`}>
                              <input aria-label="대상 필드" value={mapping.target} placeholder="대상 필드" onChange={(event) => updateStage(stage.id, (items) => items.map((item) => {
                                if (item.id !== node.id) return item;
                                const mappings = node.kind === "work" ? item.kind === "work" ? item.mappings : [] : item.kind === "agent" ? item.inputMappings : [];
                                const updated = mappings.map((current, index) => index === mappingIndex ? { ...current, target: event.target.value } : current);
                                return item.kind === "work" ? { ...item, mappings: updated } : item.kind === "agent" ? { ...item, inputMappings: updated } : item;
                              }))} />
                              <span>←</span>
                              <input aria-label="원본 경로" value={mapping.source} placeholder="input.requirements.robotName" onChange={(event) => updateStage(stage.id, (items) => items.map((item) => {
                                if (item.id !== node.id) return item;
                                const mappings = node.kind === "work" ? item.kind === "work" ? item.mappings : [] : item.kind === "agent" ? item.inputMappings : [];
                                const updated = mappings.map((current, index) => index === mappingIndex ? { ...current, source: event.target.value } : current);
                                return item.kind === "work" ? { ...item, mappings: updated } : item.kind === "agent" ? { ...item, inputMappings: updated } : item;
                              }))} />
                              <button type="button" aria-label="매핑 삭제" onClick={() => updateStage(stage.id, (items) => items.map((item) => {
                                if (item.id !== node.id) return item;
                                return item.kind === "work"
                                  ? { ...item, mappings: item.mappings.filter((_, index) => index !== mappingIndex) }
                                  : { ...item, inputMappings: item.inputMappings.filter((_, index) => index !== mappingIndex) };
                              }))}>×</button>
                            </div>
                          ))}
                          <button type="button" className="text-button" onClick={() => updateStage(stage.id, (items) => items.map((item) => {
                            if (item.id !== node.id) return item;
                            const mapping = { target: node.kind === "work" ? "value" : "requirements.designBrief", source: "input.requirements.robotName" };
                            return item.kind === "work" ? { ...item, mappings: [...item.mappings, mapping] } : { ...item, inputMappings: [...item.inputMappings, mapping] };
                          }))}>매핑 추가</button>
                        </div>
                      )}
                      {node.kind === "agent" && node.inputMappings.length === 0 && <button type="button" className="text-button" onClick={() => updateStage(stage.id, (items) => items.map((item) => item.id === node.id && item.kind === "agent" ? { ...item, inputMappings: [{ target: stage.id === "design" ? "requirements.designBrief" : "urdf", source: "input.requirements.designBrief" }] } : item))}>입력 매핑 추가</button>}
                    </article>
                  ))}
                </div>
                <div className="knowledge-stage-picker">
                  <div className="knowledge-stage-picker-heading">
                    <strong>지식 Agent 연결</strong>
                    <small>{selectedKnowledgeAgents.size}개 선택됨 · 실행 Agent 컨텍스트로 전달</small>
                  </div>
                  <div className="knowledge-stage-options">
                    {knowledgeAgents.map((knowledgeAgent) => (
                      <label key={knowledgeAgent.id}>
                        <input
                          type="checkbox"
                          checked={selectedKnowledgeAgents.has(knowledgeAgent.id)}
                          onChange={(event) => updateStageKnowledge(stage.id, knowledgeAgent.id, event.target.checked)}
                        />
                        <span>{knowledgeAgent.type}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <footer className="builder-add-actions">
                  <select
                    aria-label={`${stage.label} Agent 유형`}
                    value={selectedAgentId}
                    disabled={stageAgents.length === 0}
                    onChange={(event) => setSelectedAgentByStage((current) => ({ ...current, [stage.id]: event.target.value }))}
                  >
                    {stageAgents.length === 0
                      ? <option value="">등록된 Agent 없음</option>
                      : stageAgents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}{agent.status === "unavailable" ? " · 연결 안 됨" : ""}</option>)}
                  </select>
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={!selectedAgentId}
                    onClick={() => updateStage(stage.id, (items) => [...items, { id: crypto.randomUUID(), kind: "agent", agent: selectedAgentId, inputMappings: [] }])}
                  >
                    Agent 추가
                  </button>
                  <button type="button" className="button button-quiet" onClick={() => updateStage(stage.id, (items) => [...items, { id: crypto.randomUUID(), kind: "work", name: "데이터 변환", mappings: [{ target: "value", source: "input.requirements.robotName" }] }])}>Work 추가</button>
                </footer>
              </section>
            );
          })}
        </div>
        <p className="builder-help">원본 경로는 <code>input.requirements.robotName</code>, 이전 노드 결과는 <code>steps.노드ID.필드명</code> 형식입니다. Agent 입력 매핑의 대상 필드에는 해당 앱이 받는 JSON 필드를 입력하세요.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button button-quiet" onClick={onClose} disabled={saving}>취소</button>
          <button type="submit" className="button button-primary" disabled={saving || !draft.stages.some((stage) => stage.nodes.length > 0)}>{saving ? "저장 중..." : "단계 구성 저장"}</button>
        </div>
      </form>
    </div>
  );
}

function RunResult({ run }: { run: WorkflowRun }) {
  const design = run.output?.design;
  const validation = run.output?.validation;
  const simulation = run.output?.simulation;
  const metrics = toRecord(simulation?.metrics);
  const finalPose = toRecord(metrics?.finalPose);
  const urdf = typeof design?.urdf === "string" ? design.urdf : null;

  return (
    <section className="panel run-result">
      <div className="panel-heading">
        <div><h2>실행 결과</h2><p>{formatDate(run.startedAt)} · 실행 ID {run.id.slice(0, 8)}</p></div>
        <StatusBadge status={run.status} />
      </div>
      {run.errorSummary && <div className="run-error">{run.errorSummary}</div>}
      <div className="step-timeline">
        {(run.steps ?? []).map((step) => (
          <div className="step-item" key={step.id}>
            <span className={`step-marker ${step.status}`} />
            <div>
              <strong>{step.sequence}. {step.agent}</strong>
              <small>{step.errorSummary ?? formatDate(step.startedAt)}</small>
              {step.output && <details className="run-step-output"><summary>단계 결과 보기</summary><pre>{JSON.stringify(step.output, null, 2)}</pre></details>}
            </div>
            <StatusBadge status={step.status} />
          </div>
        ))}
      </div>
      <div className="result-cards">
        <article className="result-card">
          <span className="result-label">URDF 설계</span>
          <strong>{typeof design?.robotName === "string" ? design.robotName : "결과 없음"}</strong>
          {typeof design?.concept === "string" && <p>{design.concept}</p>}
          {urdf && <UrdfDownload urdf={urdf} />}
        </article>
        <article className="result-card">
          <span className="result-label">구조 검증</span>
          <strong>{validation?.valid === true ? "통과" : validation ? "검증 실패" : "대기"}</strong>
          <p>{typeof validation?.linkCount === "number" ? `${validation.linkCount} links · ${String(validation.jointCount)} joints` : "URDF 링크·조인트 구조 검사"}</p>
        </article>
        <article className="result-card">
          <span className="result-label">운동학 미리보기</span>
          <strong>{metrics?.passed === true ? "충돌 없음" : metrics ? "충돌 감지" : "대기"}</strong>
          <p>
            {typeof metrics?.distanceTravelled === "number"
              ? `이동 ${metrics.distanceTravelled.toFixed(2)} m`
              : "시뮬레이션 결과가 없습니다"}
            {typeof finalPose?.x === "number" && typeof finalPose?.y === "number" &&
              ` · 최종 위치 (${finalPose.x.toFixed(2)}, ${finalPose.y.toFixed(2)})`}
          </p>
        </article>
      </div>
    </section>
  );
}

function UrdfDownload({ urdf }: { urdf: string }) {
  const url = useMemo(
    () => URL.createObjectURL(new Blob([urdf], { type: "application/xml" })),
    [urdf],
  );
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  return (
    <details className="urdf-details">
      <summary>URDF 미리보기 · 다운로드</summary>
      <a className="text-button" href={url} download="robot.urdf">robot.urdf 다운로드</a>
      <pre>{urdf}</pre>
    </details>
  );
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function RunDialog({
  workflowName,
  simulationSettings,
  onClose,
  onRun,
}: {
  workflowName: string;
  simulationSettings: AgentSettingsMap["simulation"];
  onClose: () => void;
  onRun: (input: PrototypeRunInput) => Promise<WorkflowRun>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setError("");
    try {
      const number = (field: string) => {
        const value = data.get(field);
        if (typeof value !== "string" || value.trim() === "") {
          throw new Error(`${field} 값을 입력해 주세요.`);
        }
        return Number(value);
      };
      const robotName = data.get("robotName");
      const designBrief = data.get("designBrief");
      if (typeof robotName !== "string" || typeof designBrief !== "string") {
        throw new Error("로봇 설계 입력을 확인해 주세요.");
      }
      const input: PrototypeRunInput = {
        requirements: {
          robotName,
          designBrief,
          dimensions: {
            baseLength: number("baseLength"),
            baseWidth: number("baseWidth"),
            bodyHeight: number("bodyHeight"),
            wheelRadius: number("wheelRadius"),
            wheelWidth: number("wheelWidth"),
            wheelTrack: number("wheelTrack"),
            chassisMass: number("chassisMass"),
          },
        },
        scenario: {
          durationSec: number("durationSec"),
          linearVelocity: number("linearVelocity"),
          angularVelocity: number("angularVelocity"),
          timeStep: number("timeStep"),
          obstacles: [],
        },
      };
      await onRun(input);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Workflow를 실행하지 못했습니다.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form className="modal run-modal" onSubmit={(event) => void submit(event)}>
        <div className="modal-heading">
          <div><span className="eyebrow">WORKFLOW RUN</span><h2>Workflow 실행</h2><p>{workflowName}</p></div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기" disabled={saving}>×</button>
        </div>
        <label className="form-field"><span>로봇 이름 <b>*</b></span><input name="robotName" required maxLength={80} defaultValue="Mobile Rover" /></label>
        <label className="form-field"><span>설계 브리프</span><textarea name="designBrief" rows={2} maxLength={4000} defaultValue="실내 주행용 차동구동 로봇" /></label>
        <div className="run-input-heading">로봇 치수 (m, kg)</div>
        <div className="number-grid">
          <NumberField name="baseLength" label="차체 길이" defaultValue="0.42" min="0.15" max="2" step="0.01" />
          <NumberField name="baseWidth" label="차체 너비" defaultValue="0.32" min="0.15" max="2" step="0.01" />
          <NumberField name="bodyHeight" label="차체 높이" defaultValue="0.14" min="0.05" max="1" step="0.01" />
          <NumberField name="wheelRadius" label="바퀴 반경" defaultValue="0.075" min="0.03" max="0.4" step="0.005" />
          <NumberField name="wheelWidth" label="바퀴 너비" defaultValue="0.035" min="0.01" max="0.2" step="0.005" />
          <NumberField name="wheelTrack" label="바퀴 간격" defaultValue="0.28" min="0.08" max="1.8" step="0.01" />
          <NumberField name="chassisMass" label="차체 질량" defaultValue="8" min="0.5" max="200" step="0.5" />
        </div>
        <div className="run-input-heading">주행 시나리오</div>
        <div className="number-grid">
          <NumberField name="durationSec" label="시간 (초)" defaultValue={String(simulationSettings.durationSec)} min="0.1" max="60" step="0.1" />
          <NumberField name="linearVelocity" label="선속도 (m/s)" defaultValue={String(simulationSettings.linearVelocity)} min="-1" max="1" step="0.05" />
          <NumberField name="angularVelocity" label="각속도 (rad/s)" defaultValue={String(simulationSettings.angularVelocity)} min="-3.14" max="3.14" step="0.01" />
          <NumberField name="timeStep" label="시간 간격 (초)" defaultValue={String(simulationSettings.timeStep)} min="0.02" max="0.5" step="0.01" />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <p className="run-hint">설계 엔진이 Claude CLI이면 응답까지 시간이 걸릴 수 있습니다. 템플릿 엔진은 즉시 실행됩니다.</p>
        <div className="modal-actions">
          <button type="button" className="button button-quiet" onClick={onClose} disabled={saving}>취소</button>
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? "단계 실행 중..." : "실행 시작"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NumberField({
  name,
  label,
  defaultValue,
  min,
  max,
  step,
}: {
  name: string;
  label: string;
  defaultValue: string;
  min: string;
  max: string;
  step: string;
}) {
  return (
    <label className="form-field">
      <span>{label} <b>*</b></span>
      <input name={name} type="number" required defaultValue={defaultValue} min={min} max={max} step={step} />
    </label>
  );
}

function RunList({ runs, workflows, onOpenWorkflow }: { runs: WorkflowRun[]; workflows: Workflow[]; onOpenWorkflow: (workflow: Workflow) => void }) {
  return <><PageHeading eyebrow="EXECUTION HISTORY" title="실행 이력" description="Workflow의 실행 상태와 결과를 확인합니다." /><section className="panel full-panel">{runs.length === 0 ? <EmptyState icon="activity" title="실행 이력이 없습니다" description="Workflow 실행 기록이 생성되면 상태와 결과를 여기서 확인할 수 있습니다." /> : <div className="run-list run-list-page">{runs.map((run) => <RunRow key={run.id} run={run} onClick={() => { const workflow = workflows.find((item) => item.id === run.workflowId); if (workflow) onOpenWorkflow(workflow); }} />)}</div>}</section></>;
}

function CreateDialog({
  onClose,
  onCreateWorkflow,
}: {
  onClose: () => void;
  onCreateWorkflow: (values: { name: string; description: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onCreateWorkflow({ name, description });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "저장하지 못했습니다.");
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><form className="modal" onSubmit={(event) => void submit(event)}><div className="modal-heading"><div><span className="eyebrow">NEW WORKFLOW</span><h2>Workflow 만들기</h2><p>다섯 단계가 포함된 Workflow를 생성합니다. Agent와 Work는 생성 후 단계 구성에서 설정할 수 있습니다.</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="닫기" disabled={saving}>×</button></div><label className="form-field"><span>이름 <b>*</b></span><input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 차동구동 로봇 개발" /></label><label className="form-field"><span>설명</span><textarea rows={3} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Workflow의 목적을 입력하세요." /></label>{error && <div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>취소</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "저장 중..." : "Workflow 생성"}</button></div></form></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

export default App;
