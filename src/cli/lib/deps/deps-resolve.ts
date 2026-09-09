import { hmacSha256Hex, canonicalizeRepositoryIdentifier } from "../receipt-attribution.js";
import { resolveOrgExportConfig } from "../org-export-config.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { readLedgerTip } from "../ledger/ledger-ref.js";
import { verifyLedgerChain } from "../ledger/ledger-verify.js";
import { depsRefForRepo } from "./deps-slug.js";
import type { DependencyCheckResult, MissionDependency } from "./deps-types.js";

function expectedRepoHash(root: string, repo: string): string {
  const org = resolveOrgExportConfig(root);
  return hmacSha256Hex(org.pepper, canonicalizeRepositoryIdentifier(repo));
}

/** Offline: walk fetched refs/gxt/deps/<slug> only. */
export function checkMissionDependency(root: string, dep: MissionDependency): DependencyCheckResult {
  const ref = depsRefForRepo(dep.repo);
  const tip = readLedgerTip(root, ref);
  if (!tip) {
    return {
      repo: dep.repo,
      msn_id: dep.msn_id,
      code: GXT_ERROR.DEPENDENCY_UNFETCHED,
      message: `${ref} is not fetched`,
    };
  }
  const chain = verifyLedgerChain(root, ref);
  if (!chain.ok) {
    return {
      repo: dep.repo,
      msn_id: dep.msn_id,
      code: GXT_ERROR.DEPENDENCY_UNSATISFIED,
      message: chain.errors[0] ?? "dependency ledger chain broken",
    };
  }
  const matches = [...chain.entries].reverse().filter((e) => e.msn_id === dep.msn_id && e.entry_kind === "receipt");
  const newest = matches[0];
  if (!newest) {
    return {
      repo: dep.repo,
      msn_id: dep.msn_id,
      code: GXT_ERROR.DEPENDENCY_UNSATISFIED,
      message: `no receipt entry for ${dep.msn_id}`,
    };
  }
  const wantHash = dep.expected_repository_hash ?? expectedRepoHash(root, dep.repo);
  if (newest.repository_hash !== wantHash) {
    return {
      repo: dep.repo,
      msn_id: dep.msn_id,
      code: GXT_ERROR.DEPENDENCY_ORG_MISMATCH,
      message: "repository_hash does not match consumer GANTRY_ORG_PEPPER",
    };
  }
  const status = newest.payload.verify_status;
  if ((dep.require?.verify_status ?? "passed") === "passed" && status !== "passed") {
    return {
      repo: dep.repo,
      msn_id: dep.msn_id,
      code: GXT_ERROR.DEPENDENCY_UNSATISFIED,
      message: `verify_status is ${String(status)}`,
    };
  }
  if (dep.require?.signed === true && newest.payload.signed !== true) {
    return {
      repo: dep.repo,
      msn_id: dep.msn_id,
      code: GXT_ERROR.DEPENDENCY_UNSIGNED,
      message: "require.signed but newest receipt entry is unsigned",
    };
  }
  if (dep.require?.max_age_days !== undefined) {
    const issued = Date.parse(newest.issued_at);
    const maxMs = dep.require.max_age_days * 86_400_000;
    if (!Number.isFinite(issued) || Date.now() - issued > maxMs) {
      return {
        repo: dep.repo,
        msn_id: dep.msn_id,
        code: GXT_ERROR.DEPENDENCY_STALE,
        message: `entry older than ${dep.require.max_age_days} days`,
      };
    }
  }
  return { repo: dep.repo, msn_id: dep.msn_id, code: "ok", message: "satisfied" };
}
