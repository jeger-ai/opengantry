import { gitRun } from "#git/git.js";
import { GXT_ERROR } from "#core/error-codes.js";
import { readLedgerTip, verifyLedgerChain, type LedgerChainReport } from "./ledger-chain.js";
import type { LedgerEntry } from "./ledger-entry.js";
import type { MissionDependencySpec, ParsedMission } from "#core/mission-types.js";
import { depsRefForRepo } from "./deps-slug.js";

export type DependencyFailureCode =
  | typeof GXT_ERROR.DEPENDENCY_UNFETCHED
  | typeof GXT_ERROR.DEPENDENCY_UNSATISFIED
  | typeof GXT_ERROR.DEPENDENCY_UNSIGNED
  | typeof GXT_ERROR.DEPENDENCY_STALE;

export type DependencyCheckResult =
  | { code: "ok"; repo: string; msn_id: string }
  | { code: DependencyFailureCode; repo: string; msn_id: string; message: string };

function fail(dep: MissionDependencySpec, code: DependencyFailureCode, message: string): DependencyCheckResult {
  return { repo: dep.repo, msn_id: dep.msn_id, code, message };
}

/** The newest receipt entry for the mission and its commit (a consistent chain has one entry per commit, oldest first). */
function newestReceipt(root: string, chain: LedgerChainReport, msnId: string): { entry: Extract<LedgerEntry, { entry_kind: "receipt" }>; commit: string } | null {
  const commits = gitRun(root, ["rev-list", "--reverse", chain.tip ?? ""]).stdout.split("\n").filter(Boolean);
  if (commits.length !== chain.entries.length) return null; // never pair an entry with the wrong commit
  for (let i = chain.entries.length - 1; i >= 0; i--) {
    const entry = chain.entries[i];
    if (entry?.entry_kind === "receipt" && entry.msn_id === msnId) return { entry, commit: commits[i] ?? "" };
  }
  return null;
}

/**
 * Offline: walk fetched refs/gxt/deps/<slug> only. Fetch access to the dependency's ledger is the same-org proof;
 * `require.signed` needs a good signature from a trusted key (`%G?` = G) on the receipt entry's commit in this repository.
 */
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
  const found = newestReceipt(root, chain, dep.msn_id);
  if (!found) {
    return fail(dep, GXT_ERROR.DEPENDENCY_UNSATISFIED, `no receipt entry for ${dep.msn_id}`);
  }
  const { entry: newest, commit } = found;
  const status = newest.payload.verify_status;
  if ((dep.require?.verify_status ?? "passed") === "passed" && status !== "passed") {
    return fail(dep, GXT_ERROR.DEPENDENCY_UNSATISFIED, `verify_status is ${String(status)}`);
  }
  // %G? is G only for a good signature from a trusted key; U (untrusted), Y/X (expired), N, B, E all fail.
  const sig = dep.require?.signed === true ? gitRun(root, ["log", "-1", "--format=%G?", commit]).stdout.trim() : "G";
  if (sig !== "G") return fail(dep, GXT_ERROR.DEPENDENCY_UNSIGNED, `require.signed but receipt entry commit ${commit} has signature status ${sig || "none"}, not G: trust the producer's key (gpg.ssh.allowedSignersFile or GPG ownertrust)`);
  if (dep.require?.max_age_days !== undefined) {
    const issued = Date.parse(newest.issued_at);
    const maxMs = dep.require.max_age_days * 86_400_000;
    if (!Number.isFinite(issued) || Date.now() - issued > maxMs) {
      return fail(dep, GXT_ERROR.DEPENDENCY_STALE, `entry older than ${dep.require.max_age_days} days`);
    }
  }
  return { repo: dep.repo, msn_id: dep.msn_id, code: "ok" };
}

/** Check every depends_on row. */
export function checkMissionDependencies(root: string, mission: ParsedMission): DependencyCheckResult[] {
  return mission.dependsOn.map((d) => checkMissionDependency(root, d));
}
