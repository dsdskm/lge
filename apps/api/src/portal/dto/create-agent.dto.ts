import { Transform } from "class-transformer";
import {
  IsIn,
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from "class-validator";
import { workflowStages } from "@workflow/shared";

const stageIds = workflowStages.map((stage) => stage.id);

export class CreateAgentDto {
  @IsIn(stageIds)
  stageId!: (typeof workflowStages)[number]["id"];

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  description!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsUrl({
    protocols: ["http", "https"],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(300)
  baseUrl!: string;

  @IsString()
  @Matches(/^\/(?:[A-Za-z0-9._~-]+\/?)*$/)
  @MaxLength(120)
  executionPath!: string;
}
