import { Transform } from "class-transformer";
import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from "class-validator";
import { workflowStages } from "@workflow/shared";

const stageIds = workflowStages.map((stage) => stage.id);

export class UpdateAgentDto {
  @IsOptional()
  @IsIn(stageIds)
  stageId?: (typeof workflowStages)[number]["id"];

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsUrl({
    protocols: ["http", "https"],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\/(?:[A-Za-z0-9._~-]+\/?)*$/)
  @MaxLength(120)
  executionPath?: string;
}
