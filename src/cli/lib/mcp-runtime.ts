import path from "node:path";
import { writeAgentErrorPayload } from "./agent-error.js";
import { hintsForVerifyPhase } from "./fix-hints.js";
import { assertMissionGatePresent, parseMissionFile } from "./mission-parser.js";
import {
  evaluateVerifyPhases,
  type VerifyPhaseFailure,
  type VerifyPhaseSuccess,
} from "./verify-engine.js";
import { verifyFailureToHintContext } from "./verify-flow.js";
import { resolveRuntimeEnv, resolvedRuntimeEnvToJsonPayload } from "./runtime-env.js";
import { runRuntimeExec } from "./runtime-exec.js";
import { loadWorkspace } from "./workspace.js";

function enrichVerifyFailure(
  failure: VerifyPhaseFailure,
  missionRel: string,
  missionFilePath: string,
  msnId?: string,
  root?: string,
): Record<string, unknown> {
  const remediation = hintsForVerifyPhase(failure.phase, {
    ...verifyFailureToHintContext(failure, missionRel, { mission: missionFilePath }, root),
    msnId,
  });
  return {
    error_code: remediation.error_code,
    fix_hints: remediation.fix_hints,
    next_actions: remediation.next_actions,
  };
}

function successPayload(
  root: string,
  mission: ReturnType<typeof parseMissionFile>,
  result: VerifyPhaseSuccess,
): Record<string, unknown> {
  if (result.outcome === "pre_push_stub") {
    return {
      status: "passed",
      phase: "pre_push_stub",
      message: "Legislative stub OK (git-proof passed).",
      msn_id: result.proofMsnId,
    };
  }
  return {
    status: "passed",
    phase: "full",
    msn_id: mission.msnId,
    mission_file_path: path.relative(root, mission.rawPath).split(path.sep).join("/"),
  };
}

export function handleRuntimeEnv(missionFilePath: string): Record<string, unknown> {
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

export function handleVerify(missionFilePath: string, prePush = false): Record<string, unknown> {
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

    const base: Record<string, unknown> = {
      status: "failed",
      phase: result.phase,
      message: result.message,
      ...enrichVerifyFailure(result, missionRel, missionFilePath, msnId, root),
    };

    if (result.phase === "gate") {
      base.stdout = result.gateStdout;
      base.stderr = result.gateStderr;
    }
    if (result.phase === "trace" && result.traceReason) {
      base.failures = [`DoD trace: ${result.traceReason}`];
    }

    return base;
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

export async function handleRuntimeExec(input: RuntimeExecMcpInput): Promise<Record<string, unknown>> {
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
