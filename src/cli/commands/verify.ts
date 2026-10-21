import { setExitCode } from "../output/cli-io.js";
import { Reporter, currentReporter } from "../output/reporter.js";
import { initFailurePayload } from "#missions/mission-verify/payload.js";
import { emitVerifyDocument } from "../flows/verify-presenters.js";
import type { VerifyOptions } from "../flows/verify-options.js";
import { resolveDefaultChangedBaseRef } from "#missions/mission-changed.js";
import { discoverChangedMissionFiles } from "#missions/mission-verify/engine.js";
import { loadWorkspace } from "#missions/workspace.js";
import { GantryUserError } from "#core/user-error.js";
import { reportUserFacingError } from "../output/errors.js";
import { runVerifyCore } from "../flows/verify-run.js";
import { appendEventSpool } from "#missions/event-spool.js";
import { resolveOrgExportConfig } from "#plane/org-export-config.js";
import { resolveRepositoryHash } from "#plane/receipt-attribution.js";
import { resolveMissionArg } from "../flows/mission-arg.js";
import { parseMissionFile } from "#missions/mission/parser.js";

function structuredVerifyOutput(options: VerifyOptions): boolean {
  return options.json === true || options.format !== undefined;
}

/** Boundary reporter: structured document on stdout, human error otherwise. */
function reportVerifyBoundaryError(e: unknown, options: VerifyOptions, reporter: Reporter): void {
  if (structuredVerifyOutput(options)) {
    const payload = initFailurePayload(e);
    let root: string | undefined;
    try {
      root = loadWorkspace().root;
    } catch {
      root = undefined;
    }
    emitVerifyDocument(payload, options, reporter, root === undefined ? {} : { root });
    setExitCode(payload.exit_code);
    return;
  }
  reportUserFacingError(e);
}

function assertVerifyOptionsCompatible(options: VerifyOptions): void {
  if (options.fix === true && structuredVerifyOutput(options)) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      "The --fix flag cannot be used with structured output (--json or --format json|sarif|junit). Automated repair is not supported in structured output mode.",
      undefined,
      2,
    );
  }
  if (options.changedMissions === true && options.exportPath?.trim()) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      "gantry verify --export cannot be used with --changed-missions (one envelope per mission file).",
      undefined,
      2,
    );
  }
  if (options.changedMissions === true && !options.mission) {
    return;
  }
  if (options.changedMissions === true && options.mission) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      "Use either --mission or --changed-missions, not both.",
      undefined,
      2,
    );
  }
}

async function runVerifyChangedMissions(options: VerifyOptions, reporter: Reporter): Promise<void> {
  const { root } = loadWorkspace();
  const baseRef = options.baseRef?.trim() || resolveDefaultChangedBaseRef(root);
  const missions = discoverChangedMissionFiles(root, baseRef);
  if (missions.length === 0) {
    reporter.info(`gantry verify: no changed mission files vs ${baseRef}`);
    return;
  }
  let worstExit = 0;
  for (const mission of missions) {
    reporter.info(`gantry verify: ${mission} (changed vs ${baseRef})`);
    const result = await runVerifyCore({ ...options, mission, changedMissions: false }, reporter);
    if (!result.ok && result.exitCode > worstExit) {
      worstExit = result.exitCode;
    }
  }
  if (worstExit !== 0) {
    setExitCode(worstExit);
  }
}

function recordVerifyAttempt(root: string, options: VerifyOptions, ok: boolean, exitCode: number): void {
  try {
    if (!options.mission) return;
    const resolved = resolveMissionArg(root, options.mission);
    const mission = parseMissionFile(root, resolved.missionRel);
    const org = resolveOrgExportConfig(root);
    appendEventSpool(root, {
      event_type: "verify_attempt",
      repository_hash: resolveRepositoryHash(root, org),
      msn_id: mission.msnId ?? undefined,
      payload: {
        status: ok ? "passed" : "failed",
        exit_code: exitCode,
      },
    });
  } catch {
    // best-effort spool
  }
}

/**
 * The verify command. Its one reporter comes from its options (--json, --format, --audience); an in-process caller
 * that sets no audience inherits the command's.
 */
export async function runVerify(options: VerifyOptions): Promise<void> {
  const reporter = Reporter.forVerify({ ...options, audience: options.audience ?? currentReporter().audience });
  try {
    assertVerifyOptionsCompatible(options);
  } catch (e) {
    reportVerifyBoundaryError(e, options, reporter);
    return;
  }

  if (options.changedMissions) {
    try {
      await runVerifyChangedMissions(options, reporter);
    } catch (e) {
      reportVerifyBoundaryError(e, options, reporter);
    }
    return;
  }

  try {
    const result = await runVerifyCore(options, reporter);
    const { root } = loadWorkspace();
    recordVerifyAttempt(root, options, result.ok, result.exitCode);
    if (!result.ok) {
      setExitCode(result.exitCode);
    }
  } catch (e) {
    reportVerifyBoundaryError(e, options, reporter);
  }
}
