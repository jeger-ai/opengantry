import { writeAgentErrorPayload, type AgentErrorPayload } from "./errors.js";
import type { ForbiddenViolation } from "./forbidden-scan.js";
import type { RuntimeExecResult } from "./runtime-exec.js";
import { errorMessage } from "./cli-io.js";
import {
  buildVerifyResultPayloadFromOptions,
  type VerifyResultPayload,
} from "./verify-presentation.js";
import { parseMissionFile } from "./missions/parser.js";
import { runKpiScan } from "./kpi-scan.js";
import { resolveRuntimeEnv, resolvedRuntimeEnvToJsonPayload } from "./runtime-env.js";
import { runRuntimeExec } from "./runtime-exec.js";
import { loadWorkspace } from "./workspace.js";

export type { VerifyResultPayload } from "./verify-presentation.js";

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
