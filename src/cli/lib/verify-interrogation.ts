import YAML from "yaml";
import { GXT_ERROR } from "./gxt-error-codes.js";
import type { GxtErrorCode } from "./gxt-error-codes.js";
import { gitRunOk, gitRevParse } from "./git.js";
import {
  listCommitChangedPaths,
  listMsnSubjectCommits,
  resolveMsnScanDepth,
} from "./git-proof.js";
import { resolvePlannerEmails } from "./planner-identity.js";
import { isStubOperatorAnswer } from "./interrogate/answers.js";
import { interrogationSha256 } from "./interrogate/findings.js";
import { isLegislativeStub } from "./missions/formatter.js";
import type { Manifest, ParsedMission } from "./types.js";
import { normalizeRepoRelativePath, pathRiskTier } from "./tmvc-path.js";
import type { VerifyOptions } from "./verify-options.js";
import { SHALLOW_HISTORY_HINT } from "./perimeter.js";
import type { InterrogationFailure } from "./verify-failure.js";

export interface InterrogationPhaseOutcome {
  failure: InterrogationFailure | null;
  warnings: string[];
}

function interrogationFailure(
  executorLogPath: string,
  code: GxtErrorCode,
  message: string,
  warnings: string[] = [],
): InterrogationFailure {
  return {
    ok: false,
    phase: "interrogation",
    message,
    exitCode: 1,
    executorLogPath,
    interrogationCode: code,
    ...(warnings.length > 0 ? { interrogationWarnings: warnings } : {}),
  };
}

function readMissionAtCommit(root: string, commit: string, missionRel: string): string | null {
  if (!gitRevParse(root, commit)) return null;
  const r = gitRunOk(root, ["show", `${commit}:${missionRel}`]);
  if (!r.ok) return null;
  return r.stdout;
}

