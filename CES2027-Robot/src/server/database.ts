import { PrismaClient } from "@prisma/client";

import { config } from "./config";

export const database = new PrismaClient();

let runtimeSchemaPromise: Promise<void> | undefined;

export function ensureRuntimeSchema(): Promise<void> {
    runtimeSchemaPromise ??= (async () => {
        if (!Number.isInteger(config.vertexEmbeddingDimensions) || config.vertexEmbeddingDimensions <= 0) {
            throw new Error("VERTEX_EMBEDDING_DIMENSIONS must be a positive integer.");
        }
        await database.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector");
        await database.$executeRawUnsafe("ALTER TABLE files ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE");
        await database.$executeRawUnsafe("ALTER TABLE files DROP COLUMN IF EXISTS status");
        await database.$executeRawUnsafe("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'");
        await database.$executeRawUnsafe(`
                        DO $$
                        BEGIN
                            IF EXISTS (
                                SELECT 1 FROM information_schema.columns
                                WHERE table_name = 'document_chunks'
                                    AND column_name = 'embedding'
                                    AND udt_name = '_float8'
                            ) THEN
                                ALTER TABLE document_chunks
                                    ALTER COLUMN embedding TYPE vector(${config.vertexEmbeddingDimensions})
                                    USING ('[' || array_to_string(embedding, ',') || ']')::vector;
                            END IF;
                        END $$;
                `);
        await database.$executeRawUnsafe(`
                    ALTER TABLE document_chunks
                      ALTER COLUMN embedding TYPE vector(${config.vertexEmbeddingDimensions})
                      USING embedding::vector(${config.vertexEmbeddingDimensions})
                `);
        await database.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx ON document_chunks USING hnsw (embedding vector_cosine_ops)");
        await database.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS document_chunks_metadata_idx ON document_chunks USING gin (metadata)");
        await database.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS chat_history (
            id TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), question TEXT NOT NULL,
            answer TEXT, error TEXT, sources JSONB NOT NULL DEFAULT '[]'::jsonb,
            steps JSONB NOT NULL DEFAULT '[]'::jsonb
        )`);
        await database.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS chat_history_at_idx ON chat_history (at)");
        await database.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS video_jobs (
            id TEXT PRIMARY KEY, file_id TEXT NOT NULL UNIQUE, folder_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued', progress TEXT NOT NULL DEFAULT '처리 대기 중',
            error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await database.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS video_jobs_folder_id_created_at_idx ON video_jobs (folder_id, created_at)");
        await database.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS document_jobs (
            id TEXT PRIMARY KEY, file_id TEXT NOT NULL UNIQUE, folder_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued', progress TEXT NOT NULL DEFAULT '처리 대기 중',
            error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await database.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS document_jobs_folder_id_created_at_idx ON document_jobs (folder_id, created_at)");
    })();
    return runtimeSchemaPromise;
}
