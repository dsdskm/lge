export const databaseSchema = `
  CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY,
    project_id UUID,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'active', 'archived')),
    version INTEGER NOT NULL DEFAULT 1,
    definition JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE workflows ALTER COLUMN project_id DROP NOT NULL;
  ALTER TABLE workflows
    ADD COLUMN IF NOT EXISTS definition JSONB NOT NULL DEFAULT '{}'::jsonb;

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id UUID PRIMARY KEY,
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    workflow_version INTEGER NOT NULL,
    status TEXT NOT NULL
      CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    error_summary TEXT,
    input JSONB NOT NULL DEFAULT '{}'::jsonb,
    output JSONB
  );

  ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS input JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS output JSONB;

  CREATE TABLE IF NOT EXISTS workflow_run_steps (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    agent TEXT NOT NULL,
    status TEXT NOT NULL
      CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    input JSONB NOT NULL,
    output JSONB,
    error_summary TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    UNIQUE (run_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS agent_settings (
    agent_id TEXT PRIMARY KEY
      CHECK (agent_id IN ('planning', 'design', 'simulation', 'implementation', 'validation')),
    settings JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS agent_catalog (
    id TEXT PRIMARY KEY,
    stage_id TEXT NOT NULL
      CHECK (stage_id IN ('planning', 'design', 'model-simulation', 'implementation', 'validation')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL,
    execution_path TEXT NOT NULL,
    is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_runs_workflow_started
    ON workflow_runs(workflow_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_run_steps_run_sequence
    ON workflow_run_steps(run_id, sequence);
`;
