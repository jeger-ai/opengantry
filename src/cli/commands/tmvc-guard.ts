import { EXIT_CODE } from "#core/exit-codes.js";
import { logWarn, setExitCode } from "../output/cli-io.js";
import { runUserCommand } from "../output/command-boundary.js";
import { resolveRuntimeEnv } from "#missions/runtime-env.js";
import {
  evaluateStagedTmvcGuard,
  formatStagedTmvcAdvisory,
} from "#missions/staged-tmvc-guard.js";
import { loadWorkspace } from "#missions/workspace.js";

/** The pre-commit TMVC guard on the staged index: advisory, blocking when strict (or GANTRY_TMVC_GUARD_STRICT=1). */
export function runTmvcGuard(options: { mission: string; strict?: boolean }): void {
  runUserCommand({}, () => {
    const workspace = loadWorkspace();
    const resolved = resolveRuntimeEnv(workspace, options.mission);
    const result = evaluateStagedTmvcGuard({
      repoRoot: workspace.root,
      manifest: workspace.manifest,
      skillKey: resolved.skill_key,
      scope: resolved.scope,
    });
    for (const line of formatStagedTmvcAdvisory(result)) logWarn(line);
    const strict = options.strict === true || process.env.GANTRY_TMVC_GUARD_STRICT === "1";
    if (!result.skipped && !result.ok && strict) setExitCode(EXIT_CODE.FAILURE);
  });
}