function stampedInterrogationDigest(body: string): string | null | undefined {
  try {
    const doc = YAML.parse(body) as { interrogation_sha256?: unknown };
    if (doc.interrogation_sha256 === undefined || doc.interrogation_sha256 === null) {
      return null;
    }
    if (typeof doc.interrogation_sha256 === "string") {
      return doc.interrogation_sha256;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function compareStampedDigest(
  stamped: string | null | undefined,
  current: string | null,
): InterrogationFailure | null {
  if (stamped === undefined) {
    return interrogationFailure(
      "",
      GXT_ERROR.INTERROGATION_MISMATCH,
      "cannot parse interrogation_sha256 from Planner stamp blob",
    );
  }
  if (stamped === null && current === null) return null;
  if (stamped === null && current !== null) {
    return interrogationFailure(
      "",
      GXT_ERROR.INTERROGATION_MISMATCH,
      "interrogation block added after Planner stamp",
    );
  }
  if (stamped !== null && current === null) {
    return interrogationFailure(
      "",
      GXT_ERROR.INTERROGATION_MISMATCH,
      "interrogation block removed after Planner stamp",
    );
  }
  if (stamped !== current) {
    return interrogationFailure(
      "",
      GXT_ERROR.INTERROGATION_MISMATCH,
      "interrogation_sha256 changed after Planner stamp",
    );
  }
  return null;
}

function resolvePlannerStampHash(
  root: string,
  proofMsnId: string,
  scanDepth?: number,
): string | null {
  const plannerEmails = resolvePlannerEmails(root).emails;
  if (plannerEmails.length === 0) return null;
  const stampRows = listMsnSubjectCommits(root, proofMsnId, resolveMsnScanDepth(scanDepth));
  const stamp = stampRows.find((r) => plannerEmails.includes(r.authorEmail.trim().toLowerCase()));
  return stamp?.hash ?? null;
}

interface PathDriftInput {
  root: string;
  manifest: Manifest;
  mission: ParsedMission;
  missionRel: string;
  msnId: string;
  scanDepth?: number;
}

function evaluatePathDrift(input: PathDriftInput): { failures: string[]; warnings: string[] } {
  const { root, manifest, mission, missionRel, msnId, scanDepth } = input;
  const failures: string[] = [];
  const warnings: string[] = [];
  const declared = new Set(mission.declaredPaths.map((p) => normalizeRepoRelativePath(p)));
  const normMissionRel = normalizeRepoRelativePath(missionRel);
  const stampHash = resolvePlannerStampHash(root, msnId, scanDepth);

  // Shallow clones may yield no MSN commits; drift passes vacuously (GXT_PERIMETER_SHALLOW_HISTORY posture).
  const rows = listMsnSubjectCommits(root, msnId, resolveMsnScanDepth(scanDepth));
  const changed = new Set<string>();

  if (stampHash) {
    for (const row of rows) {
      for (const p of listCommitChangedPaths(root, row.hash)) {
        const norm = normalizeRepoRelativePath(p);
        if (row.hash === stampHash && norm === normMissionRel) continue;
        changed.add(norm);
      }
    }
  } else {
    for (const row of rows) {
      for (const p of listCommitChangedPaths(root, row.hash)) {
        const norm = normalizeRepoRelativePath(p);
        if (norm === normMissionRel) continue;
        changed.add(norm);
      }
    }
  }

  for (const p of changed) {
    if (declared.has(p)) continue;
    const tier = pathRiskTier(manifest, p);
    if (tier === "Tier-3") {
      failures.push(`${GXT_ERROR.INTERROGATION_PATH_DRIFT}: undeclared Tier-3 path touched: ${p}`);
    } else if (tier === "Tier-2") {
      warnings.push(`undeclared Tier-2 path touched: ${p}`);
    }
  }
  return { failures, warnings };
}

interface StampDigestInput {
  root: string;
  proofMsnId: string;
  missionRel: string;
  mission: ParsedMission;
  options: VerifyOptions;
  executorLogPath: string;
  warnings: string[];
}

function validateStampedInterrogationDigest(
  input: StampDigestInput,
): InterrogationPhaseOutcome | null {
  const { root, proofMsnId, missionRel, mission, options, executorLogPath, warnings } = input;
  if (isLegislativeStub(mission)) return null;
  const stampHash = resolvePlannerStampHash(root, proofMsnId, options.scanDepth);
  if (!stampHash) return null;
  const body = readMissionAtCommit(root, stampHash, missionRel);
  if (body === null) {
    return {
      failure: interrogationFailure(
        executorLogPath,
        GXT_ERROR.INTERROGATION_SHALLOW_HISTORY,
        `${GXT_ERROR.INTERROGATION_SHALLOW_HISTORY}: cannot read mission at Planner stamp ${stampHash} — ${SHALLOW_HISTORY_HINT}`,
      ),
      warnings,
    };
  }
  const stampedDigest = stampedInterrogationDigest(body);
  const digestFailure = compareStampedDigest(stampedDigest, mission.interrogationSha256);
  if (digestFailure) {
    return {
      failure: { ...digestFailure, executorLogPath },
      warnings,
    };
  }
  return null;
}

function validateInterrogationRows(
  rows: ParsedMission["interrogation"],
  mission: ParsedMission,
  executorLogPath: string,
  warnings: string[],
): InterrogationPhaseOutcome | null {
  for (const row of rows) {
    if (isStubOperatorAnswer(row.operator_answer)) {
      return {
        failure: interrogationFailure(
          executorLogPath,
          GXT_ERROR.INTERROGATION_STUB,
          `interrogation stub answer on finding ${row.finding_id}`,
        ),
        warnings,
      };
    }
  }

  if (!mission.interrogationSha256) {
    return {
      failure: interrogationFailure(
        executorLogPath,
        GXT_ERROR.INTERROGATION_MISMATCH,
        "mission has interrogation rows but missing interrogation_sha256",
      ),
      warnings,
    };
  }

  const expected = interrogationSha256(rows);
  if (expected !== mission.interrogationSha256) {
    return {
      failure: interrogationFailure(
        executorLogPath,
        GXT_ERROR.INTERROGATION_MISMATCH,
        "interrogation_sha256 does not match interrogation block",
      ),
      warnings,
    };
  }

  return null;
}

export interface InterrogationPhaseInput {
  root: string;
  manifest: Manifest;
  mission: ParsedMission;
  missionRel: string;
  options: VerifyOptions;
  proofMsnId: string;
  executorLogPath: string;
}

export function evaluateInterrogationPhase(input: InterrogationPhaseInput): InterrogationPhaseOutcome {
  const { root, manifest, mission, missionRel, options, proofMsnId, executorLogPath } = input;
  const warnings: string[] = [];
  const rows = mission.interrogation;

  if (options.requireInterrogation === true && rows.length === 0) {
    return {
      failure: interrogationFailure(
        executorLogPath,
        GXT_ERROR.INTERROGATION_REQUIRED,
        "mission missing required interrogation block",
      ),
      warnings,
    };
  }

  if (rows.length === 0) {
    return { failure: null, warnings };
  }

  const rowFailure = validateInterrogationRows(rows, mission, executorLogPath, warnings);
  if (rowFailure) return rowFailure;

  const stampOutcome = validateStampedInterrogationDigest({
    root,
    proofMsnId,
    missionRel,
    mission,
    options,
    executorLogPath,
    warnings,
  });
  if (stampOutcome) return stampOutcome;

  const drift = evaluatePathDrift({
    root,
    manifest,
    mission,
    missionRel,
    msnId: proofMsnId,
    scanDepth: options.scanDepth,
  });
  warnings.push(...drift.warnings);
  if (drift.failures.length > 0) {
    return {
      failure: interrogationFailure(
        executorLogPath,
        GXT_ERROR.INTERROGATION_PATH_DRIFT,
        drift.failures[0]!,
        warnings,
      ),
      warnings,
    };
  }

  return { failure: null, warnings };
}
