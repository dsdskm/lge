import { IsObject } from "class-validator";

export class UpdateAgentSettingsDto {
  @IsObject()
  settings!: Record<string, unknown>;
}
