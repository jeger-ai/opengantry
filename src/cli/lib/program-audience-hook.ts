import type { Command } from "commander";
import { CLI_NAME } from "./constants.js";
import { applyAudienceFromArgv, setJsonOutputMode } from "./output-context.js";
import { logError, setExitCode } from "./cli-io.js";

function rootCommand(cmd: Command): Command {
  let current: Command = cmd;
  while (current.parent) current = current.parent;
  return current;
}

function audienceRawFromArgv(actionCommand: Command): string | undefined {
  const actionOpts = actionCommand.opts() as { audience?: string };
  const rootOpts = rootCommand(actionCommand).opts() as { audience?: string };
  return actionOpts.audience ?? rootOpts.audience;
}

function jsonFlagFromArgv(actionCommand: Command): boolean {
  const actionOpts = actionCommand.opts() as { json?: boolean };
  if (actionOpts.json === true) return true;
  const rootOpts = rootCommand(actionCommand).opts() as { json?: boolean };
  return rootOpts.json === true;
}

/** Commander preAction: global/subcommand --audience and GXT_AUDIENCE env. */
export function registerAudiencePreActionHook(program: Command): void {
  program.hook("preAction", (_thisCommand, actionCommand) => {
    const raw = audienceRawFromArgv(actionCommand);
    const applied = applyAudienceFromArgv(raw);
    if (!applied.ok) {
      logError(
        `invalid --audience "${applied.invalidValue}" (expected executor|planner|verifier|platform)`,
      );
      setExitCode(2);
      throw new Error(`${CLI_NAME}: invalid audience`);
    }
    setJsonOutputMode(jsonFlagFromArgv(actionCommand));
  });
}
