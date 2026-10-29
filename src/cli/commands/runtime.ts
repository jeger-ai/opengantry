import { EXIT_CODE } from "#core/exit-codes.js";
import fs from "node:fs";
import type { AgentErrorPayload } from "#missions/error-payloads.js";
import { agentErrorAbsolutePath, serializeAgentErrorPayload } from "#missions/error-payloads.js";
import { hintForbiddenZone, hintRuntimeHumanSummary } from "#missions/fix-hints.js";
import { logFixHint, logError, logInfo, parseOptionalTimeoutMs, setExitCode } from "../output/cli-io.js";
import { writeAiderTmvcScope } from "#missions/aider-scope.js";
import { emitPinnedMissionBanner, resolveMissionArg } from "../flows/mission-arg.js";
import { resolveRuntimeEnv, resolvedRuntimeEnvToJsonPayload } from "#missions/runtime-env.js";
import { emitCliJson, runUserCommand, runUserCommandAsync } from "../output/command-boundary.js";
import { runRuntimeExec } from "#missions/runtime-exec.js";
import { loadWorkspace } from "#missions/workspace.js";

export interface RuntimeEnvCliOptions {
  mission?: string;
  json?: boolean;
  /** `shell`: POSIX `export VAR='...'` lines; `text`: labeled lines */
  format?: "shell" | "text";
  /** Write a gitignored Aider scope note and patch an existing `.aider.conf.yml` `read:` list. */
  aider?: boolean;
}

/** `gantry runtime exec` as Commander parses it: the argv after `--`, --timeout-ms as text, `stream: false` for --no-stream. */
export interface RuntimeExecCliOptions {
  mission: string;
  workerCommand: string[];
  cwd?: string;
  executorLog?: string;
  append?: boolean;
  timeoutMs?: string;
  stream?: boolean;
  json?: boolean;
}

function escapeShellSingleQuotes(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

export function runRuntimeEnv(options: RuntimeEnvCliOptions): void {
  runUserCommand({ json: options.json }, () => {
    const workspace = loadWorkspace();
    const resolved = resolveMissionArg(workspace.root, options.mission);
    const resolvedEnv = resolveRuntimeEnv(workspace, resolved.missionRel);
    const payload = resolvedRuntimeEnvToJsonPayload(resolvedEnv);
    const aiderScope = options.aider
      ? writeAiderTmvcScope(workspace.root, resolvedEnv.scope.tmvcRoots).scopeFile
      : "";
    if (aiderScope) console.error(`runtime env: wrote ${aiderScope}`);

    if (options.json) {
      emitCliJson({
        ...payload,
        mission_file_path: resolved.missionRel,
        mission_source: resolved.source,
        ...(aiderScope ? { aider_scope_file: aiderScope } : {}),
      });
      return;
    }

    emitPinnedMissionBanner(resolved, { json: options.json });

    const fmt = options.format ?? "shell";
    if (fmt === "text") {
      for (const [k, v] of Object.entries(payload)) {
        logInfo(`${k}=${v}`);
      }
      return;
    }

    for (const [k, v] of Object.entries(payload)) {
      logInfo(`export ${k}='${escapeShellSingleQuotes(v)}'`);
    }
  });
}

export async function runRuntimeExecCommand(options: RuntimeExecCliOptions): Promise<void> {
  const timeout = parseOptionalTimeoutMs(options.timeoutMs);
  if (!timeout.ok) {
    logError(timeout.message);
    setExitCode(EXIT_CODE.USAGE);
    return;
  }
  const workerCommand = options.workerCommand[0] === "--" ? options.workerCommand.slice(1) : options.workerCommand;
  if (workerCommand.length === 0) {
    logError("runtime exec: missing executor command. Use -- <worker-command...>");
    setExitCode(EXIT_CODE.USAGE);
    return;
  }

  await runUserCommandAsync({ json: options.json }, async () => {
    const workspace = loadWorkspace();
    const resolved = resolveRuntimeEnv(workspace, options.mission);
    const result = await runRuntimeExec(workspace, {
      mission: options.mission,
      workerCommand,
      cwd: options.cwd,
      executorLog: options.executorLog,
      append: options.append,
      timeoutMs: timeout.ms,
      streamOutput: options.stream,
    });

    let agentError: AgentErrorPayload | null = null;
    if (result.exitCode !== 0) {
      const errPath = agentErrorAbsolutePath(resolved.repo_root);
      if (fs.existsSync(errPath)) {
        agentError = JSON.parse(fs.readFileSync(errPath, "utf8")) as AgentErrorPayload;
      }
    }

    if (options.json) {
      emitCliJson({
        status: result.status,
        exit_code: result.exitCode,
        worker_exit_code: result.workerExitCode,
        worker_signal: result.workerSignal,
        violation_count: result.violations.length,
        violations: result.violations,
        executor_log: result.executorLogPath,
        flight_id: result.flightId,
        agent_error_path: agentError?.error_file ?? "",
        agent_error: agentError,
      });
    } else {
      logInfo(`runtime exec: ${result.status}`);
      logInfo(`  executor_log: ${result.executorLogPath}`);
      logInfo(`  violations: ${String(result.violations.length)}`);
      if (agentError) {
        logInfo(hintRuntimeHumanSummary(agentError.summary, agentError.error_file));
        if (result.violations[0]) {
          logFixHint(hintForbiddenZone(result.violations[0]!.path, options.mission));
        }
        logError(serializeAgentErrorPayload(agentError));
      }
    }
    if (result.exitCode !== 0) setExitCode(result.exitCode);
  });
}
