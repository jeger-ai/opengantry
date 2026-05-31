import path from "node:path";
import { writeAgentErrorPayload } from "./agent-error.js";
import { gatePassed, runGate } from "./gate.js";
import { assertTeacherMissionProof } from "./git-proof.js";
import { assertMissionGatePresent, parseMissionFile } from "./mission-parser.js";
import { isLegislativeStub } from "./mission-legislative-stub.js";
import { resolveRuntimeEnv, resolvedRuntimeEnvToJsonPayload } from "./runtime-env.js";
import { runRuntimeExec } from "./runtime-exec.js";
import { defaultWorkerLogPath, verifyTraceRows } from "./trace.js";
import { loadWorkspace } from "./workspace.js";

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

    const proof = runVerifyGitProofSilent(root, mission);
    if (!proof.ok) {
      return {
        status: "failed",
        phase: "git_proof",
        message: proof.message,
      };
    }

    if (prePush && isLegislativeStub(mission)) {
      return {
        status: "passed",
        phase: "pre_push_stub",
        message: "Legislative stub OK (git-proof passed).",
      };
    }

    const gateOk = runVerifyGateSilent(root, mission);
    if (!gateOk.ok) {
      return {
        status: "failed",
        phase: "gate",
        message: gateOk.message,
        stdout: gateOk.stdout,
        stderr: gateOk.stderr,
      };
    }

    const hasPending = mission.traceRows.some((row) => row.status.toUpperCase().includes("PENDING"));
    if (hasPending) {
      return {
        status: "failed",
        phase: "trace_pending",
        message: "Trace rows still PENDING — append WORKER_LOG evidence before full verify.",
      };
    }

    const traceOk = runVerifyTraceSilent(root, mission);
    if (!traceOk.ok) {
      return {
        status: "failed",
        phase: "trace",
        message: traceOk.message,
        failures: traceOk.failures,
      };
    }

    return {
      status: "passed",
      phase: "full",
      msn_id: mission.msnId,
      mission_file_path: path.relative(root, mission.rawPath).split(path.sep).join("/"),
    };
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

function runVerifyGitProofSilent(
  root: string,
  mission: ReturnType<typeof parseMissionFile>,
): { ok: true; msnId: string } | { ok: false; message: string } {
  try {
    const msnId = assertTeacherMissionProof(root, mission.rawPath, {
      msnId: mission.msnId ?? undefined,
    });
    return { ok: true, msnId };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function runVerifyGateSilent(
  root: string,
  mission: ReturnType<typeof parseMissionFile>,
): { ok: true } | { ok: false; message: string; stdout?: string; stderr?: string } {
  const gate = mission.gate!;
  const gateResult = runGate(root, gate);
  if (!gatePassed(gateResult, gate.successSubstring)) {
    return {
      ok: false,
      message: "GATE FAILED",
      stdout: gateResult.stdout,
      stderr: gateResult.stderr,
    };
  }
  return { ok: true };
}

function runVerifyTraceSilent(
  root: string,
  mission: ReturnType<typeof parseMissionFile>,
): { ok: true } | { ok: false; message: string; failures?: string[] } {
  const workerLog = defaultWorkerLogPath(root);
  const result = verifyTraceRows(workerLog, mission.traceRows, {});
  if (result.failures.length > 0) {
    return {
      ok: false,
      message: "TRACE MAPPING FAILED",
      failures: result.failures.map((f) => `DoD ${f.row.dodId}: ${f.reason}`),
    };
  }
  return { ok: true };
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
