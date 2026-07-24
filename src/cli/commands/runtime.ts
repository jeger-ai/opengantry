import fs from "node:fs";
import type { AgentErrorPayload } from "../lib/errors.js";
import { agentErrorAbsolutePath, serializeAgentErrorPayload } from "../lib/errors.js";
import { hintForbiddenZone, hintRuntimeHumanSummary, logFixHint } from "../lib/fix-hints.js";
import { emitPinnedMissionBanner, resolveMissionArg } from "../lib/mission-arg.js";
import { resolveRuntimeEnv, resolvedRuntimeEnvToJsonPayload } from "../lib/runtime-env.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { emitCliJson, runUserCommand, runUserCommandAsync } from "../lib/command-boundary.js";
import { runRuntimeExec } from "../lib/runtime-exec.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface RuntimeEnvCliOptions {
  mission?: string;
  json?: boolean;
  /** `shell`: POSIX `export VAR='...'` lines; `text`: labeled lines */
  format?: "shell" | "text";
}

export interface RuntimeExecCliOptions {
  mission: string;
  workerCommand: string[];
  cwd?: string;
  executorLog?: string;
  append?: boolean;
  timeoutMs?: number;
  streamOutput?: boolean;
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

    if (options.json) {
      emitCliJson({
        ...payload,
        mission_file_path: resolved.missionRel,
        mission_source: resolved.source,
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
  if (options.workerCommand.length === 0) {
    logError("runtime exec: missing executor command. Use -- <worker-command...>");
    setExitCode(2);
    return;
  }

  await runUserCommandAsync({ json: options.json }, async () => {
    const workspace = loadWorkspace();
    const resolved = resolveRuntimeEnv(workspace, options.mission);
    const result = await runRuntimeExec(workspace, {
      mission: options.mission,
      workerCommand: options.workerCommand,
      cwd: options.cwd,
      executorLog: options.executorLog,
      append: options.append,
      timeoutMs: options.timeoutMs,
      streamOutput: options.streamOutput,
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
