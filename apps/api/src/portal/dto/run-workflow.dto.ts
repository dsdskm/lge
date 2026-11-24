import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

class RobotDimensionsDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.15)
  @Max(2)
  baseLength!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.15)
  @Max(2)
  baseWidth!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.05)
  @Max(1)
  bodyHeight!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.03)
  @Max(0.4)
  wheelRadius!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(0.2)
  wheelWidth!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.08)
  @Max(1.8)
  wheelTrack!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(200)
  chassisMass!: number;
}

class RobotRequirementsDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  robotName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  designBrief = "";

  @ValidateNested()
  @Type(() => RobotDimensionsDto)
  dimensions!: RobotDimensionsDto;
}

class ObstacleDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-100)
  @Max(100)
  x!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-100)
  @Max(100)
  y!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.05)
  @Max(10)
  radius!: number;
}

class SimulationScenarioDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(60)
  durationSec!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-1)
  @Max(1)
  linearVelocity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-3.14)
  @Max(3.14)
  angularVelocity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.02)
  @Max(0.5)
  timeStep!: number;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ObstacleDto)
  obstacles: ObstacleDto[] = [];
}

export class RunWorkflowDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RobotRequirementsDto)
  requirements!: RobotRequirementsDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => SimulationScenarioDto)
  scenario!: SimulationScenarioDto;
}
