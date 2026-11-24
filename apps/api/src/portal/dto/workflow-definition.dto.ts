import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  ValidateNested,
} from "class-validator";
import { knowledgeAgents } from "@workflow/shared";
import type { KnowledgeAgentId } from "@workflow/shared";

const knowledgeAgentIds = knowledgeAgents.map((agent) => agent.id);

const stageIds = [
  "planning",
  "design",
  "model-simulation",
  "implementation",
  "validation",
] as const;

export class WorkflowMappingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  target!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  source!: string;
}

export class WorkflowNodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  id!: string;

  @IsIn(["agent", "work"])
  kind!: "agent" | "work";

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]{0,80}$/)
  agent?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => WorkflowMappingDto)
  mappings?: WorkflowMappingDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => WorkflowMappingDto)
  inputMappings?: WorkflowMappingDto[];
}

export class WorkflowStageDto {
  @IsIn(stageIds)
  id!: (typeof stageIds)[number];

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => WorkflowNodeDto)
  nodes!: WorkflowNodeDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(knowledgeAgents.length)
  @ArrayUnique()
  @IsIn(knowledgeAgentIds, { each: true })
  knowledgeAgentIds?: KnowledgeAgentId[];
}

export class WorkflowDefinitionDto {
  @IsArray()
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => WorkflowStageDto)
  stages!: WorkflowStageDto[];
}

export class UpdateWorkflowDefinitionDto {
  @IsObject()
  @ValidateNested()
  @Type(() => WorkflowDefinitionDto)
  definition!: WorkflowDefinitionDto;
}
