/**
 * CI checks (ADR-0052 step 5b, ported from scripts/validate-gxt.sh and scripts/verify-pr-missions.sh): path-scoped
 * `[MSN]` commit subjects with gxt-bypass notes and trusted automation, the mission requirement over a PR range, and
 * the upgrade staging guard. `gantry ci` presents them; CI and the dev gate call `gantry ci`.
 */
import { isMsnEnforcedPath, isValidBypassNote } from "#core/trusted-automation.js";
import { GXT_BYPASS_NOTES_REF } from "./break-glass.js";
import { gitRunOk } from "#git/git.js";
import { discoverChangedMissions } from "./mission-changed.js";
import { evaluateTrustedAutomationCommit, evaluateTrustedAutomationRange, manifestMsnEnforcedPrefixes } from "./trusted-automation.js";
import type { Manifest } from "#core/manifest.js";

export interface CiCheckResult {
  ok: boolean;
  /** Human lines in order; failures are also in `failures`. */
  lines: string[];
  failures: string[];
}

function lines(root: string, args: string[]): string[] {
  const r = gitRunOk(root, args);
  return r.ok ? r.stdout.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

export function resolveSha(root: string, ref: string): string | null {
  const r = gitRunOk(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

export function commitHasBypassNote(root: string, sha: string): boolean {
  const r = gitRunOk(root, ["notes", `--ref=${GXT_BYPASS_NOTES_REF}`, "show", sha]);
  return r.ok && isValidBypassNote(r.stdout);
}

const MSN_SUBJECT_RE = /^\[MSN-\d{4}\]/;

/** Every non-merge commit in base..head that touches an MSN-enforced path needs an [MSN] subject, a bypass note or a trusted-automation verdict. */
export function checkMsnRange(root: string, manifest: Manifest, baseSha: string, headSha: string): CiCheckResult {
  const prefixes = manifestMsnEnforcedPrefixes(manifest);
  const out: string[] = [];
  for (const commit of lines(root, ["rev-list", "--no-merges", `${baseSha}..${headSha}`])) {
    const touched = lines(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit]);
    if (!touched.some((f) => isMsnEnforcedPath(f, prefixes))) continue;
    const subject = gitRunOk(root, ["log", "-1", "--format=%s", commit]).stdout.trim();
    if (MSN_SUBJECT_RE.test(subject)) continue;
    if (commitHasBypassNote(root, commit)) continue;
    const verdict = evaluateTrustedAutomationCommit(root, manifest, commit);
    if (verdict.eligible) {
      out.push(verdict.reason);
      continue;
    }
    const failure = [
      `MSN check FAILED: commit ${commit} touches MSN-enforced paths but subject does not start with [MSN-NNNN] and has no gxt-bypass git note`,
      `  subject: ${subject}`,
      `  trusted automation: ${verdict.reason}`,
      `  hint: run gantry verify --break-glass --reason "..." with GANTRY_BYPASS_SECRET, push refs/notes/gxt-bypass`,
      "  touched paths (sample):",
      ...touched.slice(0, 20).map((p) => `    ${p}`),
    ].join("\n");
    return { ok: false, lines: [...out, failure], failures: [failure] };
  }
  out.push("MSN commit subjects OK (path-scoped: substrate + MANIFEST tmvc_roots)");
  return { ok: true, lines: out, failures: [] };
}

/** `.gitagent/.upgrade-tmp/` is gitignored staging; tracked files there are a mistake. */
export function checkUpgradeTmp(root: string): CiCheckResult {
  const tracked = lines(root, ["ls-files", ".gitagent/.upgrade-tmp"]);
  if (tracked.length > 0) {
    const failure = `upgrade-tmp check FAILED: tracked files under .gitagent/.upgrade-tmp/ (must be gitignored staging only)\n${tracked.join("\n")}`;
    return { ok: false, lines: [failure], failures: [failure] };
  }
  return { ok: true, lines: ["upgrade-tmp OK (no tracked staging files)"], failures: [] };
}

export type MissionRangeOutcome =
  | { kind: "verify"; missions: string[] }
  | { kind: "none"; message: string }
  | { kind: "trusted"; message: string }
  | { kind: "fail"; message: string };

/** Which missions a PR range must verify in full, or why none is needed, or why the range fails. */
export function missionsForRange(root: string, manifest: Manifest, baseSha: string, headSha: string): MissionRangeOutcome {
  const prefixes = manifestMsnEnforcedPrefixes(manifest);
  const diff = lines(root, ["diff", "--name-only", "--diff-filter=ACMRT", `${baseSha}...${headSha}`]);
  const needsMission = diff.some((f) => isMsnEnforcedPath(f, prefixes));
  const changed = discoverChangedMissions(root, { baseRef: baseSha, headRef: headSha });
  if (changed.kind === "contamination") {
    return { kind: "fail", message: `mission contamination: this range carries commits from ${changed.uniqueMsns.map((m) => `[${m}]`).join(", ")}; rebase onto the integration branch` };
  }
  if (changed.kind === "purity_mismatch") {
    return { kind: "fail", message: `changed mission files do not match the range's MSN [${changed.purityMsn}]: ${changed.missions.join(", ")}` };
  }
  if (changed.missions.length > 0) return { kind: "verify", missions: changed.missions };
  if (!needsMission) return { kind: "none", message: `no changed mission files (${baseSha}...${headSha})` };
  const verdict = evaluateTrustedAutomationRange(root, manifest, baseSha, headSha);
  if (verdict.eligible) return { kind: "trusted", message: `${verdict.reason}\ntrusted automation policy satisfied — mission file not required` };
  return {
    kind: "fail",
    message: [
      "diff touches MSN-enforced paths but no mission file under .gitagent/missions/",
      `  trusted automation: ${verdict.reason}`,
      '  Fix: gantry legislate "<intent>" --msn MSN-NNNN --skill-key gantry && include mission YAML in this PR',
      "  Or: declare eligible automation in .gitagent/config.yaml trusted_automation (fail-closed by default)",
    ].join("\n"),
  };
}
