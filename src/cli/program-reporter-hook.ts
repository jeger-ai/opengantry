import type { Command } from "commander";
import { EXIT_CODE } from "#core/exit-codes.js";
import { CLI_NAME } from "#core/constants.js";
import { logError, setExitCode } from "./output/cli-io.js";
import { reporterFromArgv, resetReporter, setReporter, type ReporterArgv } from "./output/reporter.js";

function rootCommand(cmd: Command): Command {
  let current: Command = cmd;
  while (current.parent) current = current.parent;
  return current;
}

/** --audience and --json from the subcommand or the root; --format from the subcommand only. */
function reporterArgv(actionCommand: Command): ReporterArgv {
  const action = actionCommand.opts() as ReporterArgv;
  const root = rootCommand(actionCommand).opts() as ReporterArgv;
  return {
    audience: action.audience ?? root.audience,
    json: action.json === true || root.json === true,
    format: action.format,
  };
}

/**
 * Commander preAction/postAction: the reporter of this run is built from --audience, --json and --format, and the
 * plain human reporter is back afterwards, also when the action throws, so commands run in one process (tests,
 * gantry hook) cannot leak a structured mode into the next.
 */
export function registerReporterHook(program: Command): void {
  program.hook("preAction", (_thisCommand, actionCommand) => {
    const built = reporterFromArgv(reporterArgv(actionCommand));
    if ("invalidAudience" in built) {
      logError(`invalid --audience "${built.invalidAudience}" (expected executor|planner|verifier|platform)`);
      setExitCode(EXIT_CODE.USAGE);
      throw new Error(`${CLI_NAME}: invalid audience`);
    }
    setReporter(built.reporter);
  });
  program.hook("postAction", () => resetReporter());

  const origParse = program.parse.bind(program);
  const origParseAsync = program.parseAsync.bind(program);
  program.parse = ((...args: Parameters<Command["parse"]>) => {
    try {
      return origParse(...args);
    } finally {
      resetReporter();
    }
  }) as Command["parse"];
  program.parseAsync = (async (...args: Parameters<Command["parseAsync"]>) => {
    try {
      return await origParseAsync(...args);
    } finally {
      resetReporter();
    }
  }) as Command["parseAsync"];
}
