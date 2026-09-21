import { AsyncLocalStorage } from "node:async_hooks";
import type { Command } from "commander";
import { CLI_NAME } from "./constants.js";
import { applyAudienceFromArgv, enterDocumentStdout, leaveDocumentStdout } from "./output-context.js";
import { logError, setExitCode } from "./cli-io.js";

interface HookScope {
  entered: boolean;
}

const hookScopes = new AsyncLocalStorage<HookScope>();

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

function structuredFormatFromArgv(actionCommand: Command): boolean {
  const format = (actionCommand.opts() as { format?: string }).format;
  if (typeof format !== "string") return false;
  const v = format.trim().toLowerCase();
  return v === "json" || v === "sarif" || v === "junit";
}

function wantsDocumentStdout(actionCommand: Command): boolean {
  return jsonFlagFromArgv(actionCommand) || structuredFormatFromArgv(actionCommand);
}

function leaveHookScope(scope: HookScope | undefined): void {
  if (!scope?.entered) return;
  scope.entered = false;
  leaveDocumentStdout();
}

/** Commander preAction/postAction: audience plus paired document-stdout depth. */
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
    if (!wantsDocumentStdout(actionCommand)) return;
    const scope = hookScopes.getStore();
    if (!scope) return;
    enterDocumentStdout();
    scope.entered = true;
  });

  program.hook("postAction", () => {
    leaveHookScope(hookScopes.getStore());
  });

  const origParse = program.parse.bind(program);
  const origParseAsync = program.parseAsync.bind(program);

  program.parse = ((...args: Parameters<Command["parse"]>) => {
    return hookScopes.run({ entered: false }, () => {
      try {
        return origParse(...args);
      } catch (e) {
        leaveHookScope(hookScopes.getStore());
        throw e;
      }
    });
  }) as Command["parse"];

  program.parseAsync = (async (...args: Parameters<Command["parseAsync"]>) => {
    return hookScopes.run({ entered: false }, async () => {
      try {
        return await origParseAsync(...args);
      } finally {
        leaveHookScope(hookScopes.getStore());
      }
    });
  }) as Command["parseAsync"];
}
