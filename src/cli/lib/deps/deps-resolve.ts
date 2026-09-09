import { hmacSha256Hex, canonicalizeRepositoryIdentifier } from "../receipt-attribution.js";
import { resolveOrgExportConfig } from "../org-export-config.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { appendLedgerIfEnabled } from "../ledger/ledger-append.js";
import { readLedgerTip, verifyLedgerChain } from "../ledger/ledger-chain.js";
import type { LedgerEntry } from "../ledger/ledger-entry.js";
import { msnIdOrDefault, type MissionDependencySpec, type ParsedMission } from "../types.js";
import { depsRefForRepo } from "./deps-slug.js";

export type DependencyFailureCode =
  | typeof GXT_ERROR.DEPENDENCY_UNFETCHED
  | typeof GXT_ERROR.DEPENDENCY_UNSATISFIED
  | typeof GXT_ERROR.DEPENDENCY_UNSIGNED
  | typeof GXT_ERROR.DEPENDENCY_STALE
  | typeof GXT_ERROR.DEPENDENCY_ORG_MISMATCH;

export type DependencyCheckResult =
  | { code: "ok"; repo: string; msn_id: string }
  | { code: DependencyFailureCode; repo: string; msn_id: string; message: string };

function expectedRepoHash(root: string, repo: string): string {
  const org = resolveOrgExportConfig(root);
  return hmacSha256Hex(org.pepper, canonicalizeRepositoryIdentifier(repo));
}

function fail(
  dep: MissionDependencySpec,
  code: DependencyFailureCode,
  message: string,
): DependencyCheckResult {
  return { repo: dep.repo, msn_id: dep.msn_id, code, message };
}

/** Offline: walk fetched refs/gxt/deps/<slug> only. */
export function checkMissionDependency(root: string, dep: MissionDependencySpec): DependencyCheckResult {
  const ref = depsRefForRepo(dep.repo);
  const tip = readLedgerTip(root, ref);
  if (!tip) {
    return fail(dep, GXT_ERROR.DEPENDENCY_UNFETCHED, `${ref} is not fetched`);
  }
  const chain = verifyLedgerChain(root, ref);
  if (!chain.ok) {
    return fail(dep, GXT_ERROR.DEPENDENCY_UNSATISFIED, chain.errors[0] ?? "dependency ledger chain broken");
  }
  const matches = [...chain.entries]
    .reverse()
    .filter(
      (e): e is Extract<LedgerEntry, { entry_kind: "receipt" }> =>
        e.msn_id === dep.msn_id && e.entry_kind === "receipt",
    );
  const newest = matches[0];
  if (!newest) {
    return fail(dep, GXT_ERROR.DEPENDENCY_UNSATISFIED, `no receipt entry for ${dep.msn_id}`);
  }
  const wantHash = dep.expected_repository_hash ?? expectedRepoHash(root, dep.repo);
  if (newest.repository_hash !== wantHash) {
    return fail(dep, GXT_ERROR.DEPENDENCY_ORG_MISMATCH, "repository_hash does not match consumer GANTRY_ORG_PEPPER");
  }
  const status = newest.payload.verify_status;
  if ((dep.require?.verify_status ?? "passed") === "passed" && status !== "passed") {
    return fail(dep, GXT_ERROR.DEPENDENCY_UNSATISFIED, `verify_status is ${String(status)}`);
  }
  if (dep.require?.signed === true && newest.payload.signed !== true) {
    return fail(dep, GXT_ERROR.DEPENDENCY_UNSIGNED, "require.signed but newest receipt entry is unsigned");
  }
  if (dep.require?.max_age_days !== undefined) {
    const issued = Date.parse(newest.issued_at);
    const maxMs = dep.require.max_age_days * 86_400_000;
    if (!Number.isFinite(issued) || Date.now() - issued > maxMs) {
      return fail(dep, GXT_ERROR.DEPENDENCY_STALE, `entry older than ${dep.require.max_age_days} days`);
    }
  }
  return { repo: dep.repo, msn_id: dep.msn_id, code: "ok" };
}

/** Check every depends_on row and append one aggregated ok ledger entry. */
export function checkMissionDependencies(root: string, mission: ParsedMission): DependencyCheckResult[] {
  const results = mission.dependsOn.map((d) => checkMissionDependency(root, d));
  const okResults = results.filter((r): r is Extract<DependencyCheckResult, { code: "ok" }> => r.code === "ok");
  if (okResults.length > 0) {
    appendLedgerIfEnabled(root, "dependency_check", msnIdOrDefault(mission), {
      repo: okResults.map((r) => r.repo).join(","),
      msn_id: msnIdOrDefault(mission),
      result: "ok",
    });
  }
  return results;
}
