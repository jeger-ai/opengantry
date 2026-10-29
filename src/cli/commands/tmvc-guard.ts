import { EXIT_CODE } from "#core/exit-codes.js";
import { logWarn, setExitCode } from "../output/cli-io.js";
import { emitCliJson, runUserCommand } from "../output/command-boundary.js";
import { resolveRuntimeEnv } from "#missions/runtime-env.js";
import { resolvePinnedMission } from "#missions/mission/resolution.js";
import {
  evaluateStagedTmvcGuard,
  formatStagedTmvcAdvisory,
} from "#missions/staged-tmvc-guard.js";
import { loadWorkspace } from "#missions/workspace.js";

export interface TmvcGuardCliOptions {
  mission?: string;
  strict?: boolean;
  json?: boolean;
}

function advisoryToStderr(lines: readonly string[]): void {
  for (const line of lines) {
    logWarn(line);
  }
}

export function runTmvcGuard(options: TmvcGuardCliOptions): void {
  runUserCommand({ json: options.json }, () => {
    const workspace = loadWorkspace();
    const missionRel = options.mission?.trim() || resolvePinnedMission(workspace.root) || null;

    if (!missionRel) {
      const msg = "tmvc guard: no pinned mission — skipping TMVC check (advisory)";
      if (options.json) {
        emitCliJson({ ok: true, skipped: true, skip_reason: "no pinned mission" });
        return;
      }
      advisoryToStderr([msg]);
      return;
    }

    const resolved = resolveRuntimeEnv(workspace, missionRel);
    const result = evaluateStagedTmvcGuard({
      repoRoot: workspace.root,
      manifest: workspace.manifest,
      skillKey: resolved.skill_key,
      scope: resolved.scope,
    });

    const strict = options.strict === true || process.env.GANTRY_TMVC_GUARD_STRICT === "1";

    if (options.json) {
      emitCliJson({
        ok: result.ok,
        skipped: result.skipped,
        skip_reason: result.skipReason ?? "",
        strict,
        violations: result.violations,
        staged_paths: result.stagedPaths,
        tmvc_roots: result.tmvcRoots,
        forbidden_zones: result.forbiddenZones,
        mission: resolved.mission_file,
        skill_key: resolved.skill_key,
      });
      if (strict && !result.ok && !result.skipped) setExitCode(EXIT_CODE.FAILURE);
      return;
    }

    const lines = formatStagedTmvcAdvisory(result);
    advisoryToStderr(lines);
    if (!result.skipped && !result.ok && strict) {
      setExitCode(EXIT_CODE.FAILURE);
    }
  });
}
