import { Command } from "commander";
import { CLI_NAME } from "./lib/constants.js";
import { registerCoreCommands } from "./program-core.js";
import { registerMissionCommands } from "./program-mission.js";
import { registerWorkflowCommands } from "./program-workflow.js";

export const CLI_VERSION = "0.8.1";

export function buildProgram(): Command {
  const program = new Command();
  program.enablePositionalOptions(true);
  program.name(CLI_NAME).description("OpenGantry GXT CLI (MVP)").version(CLI_VERSION);

  registerCoreCommands(program);
  registerMissionCommands(program);
  registerWorkflowCommands(program);

  return program;
}
