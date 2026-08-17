import { logInfo, setExitCode } from "../lib/cli-io.js";
import { gitRevParse } from "../lib/git.js";
import { initFailurePayload } from "../lib/verify-payload.js";
import { emitVerifyJson } from "../lib/verify-presenters.js";
import type { VerifyOptions } from "../lib/verify-options.js";
import { discoverChangedMissionFiles } from "../lib/verify-engine.js";
import { loadWorkspace } from "../lib/workspace.js";
import { GantryUserError, reportUserFacingError } from "../lib/errors.js";
import { runVerifyCore } from "../lib/verify-run.js";
import { appendEventSpool } from "../lib/event-spool.js";
import { resolveOrgExportConfig } from "../lib/org-export-config.js";
import { resolveRepositoryHash } from "../lib/receipt-attribution.js";
import { resolveMissionArg } from "../lib/mission-arg.js";
import { parseMissionFile } from "../lib/missions/parser.js";

export type { VerifyOptions } from "../lib/verify-options.js";

/** Single verify boundary reporter: JSON payload when --json, canonical human error otherwise. */
function reportVerifyBoundaryError(e: unknown, options: VerifyOptions): void {
  if (options.json) {
    const payload = initFailurePayload(e);
    emitVerifyJson(payload, options);
    setExitCode(payload.exit_code);
    return;
  }
  reportUserFacingError(e);
}

function assertVerifyOptionsCompatible(options: VerifyOptions): void {
  if (options.json === true && options.fix === true) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      "The --fix flag cannot be used with --json. Automated repair is not supported in structured output mode.",
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

function resolveChangedMissionsBaseRef(root: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    if (gitRevParse(root, candidate)) return candidate;
  }
  return "HEAD~1";
}

async function runVerifyChangedMissions(options: VerifyOptions): Promise<void> {
  const { root } = loadWorkspace();
  const baseRef = resolveChangedMissionsBaseRef(root, options.baseRef);
  const missions = discoverChangedMissionFiles(root, baseRef);
  if (missions.length === 0) {
    logInfo(`gantry verify: no changed mission files vs ${baseRef}`);
    return;
  }
  let worstExit = 0;
  for (const mission of missions) {
    logInfo(`gantry verify: ${mission} (changed vs ${baseRef})`);
    const result = await runVerifyCore({ ...options, mission, changedMissions: false });
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

export async function runVerify(options: VerifyOptions): Promise<void> {
  try {
    assertVerifyOptionsCompatible(options);
  } catch (e) {
    reportVerifyBoundaryError(e, options);
    return;
  }

  if (options.changedMissions) {
    try {
      await runVerifyChangedMissions(options);
    } catch (e) {
      reportVerifyBoundaryError(e, options);
    }
    return;
  }

  try {
    const result = await runVerifyCore(options);
    const { root } = loadWorkspace();
    recordVerifyAttempt(root, options, result.ok, result.exitCode);
    if (!result.ok) {
      setExitCode(result.exitCode);
    }
  } catch (e) {
    reportVerifyBoundaryError(e, options);
  }
}
