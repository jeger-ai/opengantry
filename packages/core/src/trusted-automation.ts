/**
 * Trusted automation (ADR-0052 step 5b, ported from scripts/lib/trusted-automation.mjs): a commit or PR range that
 * touches MSN-enforced paths may pass without a mission when a `.gitagent/config.yaml` `trusted_automation` rule covers
 * the actor, the paths, the net line count and the structural kind of the change. Pure: the loader supplies git facts.
 */
import { judgePath, pathLaw, tightenPathLaw, type PathLaw } from "./path-law.js";
import { normalizeRepoRelativePath } from "./posix-path.js";

export type StructuralChangeKind = "workflow_version_pin" | "bounded_content" | "dependency_update";

/** For `dependency_update` the cap counts manifest lines only: lockfiles are generated (ADR-0057). */
export const STRUCTURAL_KIND_HARD_MAX_NET_LOC: Readonly<Record<StructuralChangeKind, number>> = {
  workflow_version_pin: 5,
  bounded_content: 100,
  dependency_update: 200,
};

/** Where a `dependency_update` lockfile entry may resolve unless the rule lists `allowed_registries`. */
export const DEFAULT_DEPENDENCY_REGISTRIES: readonly string[] = ["https://registry.npmjs.org/"];

export interface TrustedAutomationRule {
  id: string;
  allowedActors: string[];
  allowedPaths: string[];
  structuralKind: StructuralChangeKind;
  maxNetLoc: number;
  /** `dependency_update` only: URL prefixes a changed lockfile entry may resolve to. */
  allowedRegistries: string[];
}

/** Paths that always need an `[MSN]` subject, in addition to every skill's `tmvc_roots`. */
const FIXED_MSN_ENFORCED_PREFIXES = [".gitagent/", "EXECUTOR_LOG.md", ".githooks/", ".github/workflows/gxt-validate.yml"] as const;

function fail(message: string): never {
  throw new Error(`trusted_automation: ${message}`);
}

function isStructuralKind(value: unknown): value is StructuralChangeKind {
  return typeof value === "string" && Object.hasOwn(STRUCTURAL_KIND_HARD_MAX_NET_LOC, value);
}

/** Parse and validate the `trusted_automation` block of `.gitagent/config.yaml` (already parsed). */
export function parseTrustedAutomationRules(config: unknown): TrustedAutomationRule[] {
  const block = (config as { trusted_automation?: unknown } | null)?.trusted_automation as { rules?: unknown } | undefined;
  if (!block || !Array.isArray(block.rules) || block.rules.length === 0) return [];
  return block.rules.map((raw: unknown, i: number) => {
    if (!raw || typeof raw !== "object") fail(`rules[${String(i)}] must be an object`);
    const rule = raw as Record<string, unknown>;
    const id = typeof rule.id === "string" ? rule.id.trim() : "";
    if (!id) fail(`rules[${String(i)}] missing id`);
    const actors = rule.allowed_actors;
    if (!Array.isArray(actors) || actors.length === 0) fail(`rule ${id} requires non-empty allowed_actors`);
    const paths = rule.allowed_paths;
    if (!Array.isArray(paths) || paths.length === 0) fail(`rule ${id} requires non-empty allowed_paths`);
    const kinds = rule.allowed_structural_changes;
    if (!Array.isArray(kinds) || kinds.length === 0) fail(`rule ${id} requires allowed_structural_changes`);
    for (const k of kinds) if (!isStructuralKind(k)) fail(`rule ${id} has unsupported structural change: ${String(k)}`);
    if (kinds.length !== 1) fail(`rule ${id} must declare exactly one allowed_structural_changes kind`);
    const structuralKind = kinds[0] as StructuralChangeKind;
    const maxNetLoc = rule.max_net_loc;
    if (typeof maxNetLoc !== "number" || !Number.isInteger(maxNetLoc) || maxNetLoc < 1) fail(`rule ${id} max_net_loc must be a positive integer`);
    const cap = STRUCTURAL_KIND_HARD_MAX_NET_LOC[structuralKind];
    if (maxNetLoc > cap) fail(`rule ${id} max_net_loc exceeds hard cap ${String(cap)} for ${structuralKind}`);
    return {
      id,
      allowedActors: actors.map((a) => String(a).trim().toLowerCase()),
      allowedPaths: paths.map((p) => normalizeRepoRelativePath(String(p))),
      structuralKind,
      maxNetLoc,
      allowedRegistries: parseRegistries(id, structuralKind, rule.allowed_registries),
    };
  });
}

