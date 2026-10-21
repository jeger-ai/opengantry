/**
 * Trusted automation loader (ADR-0052 step 5b): reads `.gitagent/config.yaml` (or the 3.x config.json), the manifest and git, and asks the core
 * evaluator whether a commit or a PR range may pass without a mission.
 */
import YAML from "yaml";
import {
  evaluateTrustedAutomation,
  isMsnEnforcedPath,
  isSubstrateHardDeniedPath,
  msnEnforcedLaw,
  msnEnforcedPrefixes,
  substrateHardDenyLaw,
  parseNumstatTotal,
  parseTrustedAutomationRules,
  rulesForActor,
  workflowVersionPinOnly,
  type TrustedAutomationRule,
  type TrustedAutomationVerdict,
} from "#core/trusted-automation.js";
import { dependencyFileKind, lockfileUpdateProblem, manifestUpdateProblem } from "#core/dependency-update.js";
import type { Manifest } from "#core/manifest.js";
import { gitRunOk } from "#git/git.js";
import { perimeterLawFor } from "./perimeter.js";
import { parseLawFileDocument } from "#core/law-file.js";
import { readLawFileAt } from "#git/repo-text.js";

export function loadTrustedAutomationRules(root: string): TrustedAutomationRule[] {
  const source = readLawFileAt(root, "config");
  if (!source) return [];
  let parsed: unknown;
  try {
    parsed = parseLawFileDocument(source);
  } catch (e) {
    throw new Error(`trusted_automation: invalid ${source.kind.toUpperCase()} in ${source.rel}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  return parseTrustedAutomationRules(parsed);
}

/** Every skill's tmvc_roots plus the fixed substrate prefixes. */
export function manifestMsnEnforcedPrefixes(manifest: Manifest): string[] {
  return msnEnforcedPrefixes(Object.values(manifest.skills).map((s) => s.tmvc_roots));
}

function lines(root: string, args: string[]): string[] {
  const r = gitRunOk(root, args);
  return r.ok ? r.stdout.split("\n").map((l) => l.trim().replace(/\\/g, "/")).filter(Boolean) : [];
}

function commitChangedFiles(root: string, sha: string): string[] {
  return lines(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha]);
}

function commitAuthorEmail(root: string, sha: string): string {
  const r = gitRunOk(root, ["log", "-1", "--format=%ae", sha]);
  return r.ok ? r.stdout.trim().toLowerCase() : "";
}

function numstat(root: string, args: string[]): number {
  const r = gitRunOk(root, args);
  return r.ok ? parseNumstatTotal(r.stdout) : 0;
}

function blobAt(root: string, commit: string, file: string): string | null {
  const r = gitRunOk(root, ["show", `${commit}:${file}`]);
  return r.ok ? r.stdout : null;
}

function parseYamlOrNull(text: string): unknown {
  try {
    return YAML.parse(text) as unknown;
  } catch {
    return null;
  }
}

interface StructuralContext {
  mode: "commit" | "range";
  baseSha: string | null;
  headSha: string;
}

/** The npm lockfiles git sees changed, and their added plus deleted lines, for a commit or a range. */
const LOCKFILE_PATHSPEC = [":(glob)**/package-lock.json", ":(glob)**/npm-shrinkwrap.json"];

function changeArgs(ctx: StructuralContext, what: "--name-only" | "--numstat"): string[] {
  return ctx.mode === "commit"
    ? ["show", what, "--format=", ctx.headSha, "--", ...LOCKFILE_PATHSPEC]
    : ["diff", what, `${ctx.baseSha ?? ""}...${ctx.headSha}`, "--", ...LOCKFILE_PATHSPEC];
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * `dependency_update` (ADR-0057): every enforced file and every npm lockfile the change touches is a dependency file,
 * existed before and after, and changed only as a bump (manifest) or a registry update (lockfile).
 */
function dependencyUpdateProblem(root: string, rule: TrustedAutomationRule, files: readonly string[], ctx: StructuralContext): string | null {
  const before = ctx.mode === "commit" ? `${ctx.headSha}^` : (ctx.baseSha ?? "");
  for (const file of new Set([...files, ...lines(root, changeArgs(ctx, "--name-only"))])) {
    const kind = dependencyFileKind(file);
    if (!kind) return `${file} is not a package.json or an npm lockfile`;
    const b = blobAt(root, before, file);
    const a = blobAt(root, ctx.headSha, file);
    if (b === null || a === null) return `${file} was ${b === null ? "added" : "deleted"}`;
    const bd = parseJsonOrNull(b);
    const ad = parseJsonOrNull(a);
    if (bd === null || ad === null) return `${file} is not valid JSON`;
    const problem = kind === "manifest" ? manifestUpdateProblem(bd, ad) : lockfileUpdateProblem(bd, ad, rule.allowedRegistries);
    if (problem) return `${file}: ${problem}`;
  }
  return null;
}

function structuralJudge(root: string, manifest: Manifest, files: readonly string[], ctx: StructuralContext) {
  return (rule: TrustedAutomationRule): { ok: boolean; reason: string } => {
    if (rule.structuralKind === "dependency_update") {
      const problem = dependencyUpdateProblem(root, rule, files, ctx);
      return problem ? { ok: false, reason: `rule ${rule.id}: not a dependency update (${problem})` } : { ok: true, reason: "" };
    }
    if (rule.structuralKind === "bounded_content") {
      const perimeter = perimeterLawFor(root, manifest);
      if (perimeter.error !== null) return { ok: false, reason: `rule ${rule.id}: ${perimeter.error}` };
      const hardDeny = substrateHardDenyLaw(perimeter.law);
      const denied = files.find((f) => isSubstrateHardDeniedPath(f, hardDeny));
      return denied ? { ok: false, reason: `rule ${rule.id}: substrate hard-deny path not allowed (${denied})` } : { ok: true, reason: "" };
    }
    for (const file of files.filter((f) => /\.ya?ml$/i.test(f))) {
      const before = ctx.mode === "commit" ? blobAt(root, `${ctx.headSha}^`, file) : blobAt(root, ctx.baseSha ?? "", file);
      const after = blobAt(root, ctx.headSha, file);
      if (after === null) continue;
      if (before === null) return { ok: false, reason: `rule ${rule.id}: new file not allowed (${file})` };
      const beforeDoc = parseYamlOrNull(before);
      const afterDoc = parseYamlOrNull(after);
      if (beforeDoc === null || afterDoc === null || !workflowVersionPinOnly(beforeDoc, afterDoc)) {
        return { ok: false, reason: `rule ${rule.id}: structural change outside workflow_version_pin (${file})` };
      }
    }
    return { ok: true, reason: "" };
  };
}

/** Is this one commit eligible to pass the MSN subject check without a mission? */
export function evaluateTrustedAutomationCommit(root: string, manifest: Manifest, sha: string): TrustedAutomationVerdict {
  const rules = loadTrustedAutomationRules(root);
  if (rules.length === 0) return { eligible: false, reason: "no trusted_automation policy configured" };
  const enforced = msnEnforcedLaw(manifestMsnEnforcedPrefixes(manifest));
  const files = commitChangedFiles(root, sha).filter((f) => isMsnEnforcedPath(f, enforced));
  if (files.length === 0) return { eligible: false, reason: "commit does not touch MSN-enforced paths" };
  const actorEmail = commitAuthorEmail(root, sha);
  if (rulesForActor(rules, actorEmail).length === 0) return { eligible: false, reason: `actor ${actorEmail} not covered by trusted_automation policy` };
  const netLoc = numstat(root, ["show", "--numstat", "--format=", sha]);
  const ctx: StructuralContext = { mode: "commit", baseSha: null, headSha: sha };
  return evaluateTrustedAutomation(
    rules,
    { files, actorEmail, netLoc, lockfileLoc: numstat(root, changeArgs(ctx, "--numstat")), structural: structuralJudge(root, manifest, files, ctx) },
    `commit ${sha} failed trusted_automation policy checks`,
  );
}

/** Is this PR range eligible to pass without a mission file? */
export function evaluateTrustedAutomationRange(root: string, manifest: Manifest, baseSha: string, headSha: string): TrustedAutomationVerdict {
  const rules = loadTrustedAutomationRules(root);
  if (rules.length === 0) return { eligible: false, reason: "no trusted_automation policy configured" };
  const enforcedLaw = msnEnforcedLaw(manifestMsnEnforcedPrefixes(manifest));
  const enforced = lines(root, ["diff", "--name-only", "--diff-filter=ACMRT", `${baseSha}...${headSha}`]).filter((f) => isMsnEnforcedPath(f, enforcedLaw));
  if (enforced.length === 0) return { eligible: false, reason: "range does not touch MSN-enforced paths" };
  const commits = lines(root, ["rev-list", "--no-merges", `${baseSha}..${headSha}`]);
  for (const commit of commits) {
    if (!commitChangedFiles(root, commit).some((f) => isMsnEnforcedPath(f, enforcedLaw))) continue;
    const actor = commitAuthorEmail(root, commit);
    if (rulesForActor(rules, actor).length === 0) {
      return { eligible: false, reason: `commit ${commit.slice(0, 7)}: actor ${actor} not covered by trusted_automation policy` };
    }
  }
  const netLoc = numstat(root, ["diff", "--numstat", `${baseSha}...${headSha}`]);
  const actorEmail = commits.length > 0 ? commitAuthorEmail(root, commits[commits.length - 1]!) : "";
  const ctx: StructuralContext = { mode: "range", baseSha, headSha };
  return evaluateTrustedAutomation(
    rules,
    { files: enforced, actorEmail, netLoc, lockfileLoc: numstat(root, changeArgs(ctx, "--numstat")), structural: structuralJudge(root, manifest, enforced, ctx) },
    "PR diff failed trusted_automation policy checks",
  );
}
