import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Put,
} from "@nestjs/common";
import { CreateWorkflowDto } from "./dto/create-workflow.dto.js";
import { CreateAgentDto } from "./dto/create-agent.dto.js";
import { RunWorkflowDto } from "./dto/run-workflow.dto.js";
import { UpdateAgentSettingsDto } from "./dto/update-agent-settings.dto.js";
import { UpdateAgentDto } from "./dto/update-agent.dto.js";
import { UpdateWorkflowDefinitionDto } from "./dto/workflow-definition.dto.js";
import { PortalService } from "./portal.service.js";

@Controller()
export class PortalController {
  constructor(
    @Inject(PortalService) private readonly portalService: PortalService,
  ) {}

  @Get("health")
  health() {
    return this.portalService.health();
  }

  @Get("dashboard")
  getDashboard() {
    return this.portalService.getDashboard();
  }

  @Get("agents")
  listAgents() {
    return this.portalService.listAgents();
  }

  @Post("agents")
  createAgent(@Body() body: CreateAgentDto) {
    return this.portalService.createAgent(body);
  }

  @Patch("agents/:id")
  updateAgent(@Param("id") id: string, @Body() body: UpdateAgentDto) {
    return this.portalService.updateAgent(id, body);
  }

  @Delete("agents/:id")
  deleteAgent(@Param("id") id: string) {
    return this.portalService.deleteAgent(id);
  }

  @Get("agent-settings")
  getAgentSettings() {
    return this.portalService.getAgentSettings();
  }

  @Put("agent-settings/:id")
  updateAgentSettings(
    @Param("id") id: string,
    @Body() body: UpdateAgentSettingsDto,
  ) {
    return this.portalService.updateAgentSettings(id, body.settings);
  }

  @Get("workflows")
  listWorkflows() {
    return this.portalService.listWorkflows();
  }

  @Post("workflows")
  createWorkflow(@Body() body: CreateWorkflowDto) {
    return this.portalService.createWorkflow(body);
  }

  @Patch("workflows/:id/definition")
  updateWorkflowDefinition(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: UpdateWorkflowDefinitionDto,
  ) {
    return this.portalService.updateWorkflowDefinition(id, body);
  }

  @Post("workflows/:id/runs")
  runWorkflow(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: RunWorkflowDto,
  ) {
    return this.portalService.runWorkflow(id, body);
  }

  @Get("workflows/:id/runs")
  listWorkflowRuns(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.portalService.listWorkflowRuns(id);
  }
}
