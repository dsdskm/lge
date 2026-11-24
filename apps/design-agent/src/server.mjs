import { startAgentServer } from "@workflow/agent-runtime";
import { designRobot } from "./design.mjs";

const port = Number(process.env.DESIGN_AGENT_PORT || 4321);
startAgentServer({
  name: "design-agent",
  port,
  routes: {
    "POST /design": designRobot,
  },
});
