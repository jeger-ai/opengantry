import fs from "node:fs";
import path from "node:path";
import { gitConfigGet, gitConfigSet, gitRunOk } from "#git/git.js";

/** Local git config that makes `.githooks/pre-commit` pass `--strict`. */
export const TMVC_GUARD_STRICT_KEY = "gantry.tmvcGuardStrict";

/** Tracked hooks directory `gantry init` installs and `core.hooksPath` must name. */
const TRACKED_HOOKS_PATH = ".githooks";

const PRE_COMMIT_REL = `${TRACKED_HOOKS_PATH}/pre-commit`;

interface HooksStatus {
  strictArmed: boolean;
  hooksPath: string | null;
  preCommitPresent: boolean;
}

type HooksInstallResult =
  | { ok: true; alreadyInstalled: boolean; hooksPath: string }
  | { ok: false; message: string };

function localConfig(repoRoot: string, key: string): string | null {
  const result = gitRunOk(repoRoot, ["config", "--local", "--get", key]);
  if (!result.ok || !result.stdout.trim()) return null;
  return result.stdout.trim();
}

export function readHooksStatus(repoRoot: string): HooksStatus {
  return {
    strictArmed: localConfig(repoRoot, TMVC_GUARD_STRICT_KEY) === "true",
    hooksPath: gitConfigGet(repoRoot, "core.hooksPath"),
    preCommitPresent: fs.existsSync(path.join(repoRoot, PRE_COMMIT_REL)),
  };
}

/**
 * Arm strict staged-TMVC enforcement on the tracked pre-commit hook.
 * Does not rewrite the hook file. Refuses when Git would run a different hooks path.
 */
export function installTmvcStrictHook(repoRoot: string): HooksInstallResult {
  if (!fs.existsSync(path.join(repoRoot, PRE_COMMIT_REL))) {
    return { ok: false, message: "hooks install: missing .githooks/pre-commit — run gantry init" };
  }

  const hooksPath = gitConfigGet(repoRoot, "core.hooksPath");
  if (hooksPath !== null && hooksPath !== TRACKED_HOOKS_PATH) {
    return {
      ok: false,
      message: `hooks install: core.hooksPath=${hooksPath} (expected ${TRACKED_HOOKS_PATH}). Strict mode was not armed.`,
    };
  }

  if (hooksPath === null && !gitConfigSet(repoRoot, "core.hooksPath", TRACKED_HOOKS_PATH)) {
    return { ok: false, message: "hooks install: failed to set core.hooksPath=.githooks" };
  }

  const alreadyInstalled = localConfig(repoRoot, TMVC_GUARD_STRICT_KEY) === "true";
  if (!alreadyInstalled && !gitConfigSet(repoRoot, TMVC_GUARD_STRICT_KEY, "true")) {
    return { ok: false, message: "hooks install: failed to set gantry.tmvcGuardStrict" };
  }

  return { ok: true, alreadyInstalled, hooksPath: TRACKED_HOOKS_PATH };
}

/** Clear the local strict key only. `core.hooksPath` stays as the operator left it. */
export function uninstallTmvcStrictHook(repoRoot: string): { removed: boolean } {
  if (localConfig(repoRoot, TMVC_GUARD_STRICT_KEY) === null) return { removed: false };
  return { removed: gitRunOk(repoRoot, ["config", "--local", "--unset", TMVC_GUARD_STRICT_KEY]).ok };
}

// ---- pre-push ref lines (ADR-0052 A8: `gantry hook pre-push` reads what git passes on stdin) ----

/** Git's placeholder for "no object" in pre-push ref lines. */
export const ZERO_SHA = "0".repeat(40);

interface PrePushRefLine {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

/** Parse `<local ref> <local sha> <remote ref> <remote sha>` lines; blank or malformed lines are skipped. */
export function parsePrePushRefLines(text: string): PrePushRefLine[] {
  const out: PrePushRefLine[] = [];
  for (const raw of text.split("\n")) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length !== 4) continue;
    const [localRef, localSha, remoteRef, remoteSha] = parts as [string, string, string, string];
    if (!/^[0-9a-f]{40}$/i.test(localSha) || !/^[0-9a-f]{40}$/i.test(remoteSha)) continue;
    out.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return out;
}

export interface PushRange {
  base: string;
  head: string;
}

/** Of `bases`, the one with the fewest commits to `head` (ties to the earlier); bases that do not resolve are skipped. */
function closestBase(repoRoot: string, head: string, bases: readonly string[]): string | null {
  const scored = bases.map((base) => ({ base, r: gitRunOk(repoRoot, ["rev-list", "--count", `${base}..${head}`]) }));
  const ok = scored.filter((x) => x.r.ok).map((x) => ({ base: x.base, n: Number(x.r.stdout.trim()) }));
  return ok.reduce<{ base: string; n: number } | null>((best, x) => (!best || x.n < best.n ? x : best), null)?.base ?? null;
}

/** Merge-bases with the upstream, `<remote>/HEAD|main|master`, then local main, master (a stale local main loses). */
function remoteMergeBases(repoRoot: string, head: string, remote: string): string[] {
  const refs = ["@{upstream}", ...["HEAD", "main", "master"].map((b) => `refs/remotes/${remote}/${b}`), "main", "master"];
  const found = refs.map((o) => gitRunOk(repoRoot, ["merge-base", head, o])).filter((r) => r.ok);
  return found.map((r) => r.stdout.trim()).filter((b) => b.length > 0);
}

/** Base for a new remote ref: the newest of `remoteMergeBases`, else the parent. A manual run assumes `origin`. */
export function fallbackPushBase(repoRoot: string, head: string, remote = "origin"): string | null {
  const best = closestBase(repoRoot, head, remoteMergeBases(repoRoot, head, remote));
  if (best) return best;
  const parent = gitRunOk(repoRoot, ["rev-parse", "--verify", `${head}~1^{commit}`]);
  return parent.ok && parent.stdout.trim() ? parent.stdout.trim() : null;
}

/**
 * Ranges to evaluate for a push. A ref deletion (all-zero local sha) contributes nothing; a new remote ref (all-zero
 * remote sha) compares against `fallbackPushBase` for `remote`; an update compares `remote sha..local sha`, unless the
 * head merged the remote's main since: then the newest merge-base the remote sha lacks, so main's missions stay out.
 */
export function pushRangesFromRefLines(repoRoot: string, lines: readonly PrePushRefLine[], remote = "origin"): PushRange[] {
  const ranges: PushRange[] = [];
  for (const line of lines) {
    if (line.localSha === ZERO_SHA) continue;
    const merged = (m: string) => !gitRunOk(repoRoot, ["merge-base", "--is-ancestor", m, line.remoteSha]).ok;
    const base =
      line.remoteSha === ZERO_SHA
        ? fallbackPushBase(repoRoot, line.localSha, remote)
        : (closestBase(repoRoot, line.localSha, remoteMergeBases(repoRoot, line.localSha, remote).filter(merged)) ??
          line.remoteSha);
    if (!base || base === line.localSha) continue;
    ranges.push({ base, head: line.localSha });
  }
  return ranges;
}
