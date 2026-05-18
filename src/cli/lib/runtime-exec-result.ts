import type { ForbiddenViolation } from "./forbidden-scan.js";

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

export function emptyWorkerCommandResult(): RuntimeExecResult {
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

export function buildRuntimeExecResult(input: {
  violations: ForbiddenViolation[];
  timedOut: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  workerLogPath: string;
  flightId: string;
}): RuntimeExecResult {
  const base = {
    workerExitCode: input.exitCode,
    workerSignal: input.exitSignal,
    violations: input.violations,
    workerLogPath: input.workerLogPath,
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
  workerLogPath: string,
  flightId: string,
): RuntimeExecResult {
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
