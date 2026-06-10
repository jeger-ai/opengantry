import crypto from "node:crypto";
import path from "node:path";
import { errorMessage } from "./cli-io.js";
import { writeAgentErrorPayload } from "./agent-error.js";
import { buildForbiddenBaseline, detectForbiddenViolations } from "./forbidden-scan.js";
import { createTelemetryWriter } from "./telemetry-log.js";
import { resolvedRuntimeEnvToJsonPayload, resolveRuntimeEnv } from "./runtime-env.js";
import { captureWorkerProcess } from "./runtime-exec-worker.js";
import {
  buildRuntimeExecResult,
  emptyWorkerCommandResult,
  runtimeErrorResult,
  type RuntimeExecResult,
} from "./runtime-exec-result.js";
import type { Workspace } from "./workspace.js";

export type { RuntimeExecResult } from "./runtime-exec-result.js";

export interface RuntimeExecOptions {
  mission: string;
  workerCommand: string[];
  cwd?: string;
  workerLog?: string;
  append?: boolean;
  timeoutMs?: number;
  streamOutput?: boolean;
}

function randomFlightId(): string {
  return crypto.randomUUID();
}

function parseJoinedLines(s: string): string[] {
  return s
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function chooseWorkingDirectory(repoRoot: string, cwd?: string): string {
  if (!cwd?.trim()) return repoRoot;
  return path.resolve(repoRoot, cwd);
}

function logFlightEnd(
  writer: ReturnType<typeof createTelemetryWriter>,
  result: RuntimeExecResult,
  violationCount: number,
): void {
  writer.logEvent({
    type: "flight_end",
    status: result.status,
    exit_code: result.exitCode,
    worker_exit_code: result.workerExitCode,
    worker_signal: result.workerSignal,
    violation_count: violationCount,
  });
  writer.close();
}

function beginRuntimeFlight(
  workspace: Workspace,
  options: RuntimeExecOptions,
): {
  resolved: ReturnType<typeof resolveRuntimeEnv>;
  envPayload: Record<string, string>;
  repoRoot: string;
  forbiddenZones: string[];
  workerLogPath: string;
  cwd: string;
  flightId: string;
  streamOutput: boolean;
  baseline: ReturnType<typeof buildForbiddenBaseline>;
  writer: ReturnType<typeof createTelemetryWriter>;
} {
  const resolved = resolveRuntimeEnv(workspace, options.mission);
  const envPayload = resolvedRuntimeEnvToJsonPayload(resolved);
  const repoRoot = resolved.repo_root;
  const forbiddenZones = parseJoinedLines(resolved.forbidden_zones_joined);
  const workerLogPath = options.workerLog
    ? path.resolve(repoRoot, options.workerLog)
    : resolved.worker_log;
  const cwd = chooseWorkingDirectory(repoRoot, options.cwd);
  const flightId = randomFlightId();
  const streamOutput = options.streamOutput !== false;
  const baseline = buildForbiddenBaseline(repoRoot, forbiddenZones);
  const writer = createTelemetryWriter(
    workerLogPath,
    {
      flight_id: flightId,
      msn_id: resolved.msn_id,
      mission_file: resolved.mission_file,
      skill_key: resolved.skill_key,
      worker_command: options.workerCommand,
    },
    options.append === true,
  );
  writer.logEvent({
    type: "flight_start",
    repo_root: repoRoot,
    skill_key: resolved.skill_key,
    worker_log: workerLogPath,
    worker_command: options.workerCommand,
    forbidden_zones: forbiddenZones,
  });
  return {
    resolved,
    envPayload,
    repoRoot,
    forbiddenZones,
    workerLogPath,
    cwd,
    flightId,
    streamOutput,
    baseline,
    writer,
  };
}

export async function runRuntimeExec(
  workspace: Workspace,
  options: RuntimeExecOptions,
): Promise<RuntimeExecResult> {
  if (options.workerCommand.length === 0) {
    return emptyWorkerCommandResult();
  }

  const {
    resolved,
    envPayload,
    repoRoot,
    forbiddenZones,
    workerLogPath,
    cwd,
    flightId,
    streamOutput,
    baseline,
    writer,
  } = beginRuntimeFlight(workspace, options);

  const timeoutMs = options.timeoutMs;
  const [cmd, ...argv] = options.workerCommand;

  try {
    const exit = await captureWorkerProcess({
      command: cmd!,
      argv,
      cwd,
      env: { ...process.env, ...envPayload, GXT_WORKER_LOG: workerLogPath },
      streamOutput,
      timeoutMs,
      writer,
    });

    if (exit.timedOut) {
      writer.logEvent({ type: "timeout_kill", timeout_ms: timeoutMs ?? null });
    }

    writer.logEvent({
      type: "proc_exit",
      code: exit.code,
      signal: exit.signal,
      timed_out: exit.timedOut,
    });

    const violations = detectForbiddenViolations(baseline, forbiddenZones);
    writer.logEvent({
      type: "forbidden_scan",
      violations,
      violation_count: violations.length,
    });

    const result = buildRuntimeExecResult({
      violations,
      timedOut: exit.timedOut,
      exitCode: exit.code,
      exitSignal: exit.signal,
      workerLogPath,
      flightId,
    });

    logFlightEnd(writer, result, violations.length);
    if (result.exitCode !== 0) {
      writeAgentErrorPayload(repoRoot, resolved, result);
    }
    return result;
  } catch (e) {
    writer.logEvent({
      type: "runtime_error",
      message: errorMessage(e),
    });
    const errorResult = runtimeErrorResult(workerLogPath, flightId);
    logFlightEnd(writer, errorResult, 0);
    writeAgentErrorPayload(repoRoot, resolved, errorResult);
    return errorResult;
  }
}
