import { assertMissionGatePresent, parseMissionFile } from "./mission-parser.js";
import {
  emitVerifyJson,
  runVerifyBreakGlass,
  runVerifyPhasesFromEngine,
} from "./verify-flow.js";
import { runVerifyWithFix } from "./verify-repair.js";
import {
  buildBreakGlassPayload,
  buildVerifyResultPayload,
  initFailurePayload,
} from "./verify-result-payload.js";
import type { VerifyOptions } from "./verify-types.js";
import { loadWorkspace } from "./workspace.js";

export interface VerifyRunResult {
  ok: boolean;
  exitCode: number;
}

export type VerifySinkMode = "human" | "json" | "fix" | "break_glass";

/**
 * Unified verify orchestration: load workspace once, branch by sink mode.
 * Human/json/fix/break-glass share one entry path.
 */
export async function runVerifyCore(options: VerifyOptions): Promise<VerifyRunResult> {
  const { root, manifest } = loadWorkspace();
  const mission = parseMissionFile(root, options.mission);
  const missionArg = options.mission;

  if (options.breakGlass === true) {
    if (options.json) {
      const payload = buildBreakGlassPayload(root, mission, options);
      emitVerifyJson(payload);
      return { ok: payload.exit_code === 0, exitCode: payload.exit_code };
    }
    const ok = runVerifyBreakGlass(root, mission, options);
    return { ok, exitCode: ok ? 0 : 2 };
  }

  if (options.json) {
    try {
      assertMissionGatePresent(mission);
      const payload = buildVerifyResultPayload(root, manifest, mission, missionArg, options);
      emitVerifyJson(payload);
      return { ok: payload.exit_code === 0, exitCode: payload.exit_code };
    } catch (e) {
      const payload = initFailurePayload(e);
      emitVerifyJson(payload);
      return { ok: false, exitCode: payload.exit_code };
    }
  }

  assertMissionGatePresent(mission);

  if (options.fix === true) {
    const savedExit = process.exitCode;
    process.exitCode = undefined;
    await runVerifyWithFix(root, mission, missionArg, options, manifest);
    const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
    if (exitCode === 0) {
      process.exitCode = savedExit;
    }
    return { ok: exitCode === 0, exitCode };
  }

  const savedExit = process.exitCode;
  process.exitCode = undefined;
  const ok = runVerifyPhasesFromEngine(root, mission, missionArg, options, manifest);
  const exitCode = ok ? 0 : typeof process.exitCode === "number" ? process.exitCode : 1;
  if (ok) {
    process.exitCode = savedExit;
  }
  return { ok, exitCode };
}

/**
 * Lib-level verify execution with typed result (no process.exitCode side channel for callers).
 */
export async function executeVerifyMission(options: VerifyOptions): Promise<VerifyRunResult> {
  return runVerifyCore(options);
}
