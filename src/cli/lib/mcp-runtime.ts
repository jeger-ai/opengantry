import fs from "node:fs";
import path from "node:path";
import { writeAgentErrorPayload, type AgentErrorPayload } from "./errors.js";
import type { ForbiddenViolation } from "./forbidden-scan.js";
import type { RuntimeExecResult } from "./runtime-exec.js";
import { errorMessage } from "./cli-io.js";
import { buildVerifyResultPayloadFromOptions } from "./verify-run.js";
import type { VerifyResultPayload } from "./verify-payload.js";
import { parseMissionFile, pinActiveMission } from "./missions/parser.js";
import { resolvePinnedMission } from "./missions/parser.js";
import { runKpiScan } from "./kpi-scan.js";
import { resolveRuntimeEnv, resolvedRuntimeEnvToJsonPayload } from "./runtime-env.js";
import { runRuntimeExec } from "./runtime-exec.js";
import { loadWorkspace } from "./workspace.js";
import {
  mcpError,
  resolveGuardedMissionAbs,
  type LastErrorResult,
  type McpErrorBody,
  type PinMissionResult,
  type ResolveMissionResult,
} from "./mcp-governance-shared.js";
import { attestMission } from "./attest-mission.js";
import { resolveMissionArg } from "./mission-arg.js";

export type { VerifyResultPayload } from "./verify-payload.js";

export interface McpRuntimeErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

export type RuntimeEnvMcpResult =
  | { status: "ok"; env: Record<string, string> }
  | { status: "error"; error: McpRuntimeErrorBody };

export type RuntimeExecMcpResult =
  | { status: "success"; exit_code: number; flight_id: string }
  | {
      status: Exclude<RuntimeExecResult["status"], "success">;
      exit_code: number;
      violations: ForbiddenViolation[];
      agent_error: AgentErrorPayload;
    }
  | { status: "error"; error: McpRuntimeErrorBody };

export function handleRuntimeEnv(missionFilePath: string): RuntimeEnvMcpResult {
  try {
    const workspace = loadWorkspace();
    const resolved = resolveRuntimeEnv(workspace, missionFilePath);
    return {
      status: "ok",
      env: resolvedRuntimeEnvToJsonPayload(resolved),
    };
  } catch (e) {
    return {
      status: "error",
      error: {
        code: "RUNTIME_ENV_FAILED",
        message: errorMessage(e),
        retryable: true,
      },
    };
  }
}

export function handleVerify(
  missionFilePath: string,
  prePush = false,
  skipStaleEvidence = false,
  ci = false,
): VerifyResultPayload {
  return buildVerifyResultPayloadFromOptions({
    mission: missionFilePath,
    prePush,
    skipStaleEvidence,
    ci,
  });
}

export interface KpiScanMcpResult {
  status: "ok" | "error";
  report_path?: string;
  report?: unknown;
  error?: McpRuntimeErrorBody;
}

export function handleScan(missionFilePath: string, cwd?: string): KpiScanMcpResult {
  try {
    const workspace = loadWorkspace();
    const mission = parseMissionFile(workspace.root, missionFilePath);
    const result = runKpiScan(workspace.root, mission, { cwd });
    return { status: "ok", report_path: result.reportPath, report: result.report };
  } catch (e) {
    return {
      status: "error",
      error: {
        code: "SCAN_FAILED",
        message: errorMessage(e),
        retryable: true,
      },
    };
  }
}

export type RuntimeExecMcpInput = {
  mission: string;
  command: string[];
  cwd?: string;
  timeout_ms?: number;
};

export async function handleRuntimeExec(input: RuntimeExecMcpInput): Promise<RuntimeExecMcpResult> {
  try {
    const workspace = loadWorkspace();
    const resolved = resolveRuntimeEnv(workspace, input.mission);
    const result = await runRuntimeExec(workspace, {
      mission: input.mission,
      workerCommand: input.command,
      cwd: input.cwd,
      timeoutMs: input.timeout_ms,
      streamOutput: false,
    });

    if (result.status !== "success") {
      const payload = writeAgentErrorPayload(workspace.root, resolved, result);
      return {
        status: result.status,
        exit_code: result.exitCode,
        violations: result.violations,
        agent_error: payload,
      };
    }

    return {
      status: "success",
      exit_code: result.exitCode,
      flight_id: result.flightId,
    };
  } catch (e) {
    return {
      status: "error",
      error: {
        code: "RUNTIME_EXEC_FAILED",
        message: errorMessage(e),
        retryable: true,
      },
    };
  }
}

export function handleLastError(): LastErrorResult {
  const { root } = loadWorkspace();
  const errPath = path.join(root, ".gitagent", "history", ".ignored-last-error.json");
  if (!fs.existsSync(errPath)) {
    return { status: "empty", message: "No last error recorded." };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(errPath, "utf8")) as AgentErrorPayload;
    return { status: "found", payload };
  } catch {
    return { status: "error", message: "Failed to parse last error file." };
  }
}

export function handlePinMission(
  missionFilePath: string,
): PinMissionResult | { status: "error"; error: McpErrorBody } {
  const { root } = loadWorkspace();
  const resolution = resolveGuardedMissionAbs(root, missionFilePath);
  if (resolution.kind === "denied") return resolution.error;

  try {
    const rel = pinActiveMission(root, resolution.missionAbs);
    return {
      status: "pinned",
      mission_file_path: rel,
      message: `Pinned active mission: ${rel}`,
    };
  } catch {
    return mcpError("MISSION_NOT_FOUND", `mission file not found: ${missionFilePath}`, true);
  }
}

export function handleResolveMission(explicit?: string): ResolveMissionResult {
  const { root } = loadWorkspace();
  const resolved = resolvePinnedMission(root, {
    explicit,
    profile: "full",
  });

  if (resolved) {
    return { status: "resolved", mission_file_path: resolved };
  }

  return {
    status: "unpinned",
    mission_file_path: null,
    message: "No active mission pinned. Run Mission Architect / gxt_draft_legislation first.",
  };
}

export function handleAttest(input: {
  mission_file_path: string;
  out?: string;
  sign?: boolean;
}): Record<string, unknown> {
  const { root } = loadWorkspace();
  const resolved = resolveMissionArg(root, input.mission_file_path);
  const result = attestMission({
    root,
    resolved,
    out: input.out,
    sign: input.sign === true,
  });
  return {
    status: "ok",
    repo_root: result.repo_root,
    receipt: result.receipt,
    receipt_path: result.receipt_path,
    mission_file_path: result.mission_file_path,
    mission_source: result.mission_source,
  };
}
