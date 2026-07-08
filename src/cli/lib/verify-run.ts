import { CLI_NAME } from "./constants.js";
import { assertMissionGatePresent, parseMissionFile } from "./missions/parser.js";
import { GapmanUserError } from "./errors.js";
import { loadWorkspace } from "./workspace.js";
import {
  evaluateVerifyPhases,
  type VerifyOptions,
} from "./verify-engine.js";
import {
  buildVerifyResultPayload,
  initFailurePayload,
  type VerifyResultPayload,
} from "./verify-payload.js";
import { resolveVerifySink, type VerifySink } from "./verify-presenters.js";
import {
  presentBreakGlassHuman,
  presentBreakGlassJson,
  presentFix,
  presentHuman,
  presentHumanInitFailure,
  presentJsonFromResult,
  presentJsonInitFailure,
} from "./verify-presenters.js";

export interface VerifyRunResult {
  ok: boolean;
  exitCode: number;
}

/** Unified verify orchestration: load workspace once, evaluate once, present by sink. */
export async function runVerifyCore(options: VerifyOptions): Promise<VerifyRunResult> {
  const { root, manifest } = loadWorkspace();
  if (!options.mission) {
    throw new Error("gantry verify: --mission is required");
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
        return presentFix(root, mission, missionArg, options, result, false, manifest, runVerifyCore);
      }
      if (sink === "fix_noninteractive") {
        return presentFix(root, mission, missionArg, options, result, true, manifest, runVerifyCore);
      }
      return presentHuman(root, mission, missionArg, options, result);
    }
    default: {
      const _exhaustive: never = sink;
      return _exhaustive;
    }
  }
}

export function buildVerifyResultPayloadFromOptions(options: VerifyOptions): VerifyResultPayload {
  try {
    if (!options.mission) {
      throw new GapmanUserError("INVALID_ARGUMENT", `${CLI_NAME} verify: --mission is required`, undefined, 2);
    }
    const { root, manifest } = loadWorkspace();
    const mission = parseMissionFile(root, options.mission);
    assertMissionGatePresent(mission);
    return buildVerifyResultPayload(root, manifest, mission, options.mission, options);
  } catch (e) {
    return initFailurePayload(e);
  }
}

export type { VerifyPresentResult } from "./verify-presenters.js";
export type { VerifySink } from "./verify-presenters.js";
