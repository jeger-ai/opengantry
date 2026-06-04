import path from "node:path";
import type { GxtErrorCode } from "./gxt-error-codes.js";
import { writeAgentErrorPayload } from "./agent-error.js";
import { assertMissionGatePresent, parseMissionFile } from "./mission-parser.js";
import {
  evaluateVerifyPhases,
  type VerifyPhaseFailure,
  type VerifyPhaseSuccess,
} from "./verify-engine.js";
import { verifyFailurePresentation } from "./verify-failure-presentation.js";
import { resolveRuntimeEnv, resolvedRuntimeEnvToJsonPayload } from "./runtime-env.js";
import { runRuntimeExec } from "./runtime-exec.js";
import { loadWorkspace } from "./workspace.js";

export interface McpRuntimeErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

export type RuntimeEnvMcpResult =
  | { status: "ok"; env: Record<string, string> }
  | { status: "error"; error: McpRuntimeErrorBody };

export type VerifyMcpResult =
  | { status: "passed"; phase: "pre_push_stub"; message: string; msn_id: string }
  | {
      status: "passed";
      phase: "full";
      msn_id: string | undefined;
      mission_file_path: string;
    }
  | {
      status: "failed";
      phase: string;
      message: string;
      error_code: GxtErrorCode;
      fix_hints: string[];
      next_actions: string[];
      stdout?: string;
      stderr?: string;
      failures?: string[];
    }
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

function enrichVerifyFailure(
  failure: VerifyPhaseFailure,
  missionRel: string,
  missionFilePath: string,
  msnId?: string,
  root?: string,
): { error_code: GxtErrorCode; fix_hints: string[]; next_actions: string[] } {
  const presentation = verifyFailurePresentation({
    failure,
    missionArg: missionRel,
    options: {},
    root,
    msnId,
  });
  return {
    error_code: presentation.error_code,
    fix_hints: presentation.fix_hints,
    next_actions: presentation.next_actions,
  };
}

function successPayload(
  root: string,
  mission: ReturnType<typeof parseMissionFile>,
  result: VerifyPhaseSuccess,
): VerifyMcpResult {
  if (result.outcome === "pre_push_stub") {
    return {
      status: "passed",
      phase: "pre_push_stub",
      message: "Legislative stub OK (git-proof passed).",
      msn_id: result.proofMsnId ?? undefined,
    };
  }
  return {
    status: "passed",
    phase: "full",
    msn_id: mission.msnId ?? undefined,
    mission_file_path: path.relative(root, mission.rawPath).split(path.sep).join("/"),
  };
}

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

export function handleVerify(missionFilePath: string, prePush = false): VerifyMcpResult {
  try {
    const { root } = loadWorkspace();
    const mission = parseMissionFile(root, missionFilePath);
    assertMissionGatePresent(mission);

    const missionRel = path.relative(root, mission.rawPath).split(path.sep).join("/");
    const msnId = mission.msnId ?? undefined;

    const result = evaluateVerifyPhases(root, mission, { mission: missionFilePath, prePush });

    if (result.ok) {
      return successPayload(root, mission, result);
    }

    const enriched = enrichVerifyFailure(result, missionRel, missionFilePath, msnId, root);
    const failed: VerifyMcpResult = {
      status: "failed",
      phase: result.phase,
      message: result.message,
      ...enriched,
    };

    if (result.phase === "gate") {
      return { ...failed, stdout: result.gateStdout, stderr: result.gateStderr };
    }
    if (result.phase === "trace" && result.traceReason) {
      return { ...failed, failures: [`DoD trace: ${result.traceReason}`] };
    }

    return failed;
  } catch (e) {
    return {
      status: "error",
      error: {
        code: "VERIFY_FAILED",
        message: e instanceof Error ? e.message : String(e),
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
        message: e instanceof Error ? e.message : String(e),
        retryable: true,
      },
    };
  }
}
