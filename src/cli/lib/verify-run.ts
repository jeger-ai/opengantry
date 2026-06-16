import { assertMissionGatePresent, parseMissionFile } from "./mission-parser.js";
import { evaluateVerifyPhases } from "./verify-engine.js";
import {
  presentBreakGlassHuman,
  presentBreakGlassJson,
  presentFix,
  presentHuman,
  presentHumanInitFailure,
  presentJsonFromResult,
  presentJsonInitFailure,
  resolveVerifySink,
} from "./verify-present.js";
import type { VerifyOptions } from "./verify-types.js";
import { loadWorkspace } from "./workspace.js";

export interface VerifyRunResult {
  ok: boolean;
  exitCode: number;
}

/**
 * Unified verify orchestration: load workspace once, evaluate once, present by sink.
 */
export async function runVerifyCore(options: VerifyOptions): Promise<VerifyRunResult> {
  const { root, manifest } = loadWorkspace();
  if (!options.mission) {
    throw new Error("gapman verify: --mission is required");
  }
  const mission = parseMissionFile(root, options.mission);
  const missionArg = options.mission;
  const sink = resolveVerifySink(options);

  switch (sink) {
    case "break_glass_json":
      return presentBreakGlassJson(root, mission, options);
    case "break_glass_human":
      return presentBreakGlassHuman(root, mission, options);
    case "json": {
      try {
        assertMissionGatePresent(mission);
        const result = evaluateVerifyPhases(root, mission, options, manifest);
        return presentJsonFromResult(root, mission, missionArg, options, manifest, result);
      } catch (e) {
        return presentJsonInitFailure(options, e);
      }
    }
    case "fix_interactive":
    case "fix_noninteractive":
    case "human": {
      try {
        assertMissionGatePresent(mission);
      } catch (e) {
        return presentHumanInitFailure(options, e);
      }
      const result = evaluateVerifyPhases(root, mission, options, manifest);
      if (sink === "fix_interactive") {
        return presentFix(root, mission, missionArg, options, result, false, manifest);
      }
      if (sink === "fix_noninteractive") {
        return presentFix(root, mission, missionArg, options, result, true, manifest);
      }
      return presentHuman(root, mission, missionArg, options, result);
    }
    default: {
      const _exhaustive: never = sink;
      return _exhaustive;
    }
  }
}
