import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { defaultAgentSettings, workflowAgents } from "@workflow/shared";
import { databaseSchema } from "./database.schema.js";

@Injectable()
export class DatabaseService extends Pool implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private readonly config: ConfigService) {
    super({
      host: config.get("POSTGRES_HOST", "127.0.0.1"),
      port: Number(config.get("POSTGRES_PORT", "5432")),
      database: config.get("POSTGRES_DB", "workflow_portal"),
      user: config.get("POSTGRES_USER") || process.env.USER,
      password: config.get("POSTGRES_PASSWORD") || undefined,
      connectionTimeoutMillis: 5000,
      max: 10,
    });

    this.on("error", (error: Error) => {
      this.logger.error("Unexpected PostgreSQL pool error", error.stack);
    });
  }

  async onModuleInit(): Promise<void> {
    const client = await this.connect();
    try {
      await client.query("BEGIN");
      await client.query(databaseSchema);
      for (const agent of workflowAgents) {
        const baseUrl = this.config.get(
          `${agent.id.toUpperCase()}_AGENT_URL`,
          `http://127.0.0.1:${agent.port}`,
        ).replace(/\/$/, "");
        await client.query(
          `INSERT INTO agent_catalog
            (id, stage_id, name, description, base_url, execution_path, is_builtin)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)
           ON CONFLICT (id) DO NOTHING`,
          [
            agent.id,
            agent.stageId,
            agent.name,
            agent.description,
            baseUrl,
            agent.executionPath,
          ],
        );
        await client.query(
          `INSERT INTO agent_settings (agent_id, settings)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (agent_id) DO NOTHING`,
          [agent.id, JSON.stringify(defaultAgentSettings[agent.id])],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.end();
  }
}
