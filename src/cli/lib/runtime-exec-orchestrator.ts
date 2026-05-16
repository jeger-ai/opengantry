import crypto from "node:crypto";
import path from "node:path";
import { buildForbiddenBaseline, detectForbiddenViolations, type ForbiddenViolation } from "./forbidden-scan.js";
import { createTelemetryWriter } from "./telemetry-log.js";
import { hashProcessChunk, spawnWithStreamCapture } from "./runtime-exec-process.js";
import { resolvedRuntimeEnvToJsonPayload, resolveRuntimeEnv } from "./runtime-env.js";
import type { Workspace } from "./workspace.js";

export interface RuntimeExecOptions {
  mission: string;
  workerCommand: string[];
  cwd?: string;
  workerLog?: string;
  append?: boolean;
  timeoutMs?: number;
  streamOutput?: boolean;
}

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
  workerLogPath: string;
  flightId: string;
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

export async function runRuntimeExec(
  workspace: Workspace,
  options: RuntimeExecOptions,
): Promise<RuntimeExecResult> {
  if (options.workerCommand.length === 0) {
    return {
      status: "runtime_error",
      exitCode: 2,
      workerExitCode: null,
      workerSignal: null,
      violations: [],
      workerLogPath: "",
      flightId: "",
    };
  }

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

  const timeoutMs = options.timeoutMs;

  try {
    const [cmd, ...argv] = options.workerCommand;
    const exit = await spawnWithStreamCapture({
      command: cmd!,
      argv,
      cwd,
      env: { ...process.env, ...envPayload, GXT_WORKER_LOG: workerLogPath },
      streamOutput,
      timeoutMs,
      onSpawn: (pid) => {
        writer.logEvent({
          type: "proc_spawn",
          pid,
          cwd,
          command: cmd,
          argv,
        });
      },
      onStdout: (chunk, seq) => {
        writer.logEvent({
          type: "stream",
          stream: "stdout",
          seq,
          chunk_b64: chunk.toString("base64"),
          chunk_sha256: hashProcessChunk(chunk),
          bytes: chunk.byteLength,
        });
      },
      onStderr: (chunk, seq) => {
        writer.logEvent({
          type: "stream",
          stream: "stderr",
          seq,
          chunk_b64: chunk.toString("base64"),
          chunk_sha256: hashProcessChunk(chunk),
          bytes: chunk.byteLength,
        });
      },
      onRuntimeError: (message, errno) => {
        writer.logEvent({
          type: "runtime_error",
          message,
          errno,
        });
      },
    });

    if (exit.timedOut) {
      writer.logEvent({
        type: "timeout_kill",
        timeout_ms: timeoutMs ?? null,
      });
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

    let result: RuntimeExecResult;
    if (violations.length > 0) {
      result = {
        status: "forbidden_zone_violation",
        exitCode: 3,
        workerExitCode: exit.code,
        workerSignal: exit.signal,
        violations,
        workerLogPath,
        flightId,
      };
    } else if (exit.timedOut) {
      result = {
        status: "timeout",
        exitCode: 124,
        workerExitCode: exit.code,
        workerSignal: exit.signal,
        violations,
        workerLogPath,
        flightId,
      };
    } else if (exit.code !== 0) {
      result = {
        status: "worker_failed",
        exitCode: 1,
        workerExitCode: exit.code,
        workerSignal: exit.signal,
        violations,
        workerLogPath,
        flightId,
      };
    } else {
      result = {
        status: "success",
        exitCode: 0,
        workerExitCode: exit.code,
        workerSignal: exit.signal,
        violations,
        workerLogPath,
        flightId,
      };
    }

    writer.logEvent({
      type: "flight_end",
      status: result.status,
      exit_code: result.exitCode,
      worker_exit_code: result.workerExitCode,
      worker_signal: result.workerSignal,
      violation_count: violations.length,
    });
    writer.close();
    return result;
  } catch (e) {
    writer.logEvent({
      type: "runtime_error",
      message: e instanceof Error ? e.message : String(e),
    });
    writer.logEvent({
      type: "flight_end",
      status: "runtime_error",
      exit_code: 2,
      worker_exit_code: null,
      worker_signal: null,
      violation_count: 0,
    });
    writer.close();
    return {
      status: "runtime_error",
      exitCode: 2,
      workerExitCode: null,
      workerSignal: null,
      violations: [],
      workerLogPath,
      flightId,
    };
  }
}
