import type { Command } from "commander";
import { EXIT_CODE } from "#core/exit-codes.js";
import { CLI_NAME } from "#core/constants.js";
import { logError, setExitCode } from "./lib/cli-io.js";
import { reporterFromArgv, setCurrentReporter, type Reporter, type ReporterArgv } from "./lib/reporter.js";

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

function restore(stack: Reporter[], depth: number): void {
  while (stack.length > depth) {
    const previous = stack.pop();
    if (previous) setCurrentReporter(previous);
  }
}

/**
 * Commander preAction/postAction: the reporter of this run is built from --audience, --json and --format and
 * the previous one is restored afterwards, also when the action throws, so commands run in one process
 * (tests, gantry hook) cannot leak a structured mode into the next.
 */
export function registerReporterHook(program: Command): void {
  const previous: Reporter[] = [];
  program.hook("preAction", (_thisCommand, actionCommand) => {
    const built = reporterFromArgv(reporterArgv(actionCommand));
    if ("invalidAudience" in built) {
      logError(`invalid --audience "${built.invalidAudience}" (expected executor|planner|verifier|platform)`);
      setExitCode(EXIT_CODE.USAGE);
      throw new Error(`${CLI_NAME}: invalid audience`);
    }
    previous.push(setCurrentReporter(built.reporter));
  });
  program.hook("postAction", () => restore(previous, previous.length - 1));

  const origParse = program.parse.bind(program);
  const origParseAsync = program.parseAsync.bind(program);
  program.parse = ((...args: Parameters<Command["parse"]>) => {
    const depth = previous.length;
    try {
      return origParse(...args);
    } finally {
      restore(previous, depth);
    }
  }) as Command["parse"];
  program.parseAsync = (async (...args: Parameters<Command["parseAsync"]>) => {
    const depth = previous.length;
    try {
      return await origParseAsync(...args);
    } finally {
      restore(previous, depth);
    }
  }) as Command["parseAsync"];
}
