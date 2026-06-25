import fs from "node:fs";
import type { AgentErrorPayload } from "../lib/errors.js";
import { agentErrorAbsolutePath } from "../lib/errors.js";
import { hintForbiddenZone, hintRuntimeHumanSummary, logFixHint } from "../lib/fix-hints.js";
import { resolveRuntimeEnv, resolvedRuntimeEnvToJsonPayload } from "../lib/runtime-env.js";
import { logError, logInfo, setExitCode, errorMessage } from "../lib/cli-io.js";
import { runRuntimeExec } from "../lib/runtime-exec.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface RuntimeEnvCliOptions {
  mission: string;
  json?: boolean;
  /** `shell`: POSIX `export VAR='...'` lines; `text`: labeled lines */
  format?: "shell" | "text";
}

export interface RuntimeExecCliOptions {
  mission: string;
  workerCommand: string[];
  cwd?: string;
  workerLog?: string;
  append?: boolean;
  timeoutMs?: number;
  streamOutput?: boolean;
  json?: boolean;
}

function escapeShellSingleQuotes(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

export function runRuntimeEnv(options: RuntimeEnvCliOptions): void {
  try {
    const workspace = loadWorkspace();
    const resolved = resolveRuntimeEnv(workspace, options.mission);
    const payload = resolvedRuntimeEnvToJsonPayload(resolved);

    if (options.json) {
      logInfo(JSON.stringify(payload, null, 2));
      return;
    }

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
  } catch (e) {
    const errno = typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;
    if (errno === "ENOENT") {
      logError(
        `runtime env: mission file not found: ${options.mission} (ENOENT). Use an existing mission path — e.g. .gitagent/missions/example.verify.yaml — or run gantry legislate first, then pass that YAML path.`,
      );
    } else {
      logError(errorMessage(e));
    }
    setExitCode(2);
  }
}

export async function runRuntimeExecCommand(options: RuntimeExecCliOptions): Promise<void> {
  if (options.workerCommand.length === 0) {
    logError("runtime exec: missing worker command. Use -- <worker-command...>");
    setExitCode(2);
    return;
  }
  try {
    const workspace = loadWorkspace();
    const resolved = resolveRuntimeEnv(workspace, options.mission);
    const result = await runRuntimeExec(workspace, {
      mission: options.mission,
      workerCommand: options.workerCommand,
      cwd: options.cwd,
      workerLog: options.workerLog,
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
      logInfo(
        JSON.stringify(
          {
            status: result.status,
            exit_code: result.exitCode,
            worker_exit_code: result.workerExitCode,
            worker_signal: result.workerSignal,
            violation_count: result.violations.length,
            violations: result.violations,
            worker_log: result.workerLogPath,
            flight_id: result.flightId,
            agent_error_path: agentError?.error_file ?? "",
            agent_error: agentError,
          },
          null,
          2,
        ),
      );
    } else {
      logInfo(`runtime exec: ${result.status}`);
      logInfo(`  worker_log: ${result.workerLogPath}`);
      logInfo(`  violations: ${String(result.violations.length)}`);
      if (agentError) {
        logInfo(hintRuntimeHumanSummary(agentError.summary, agentError.error_file));
        if (result.violations[0]) {
          logFixHint(hintForbiddenZone(result.violations[0]!.path, options.mission));
        }
        logError(JSON.stringify(agentError));
      }
    }
    if (result.exitCode !== 0) setExitCode(result.exitCode);
  } catch (e) {
    logError(errorMessage(e));
    setExitCode(2);
  }
}
