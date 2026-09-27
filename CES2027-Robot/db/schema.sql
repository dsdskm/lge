CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  updated TEXT NOT NULL,
  owner TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT
);

ALTER TABLE files DROP COLUMN IF EXISTS version;
ALTER TABLE files DROP COLUMN IF EXISTS status;
ALTER TABLE files ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS files_folder_name_idx ON files (folder_id, name);

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(768) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS document_chunks_file_idx ON document_chunks(file_id);
CREATE INDEX IF NOT EXISTS document_chunks_folder_idx ON document_chunks(folder_id);
CREATE INDEX IF NOT EXISTS document_chunks_metadata_idx ON document_chunks USING gin (metadata);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_chunks'
      AND column_name = 'embedding'
      AND udt_name = '_float8'
  ) THEN
    ALTER TABLE document_chunks
      ALTER COLUMN embedding TYPE vector(768)
      USING ('[' || array_to_string(embedding, ',') || ']')::vector;
  END IF;
END $$;

ALTER TABLE document_chunks
  ALTER COLUMN embedding TYPE vector(768)
  USING embedding::vector(768);

CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS storage_usage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  used_bytes BIGINT NOT NULL DEFAULT 0,
  total_bytes BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS system_prompts (
  key TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_history (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  question TEXT NOT NULL,
  answer TEXT,
  error TEXT,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS chat_history_at_idx ON chat_history (at);

CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL UNIQUE,
  folder_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress TEXT NOT NULL DEFAULT '처리 대기 중',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_jobs_folder_id_created_at_idx ON video_jobs (folder_id, created_at);

CREATE TABLE IF NOT EXISTS document_jobs (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL UNIQUE,
  folder_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress TEXT NOT NULL DEFAULT '처리 대기 중',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_jobs_folder_id_created_at_idx ON document_jobs (folder_id, created_at);

INSERT INTO system_prompts (key, content)
VALUES ('rag.default', '다음 문서 근거만 사용해 질문에 답변하세요. 근거가 없으면 모른다고 답변하세요.')
ON CONFLICT (key) DO NOTHING;