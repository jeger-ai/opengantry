import { Command } from "commander";
import { CLI_NAME, CLI_VERSION } from "./lib/constants.js";
import { registerAudiencePreActionHook } from "./lib/program-audience-hook.js";
import { registerCoreCommands } from "./program-core.js";
import { registerArchCommands } from "./program-arch.js";
import { registerMissionCommands } from "./program-mission.js";
import { registerWorkflowCommands } from "./program-workflow.js";
import { registerMcpCommands } from "./program-mcp.js";
import { registerPlannerCommands } from "./program-planner.js";

export { CLI_VERSION } from "./lib/constants.js";

export function buildProgram(): Command {
  const program = new Command();
  program.enablePositionalOptions(true);
  program.name(CLI_NAME).description("OpenGantry GXT CLI (MVP)").version(CLI_VERSION);
  program.option(
    "--audience <role>",
    "Tailor stdout/stderr: executor|planner|verifier|platform (also GXT_AUDIENCE env)",
  );
  registerAudiencePreActionHook(program);

  registerCoreCommands(program);
  registerArchCommands(program);
  registerMissionCommands(program);
  registerWorkflowCommands(program);
  registerMcpCommands(program);
  registerPlannerCommands(program);

  return program;
}
