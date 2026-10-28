import { EXIT_CODE } from "#core/exit-codes.js";
import { Command } from "commander";
import { CLI_NAME } from "#core/constants.js";
import { CLI_VERSION } from "./version.gen.js";
import { registerReporterHook } from "./program-reporter-hook.js";
import { registerCoreCommands } from "./program-core.js";
import { registerArchCommands } from "./program-arch.js";
import { registerMissionCommands } from "./program-mission.js";
import { registerWorkflowCommands } from "./program-workflow.js";
import { registerOrgControlPlaneCommands } from "./program-org.js";
import { registerMcpCommands } from "./program-mcp.js";
import { registerCageCommands } from "./program-cage.js";
import { registerHookCommands } from "./program-hook.js";
import { registerCiCommands } from "./program-ci.js";
import { registerMigrateCommands } from "./program-migrate.js";

export function buildProgram(): Command {
  const program = new Command();
  program.enablePositionalOptions(true);
  program.name(CLI_NAME).description("OpenGantry GXT CLI").version(CLI_VERSION);
  program.exitOverride((err) => {
    if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
      return;
    }
    if (err.code === "commander.invalidArgument") {
      process.exitCode = EXIT_CODE.USAGE;
    }
    throw err;
  });
  program.option(
    "--audience <role>",
    "Tailor stdout/stderr: executor|planner|verifier|platform (also GANTRY_AUDIENCE env)",
  );
  registerReporterHook(program);

  registerCoreCommands(program);
  registerArchCommands(program);
  registerMissionCommands(program);
  registerWorkflowCommands(program);
  registerOrgControlPlaneCommands(program);
  registerMcpCommands(program);
  registerCageCommands(program);
  registerHookCommands(program);
  registerCiCommands(program);
  registerMigrateCommands(program);

  return program;
}
