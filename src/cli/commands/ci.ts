/** `gantry ci <check>`: the checks CI and the dev gate run (ADR-0052 step 5b; scripts/validate-gxt.sh and verify-pr-missions.sh folded in). */
import { EXIT_CODE } from "#core/exit-codes.js";
import { CLI_NAME } from "#core/constants.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { runAtCommandBoundary, runAtCommandBoundaryAsync } from "../lib/command-boundary.js";
import { GantryUserError } from "#core/user-error.js";
import { checkMsnRange, checkUpgradeTmp, missionsForRange, resolveSha, type CiCheckResult } from "#missions/ci-checks.js";
import { evaluateTrustedAutomationCommit, evaluateTrustedAutomationRange } from "#missions/trusted-automation.js";
import { runVerifyCore } from "../lib/verify/verify-run.js";
import { loadWorkspace } from "#missions/workspace.js";

export interface CiRangeOptions {
  base?: string;
  head?: string;
}

function resolveRange(root: string, options: CiRangeOptions): { baseSha: string; headSha: string } {
  const baseRef = options.base?.trim() || process.env.BASE_SHA?.trim() || "";
  const headRef = options.head?.trim() || process.env.HEAD_SHA?.trim() || "HEAD";
  if (!baseRef) {
    throw new GantryUserError("INVALID_ARGUMENT", `${CLI_NAME} ci: --base <ref> is required (or BASE_SHA in the environment)`, "gantry ci <check> --base origin/main --head HEAD", 2);
  }
  const baseSha = resolveSha(root, baseRef);
  const headSha = resolveSha(root, headRef);
  if (!baseSha) throw new GantryUserError("INVALID_ARGUMENT", `${CLI_NAME} ci: invalid base ref: ${baseRef}`, undefined, 2);
  if (!headSha) throw new GantryUserError("INVALID_ARGUMENT", `${CLI_NAME} ci: invalid head ref: ${headRef}`, undefined, 2);
  return { baseSha, headSha };
}

function present(result: CiCheckResult): void {
  for (const line of result.lines) {
    if (result.failures.includes(line)) logError(line);
    else logInfo(line);
  }
  if (!result.ok) setExitCode(EXIT_CODE.FAILURE);
}

export function runCiMsnRange(options: CiRangeOptions): void {
  runAtCommandBoundary(1, () => {
    const { root, manifest } = loadWorkspace();
    const { baseSha, headSha } = resolveRange(root, options);
    present(checkMsnRange(root, manifest, baseSha, headSha));
  });
}

export function runCiUpgradeTmp(): void {
  runAtCommandBoundary(1, () => {
    const { root } = loadWorkspace();
    present(checkUpgradeTmp(root));
  });
}

export interface CiTrustedAutomationOptions extends CiRangeOptions {
  commit?: string;
}

/** Prints the trusted-automation verdict for one commit or a range; exit 0 when eligible, 1 otherwise. */
export function runCiTrustedAutomation(options: CiTrustedAutomationOptions): void {
  runAtCommandBoundary(1, () => {
    const { root, manifest } = loadWorkspace();
    const verdict = options.commit?.trim()
      ? evaluateTrustedAutomationCommit(root, manifest, resolveSha(root, options.commit.trim()) ?? options.commit.trim())
      : (() => {
          const { baseSha, headSha } = resolveRange(root, options);
          return evaluateTrustedAutomationRange(root, manifest, baseSha, headSha);
        })();
    if (verdict.eligible) {
      logInfo(verdict.reason);
      return;
    }
    logError(`TRUSTED-AUTOMATION-DENY: ${verdict.reason}`);
    setExitCode(EXIT_CODE.FAILURE);
  });
}

/** Full verify on every mission file the range changed; a range that touches enforced paths needs one unless automation is trusted. */
export async function runCiVerifyMissions(options: CiRangeOptions): Promise<void> {
  await runAtCommandBoundaryAsync(1, async () => {
    const { root, manifest } = loadWorkspace();
    const { baseSha, headSha } = resolveRange(root, options);
    const outcome = missionsForRange(root, manifest, baseSha, headSha);
    switch (outcome.kind) {
      case "none":
      case "trusted":
        logInfo(`${CLI_NAME} ci verify-missions: ${outcome.message}`);
        return;
      case "fail":
        logError(`${CLI_NAME} ci verify-missions FAILED: ${outcome.message}`);
        setExitCode(EXIT_CODE.FAILURE);
        return;
      case "verify": {
        for (const mission of outcome.missions) {
          logInfo(`${CLI_NAME} ci verify-missions: ${CLI_NAME} verify --mission ${mission}`);
          const result = await runVerifyCore({ mission, audience: "verifier" });
          if (!result.ok) {
            setExitCode(result.exitCode || 1);
            return;
          }
        }
        logInfo(`${CLI_NAME} ci verify-missions OK (${String(outcome.missions.length)} mission(s))`);
        return;
      }
      default: {
        const _exhaustive: never = outcome;
        return _exhaustive;
      }
    }
  });
}
