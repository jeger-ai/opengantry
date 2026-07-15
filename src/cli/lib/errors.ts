import fs from "node:fs";
import { readEnvWithLegacy } from "./config-namespace.js";
import path from "node:path";
import { logError, setExitCode, errorMessage } from "./cli-io.js";
import { hintGitProofFromMessage, logFixHint } from "./fix-hints.js";
import { gxtCodeFromGantryUserError } from "./gxt-error-codes.js";
import { REL_AGENT_ERROR_FILE } from "./constants.js";
import type { ForbiddenViolation } from "./forbidden-scan.js";
import type { RuntimeExecResult } from "./runtime-exec.js";
import type { ResolvedRuntimeEnv } from "./runtime-env.js";

/** Expected policy / validation failure — never print a stack at the CLI boundary. */
export class GantryUserError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "GantryUserError";
  }

  /** Stable GXT error code for JSON/MCP consumers. */
  get gxtCode(): string {
    return gxtCodeFromGantryUserError(this.code);
  }
}

export function isGantryUserError(e: unknown): e is GantryUserError {
  return e instanceof GantryUserError;
}

/** @deprecated Use {@link GantryUserError}; alias kept for one release (v2.7.0). */
export const GapmanUserError = GantryUserError;
/** @deprecated Use {@link GantryUserError}; alias kept for one release (v2.7.0). */
export type GapmanUserError = GantryUserError;

/** @deprecated Use {@link isGantryUserError}; alias kept for one release (v2.7.0). */
export const isGapmanUserError = isGantryUserError;

function logUnexpectedError(error: Error): void {
  if (readEnvWithLegacy("DEBUG") === "1") {
    logError(error.stack ?? error.message);
  } else {
    logError(error.message);
  }
}

/** User-facing failure reporter: message + optional Fix: hint, no stack by default. */
export function reportUserFacingError(e: unknown): void {
  if (isGantryUserError(e)) {
    logError(`[${e.gxtCode}] ${e.message}`);
    if (e.hint) logFixHint(e.hint);
    setExitCode(e.exitCode);
    return;
  }

  if (e instanceof Error) {
    logUnexpectedError(e);
    const legacyHint = hintGitProofFromMessage(e.message);
    if (legacyHint) logFixHint(legacyHint);
    setExitCode(1);
    return;
  }

  logError(String(e));
  setExitCode(1);
}

export interface UserFacingErrorJson {
  error_code: string;
  message: string;
  hint?: string;
  exit_code: number;
}

export function userFacingErrorToJson(e: unknown): UserFacingErrorJson {
  if (isGantryUserError(e)) {
    return {
      error_code: e.gxtCode,
      message: e.message,
      hint: e.hint,
      exit_code: e.exitCode,
    };
  }
  const message = errorMessage(e);
  return { error_code: "GXT_VERIFY_FAILED", message, exit_code: 1 };
}

export interface AgentErrorPayload {
  v: 1;
  ts: string;
  status: RuntimeExecResult["status"];
  exit_code: number;
  flight_id: string;
  msn_id: string;
  mission_file: string;
  skill_key: string;
  error_file: string;
  violations: ForbiddenViolation[];
  summary: string;
  remediation: string[];
}

export function agentErrorAbsolutePath(repoRoot: string): string {
  return path.join(repoRoot, REL_AGENT_ERROR_FILE);
}

function buildSummary(result: RuntimeExecResult): string {
  switch (result.status) {
    case "forbidden_zone_violation":
      return `Forbidden-zone violation: ${String(result.violations.length)} path(s) changed outside policy.`;
    case "timeout":
      return "Executor exceeded the configured timeout and was terminated.";
    case "worker_failed":
      return `Executor exited with code ${String(result.workerExitCode ?? "unknown")}.`;
    case "runtime_error":
      return "Runtime orchestration failed before or during executor execution.";
    default:
      return `Flight ended with status ${result.status}.`;
  }
}

function buildRemediation(
  result: RuntimeExecResult,
  resolved: ResolvedRuntimeEnv,
): string[] {
  const steps: string[] = [];
  if (result.status === "forbidden_zone_violation") {
    for (const v of result.violations.slice(0, 5)) {
      steps.push(`Revert or avoid changes to forbidden path: ${v.path} (${v.kind})`);
    }
    steps.push("Confine edits to GXT_TMVC_ROOTS unless a Context Request is approved in EXECUTOR_LOG.md");
  }
  if (result.status === "timeout") {
    steps.push("Increase --timeout-ms or reduce executor scope; retry with a smaller command");
  }
  if (result.status === "worker_failed") {
    steps.push("Inspect executor stderr in EXECUTOR_LOG.md flight JSONL and fix the failing command");
  }
  steps.push(`Mission: ${resolved.mission_file}; skill: ${resolved.skill_key}`);
  return steps;
}

export function writeAgentErrorPayload(
  repoRoot: string,
  resolved: ResolvedRuntimeEnv,
  result: RuntimeExecResult,
): AgentErrorPayload {
  const errorFile = agentErrorAbsolutePath(repoRoot);
  fs.mkdirSync(path.dirname(errorFile), { recursive: true });
  const payload: AgentErrorPayload = {
    v: 1,
    ts: new Date().toISOString(),
    status: result.status,
    exit_code: result.exitCode,
    flight_id: result.flightId,
    msn_id: resolved.msn_id,
    mission_file: resolved.mission_file,
    skill_key: resolved.skill_key,
    error_file: errorFile,
    violations: result.violations,
    summary: buildSummary(result),
    remediation: buildRemediation(result, resolved),
  };
  fs.writeFileSync(errorFile, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
