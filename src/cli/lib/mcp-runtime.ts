import { writeAgentErrorPayload } from "./agent-error.js";
import {
  buildVerifyResultPayloadFromOptions,
  type VerifyMcpResult,
} from "./verify-result-payload.js";
import { resolveRuntimeEnv, resolvedRuntimeEnvToJsonPayload } from "./runtime-env.js";
import { runRuntimeExec } from "./runtime-exec.js";
import { loadWorkspace } from "./workspace.js";

export type { VerifyMcpResult, VerifyResultPayload } from "./verify-result-payload.js";

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
      status: string;
      exit_code: number;
      violations: unknown;
      agent_error: unknown;
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
        message: e instanceof Error ? e.message : String(e),
        retryable: true,
      },
    };
  }
}

export function handleVerify(
  missionFilePath: string,
  prePush = false,
  skipStaleEvidence = false,
): VerifyMcpResult {
  return buildVerifyResultPayloadFromOptions({
    mission: missionFilePath,
    prePush,
    skipStaleEvidence,
  });
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
        message: e instanceof Error ? e.message : String(e),
        retryable: true,
      },
    };
  }
}