function parseRegistries(id: string, kind: StructuralChangeKind, raw: unknown): string[] {
  if (raw === undefined) return kind === "dependency_update" ? [...DEFAULT_DEPENDENCY_REGISTRIES] : [];
  if (kind !== "dependency_update") fail(`rule ${id}: allowed_registries is for dependency_update`);
  if (!Array.isArray(raw) || raw.length === 0) fail(`rule ${id}: allowed_registries must be a non-empty list`);
  return raw.map((r) => {
    const url = String(r).trim();
    if (!url.startsWith("https://") || !url.endsWith("/")) fail(`rule ${id}: registry ${url} must be an https:// URL ending in /`);
    return url;
  });
}

/** MSN-enforced prefixes: the fixed set plus every skill's tmvc_roots, de-duplicated and in input order. */
export function msnEnforcedPrefixes(skillRoots: readonly (readonly string[])[]): string[] {
  const out = new Set<string>();
  for (const p of [...FIXED_MSN_ENFORCED_PREFIXES, ...skillRoots.flat()]) {
    const norm = normalizeRepoRelativePath(String(p));
    if (norm) out.add(norm);
  }
  return [...out];
}

/** The MSN-enforced paths as a law: a hit means the commit needs an `[MSN]` subject. */
export function msnEnforcedLaw(prefixes: readonly string[]): PathLaw {
  return pathLaw({ rules: [{ id: "msn_enforced", source: "substrate", patterns: [...prefixes], effect: "report", overridable: false }] });
}

export function isMsnEnforcedPath(filePath: string, enforced: PathLaw): boolean {
  return judgePath(enforced, normalizeRepoRelativePath(filePath)) !== null;
}

/** Total of added and deleted lines in `git ... --numstat` output; binary rows (`-`) are skipped. */
export function parseNumstatTotal(output: string): number {
  let total = 0;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [adds, dels] = line.split("\t");
    if (adds === "-" || dels === "-" || adds === undefined || dels === undefined) continue;
    total += Number(adds) + Number(dels);
  }
  return total;
}

/** A gxt-bypass git note body: JSON `{ v: 1, reason }` with a reason of at least ten characters. */
export function isValidBypassNote(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; reason?: unknown } | null;
    return parsed?.v === 1 && typeof parsed.reason === "string" && parsed.reason.length >= 10;
  } catch {
    return false;
  }
}

type Json = unknown;

function isObject(v: Json): v is Record<string, Json> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function structuresMatch(before: Json, after: Json): boolean {
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length && before.every((item, i) => structuresMatch(item, after[i]));
  }
  if (isObject(before) && isObject(after)) {
    const ka = Object.keys(before).sort();
    const kb = Object.keys(after).sort();
    if (ka.length !== kb.length || !ka.every((k, i) => k === kb[i])) return false;
    return ka.every((k) => structuresMatch(before[k], after[k]));
  }
  return !(Array.isArray(before) || Array.isArray(after) || isObject(before) || isObject(after)) || typeof before === typeof after;
}

interface LeafDiff {
  path: string[];
  before: Json;
  after: Json;
}

function leafDiffs(before: Json, after: Json, keyPath: string[] = []): LeafDiff[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.flatMap((item, i) => leafDiffs(item, after[i], [...keyPath, String(i)]));
  }
  if (isObject(before) && isObject(after)) {
    return Object.keys(before).flatMap((key) => {
      const bv = before[key];
      const av = after[key];
      const child = [...keyPath, key];
      if ((isObject(bv) || Array.isArray(bv)) && (isObject(av) || Array.isArray(av))) return leafDiffs(bv, av, child);
      return bv !== av ? [{ path: child, before: bv, after: av }] : [];
    });
  }
  return before !== after ? [{ path: keyPath, before, after }] : [];
}

function isWorkflowVersionPinChange(before: Json, after: Json): boolean {
  if (typeof before !== "string" || typeof after !== "string") return false;
  const at = (s: string): number => s.indexOf("@");
  const bi = at(before);
  const ai = at(after);
  if (bi <= 0 || ai <= 0) return false;
  return before.slice(0, bi) === after.slice(0, ai) && before.slice(bi + 1) !== after.slice(ai + 1) && after.length > ai + 1;
}

