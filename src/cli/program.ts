import { Command } from "commander";
import { CLI_NAME, CLI_VERSION } from "./lib/constants.js";
import { registerCoreCommands } from "./program-core.js";
import { registerArchCommands } from "./program-arch.js";
import { registerMissionCommands } from "./program-mission.js";
import { registerWorkflowCommands } from "./program-workflow.js";
import { registerMcpCommands } from "./program-mcp.js";
import { registerTeacherCommands } from "./program-teacher.js";

export { CLI_VERSION } from "./lib/constants.js";

export function buildProgram(): Command {
  const program = new Command();
  program.enablePositionalOptions(true);
  program.name(CLI_NAME).description("OpenGantry GXT CLI (MVP)").version(CLI_VERSION);

  registerCoreCommands(program);
  registerArchCommands(program);
  registerMissionCommands(program);
  registerWorkflowCommands(program);
  registerMcpCommands(program);
  registerTeacherCommands(program);

  return program;
}
