import crypto from "node:crypto";
import path from "node:path";
import { errorMessage } from "./cli-io.js";
import { writeAgentErrorPayload } from "./errors.js";
import { buildForbiddenBaseline, detectForbiddenViolations, type ForbiddenViolation } from "./forbidden-scan.js";
import { createTelemetryWriter } from "./telemetry-log.js";
import { resolvedRuntimeEnvToJsonPayload, resolveRuntimeEnv } from "./runtime-env.js";
import { hashProcessChunk, spawnWithStreamCapture } from "./runtime-exec-process.js";
import type { Workspace } from "./workspace.js";

export interface RuntimeExecResult {
  status:
    | "success"
    | "worker_failed"
    | "forbidden_zone_violation"
    | "runtime_error"
    | "timeout";
  exitCode: number;
  workerExitCode: number | null;
  workerSignal: NodeJS.Signals | null;
  violations: ForbiddenViolation[];
  executorLogPath: string;
  flightId: string;
}

export function emptyWorkerCommandResult(): RuntimeExecResult {
  return {
    status: "runtime_error",
    exitCode: 2,
    workerExitCode: null,
    workerSignal: null,
    violations: [],
    executorLogPath: "",
    flightId: "",
  };
}

export function buildRuntimeExecResult(input: {
  violations: ForbiddenViolation[];
  timedOut: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  executorLogPath: string;
  flightId: string;
}): RuntimeExecResult {
  const base = {
    workerExitCode: input.exitCode,
    workerSignal: input.exitSignal,
    violations: input.violations,
    executorLogPath: input.executorLogPath,
    flightId: input.flightId,
  };

  if (input.violations.length > 0) {
    return { ...base, status: "forbidden_zone_violation", exitCode: 3 };
  }
  if (input.timedOut) {
    return { ...base, status: "timeout", exitCode: 124 };
  }
  if (input.exitCode !== 0) {
    return { ...base, status: "worker_failed", exitCode: 1 };
  }
  return { ...base, status: "success", exitCode: 0 };
}

export function runtimeErrorResult(
  executorLogPath: string,
  flightId: string,
): RuntimeExecResult {
  return {
    status: "runtime_error",
    exitCode: 2,
    workerExitCode: null,
    workerSignal: null,
    violations: [],
    executorLogPath,
    flightId,
  };
}

type TelemetryWriter = ReturnType<typeof createTelemetryWriter>;

export interface WorkerCaptureResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export async function captureWorkerProcess(input: {
  command: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  streamOutput: boolean;
  timeoutMs?: number;
  writer: TelemetryWriter;
}): Promise<WorkerCaptureResult> {
  const exit = await spawnWithStreamCapture({
    command: input.command,
    argv: input.argv,
    cwd: input.cwd,
    env: input.env,
    streamOutput: input.streamOutput,
    timeoutMs: input.timeoutMs,
    onSpawn: (pid) => {
      input.writer.logEvent({
        type: "proc_spawn",
        pid,
        cwd: input.cwd,
        command: input.command,
        argv: input.argv,
      });
    },
    onStdout: (chunk, seq) => {
      input.writer.logEvent({
        type: "stream",
        stream: "stdout",
        seq,
        chunk_b64: chunk.toString("base64"),
        chunk_sha256: hashProcessChunk(chunk),
        bytes: chunk.byteLength,
      });
    },
    onStderr: (chunk, seq) => {
      input.writer.logEvent({
        type: "stream",
        stream: "stderr",
        seq,
        chunk_b64: chunk.toString("base64"),
        chunk_sha256: hashProcessChunk(chunk),
        bytes: chunk.byteLength,
      });
    },
    onRuntimeError: (message, errno) => {
      input.writer.logEvent({
        type: "runtime_error",
        message,
        errno,
      });
    },
  });

  return { code: exit.code, signal: exit.signal, timedOut: exit.timedOut };
}

export interface RuntimeExecOptions {
  mission: string;
  workerCommand: string[];
  cwd?: string;
  executorLog?: string;
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
  executorLogPath: string;
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
  const executorLogPath = options.executorLog
    ? path.resolve(repoRoot, options.executorLog)
    : resolved.executor_log;
  const cwd = chooseWorkingDirectory(repoRoot, options.cwd);
  const flightId = randomFlightId();
  const streamOutput = options.streamOutput !== false;
  const baseline = buildForbiddenBaseline(repoRoot, forbiddenZones);
  const writer = createTelemetryWriter(
    executorLogPath,
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
    executor_log: executorLogPath,
    worker_command: options.workerCommand,
    forbidden_zones: forbiddenZones,
  });
  return {
    resolved,
    envPayload,
    repoRoot,
    forbiddenZones,
    executorLogPath,
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
    executorLogPath,
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
      env: { ...process.env, ...envPayload, GXT_EXECUTOR_LOG: executorLogPath },
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
      executorLogPath,
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
    const errorResult = runtimeErrorResult(executorLogPath, flightId);
    logFlightEnd(writer, errorResult, 0);
    writeAgentErrorPayload(repoRoot, resolved, errorResult);
    return errorResult;
  }
}