/** True when two parsed workflow documents differ only in the version part of `uses:` values. */
export function workflowVersionPinOnly(beforeDoc: Json, afterDoc: Json): boolean {
  if (!structuresMatch(beforeDoc, afterDoc)) return false;
  const diffs = leafDiffs(beforeDoc, afterDoc);
  return diffs.every((d) => d.path[d.path.length - 1] === "uses" && isWorkflowVersionPinChange(d.before, d.after));
}

/** What the substrate never delegates to automation: `.gitagent/` and the perimeter (the perimeter law tightened). */
export function substrateHardDenyLaw(perimeter: PathLaw): PathLaw {
  return tightenPathLaw(perimeter, { rules: [{ id: "substrate", source: "substrate", patterns: [".gitagent/"], effect: "deny", overridable: false }] });
}

export function isSubstrateHardDeniedPath(filePath: string, hardDeny: PathLaw): boolean {
  return judgePath(hardDeny, normalizeRepoRelativePath(filePath)) !== null;
}

/** A rule's `allowed_paths` as an area: a path outside it is not the rule's to allow. Patterns cover (ADR-0053). */
function allowedPathsLaw(rule: TrustedAutomationRule): PathLaw {
  return pathLaw({ areas: [{ id: "outside_allowed_paths", source: "trusted_automation", patterns: rule.allowedPaths, overridable: false }] });
}

export interface TrustedAutomationChange {
  /** MSN-enforced files of the change. */
  files: readonly string[];
  actorEmail: string;
  netLoc: number;
  /** Lines of `netLoc` in npm lockfiles; a `dependency_update` rule does not count them (ADR-0057). */
  lockfileLoc?: number;
  /** Structural judgement the loader computes for the rule's kind (reads blobs, knows the perimeter). */
  structural: (rule: TrustedAutomationRule) => { ok: boolean; reason: string };
}

export interface TrustedAutomationVerdict {
  eligible: boolean;
  reason: string;
}

export function rulesForActor(rules: readonly TrustedAutomationRule[], actorEmail: string): TrustedAutomationRule[] {
  const actor = actorEmail.toLowerCase();
  return rules.filter((rule) => rule.allowedActors.includes(actor));
}

export function evaluateAgainstRule(rule: TrustedAutomationRule, change: TrustedAutomationChange): TrustedAutomationVerdict {
  const actor = change.actorEmail.toLowerCase();
  if (!rule.allowedActors.includes(actor)) return { eligible: false, reason: `actor ${change.actorEmail} not in rule ${rule.id} allowed_actors` };
  if (change.files.length === 0) return { eligible: false, reason: "no changed files" };
  const allowed = allowedPathsLaw(rule);
  for (const file of change.files) {
    if (judgePath(allowed, normalizeRepoRelativePath(file)) !== null) return { eligible: false, reason: `path ${file} outside rule ${rule.id} allowed_paths` };
  }
  const counted = rule.structuralKind === "dependency_update" ? change.netLoc - (change.lockfileLoc ?? 0) : change.netLoc;
  if (counted > rule.maxNetLoc) {
    return { eligible: false, reason: `net_loc ${String(counted)} exceeds rule ${rule.id} max_net_loc ${String(rule.maxNetLoc)}` };
  }
  const structural = change.structural(rule);
  if (!structural.ok) return { eligible: false, reason: structural.reason };
  return { eligible: true, reason: `TRUSTED-AUTOMATION-OK: rule=${rule.id} actor=${change.actorEmail} paths=${change.files.join(",")} net_loc=${String(counted)}` };
}

/** First eligible rule wins; otherwise every rule's denial reason (or the fallback) is reported. */
export function evaluateTrustedAutomation(rules: readonly TrustedAutomationRule[], change: TrustedAutomationChange, fallbackReason: string): TrustedAutomationVerdict {
  const reasons: string[] = [];
  for (const rule of rulesForActor(rules, change.actorEmail)) {
    const verdict = evaluateAgainstRule(rule, change);
    if (verdict.eligible) return verdict;
    reasons.push(verdict.reason);
  }
  // Every rule's reason: the one that came closest is often not the last one tried.
  return { eligible: false, reason: reasons.length > 0 ? reasons.join("; ") : fallbackReason };
}
