import type { Manifest } from "./types.js";
import type { TriageResult } from "./types.js";
import { triageIntent } from "./triage-logic.js";

export function isTriageEscalated(triage: TriageResult): boolean {
  return triage.action !== "DIRECT_EXECUTION" || triage.skill_key === "NONE";
}

export type ResolveSkillKeyResult =
  | { ok: true; skillKey: string; triage: TriageResult }
  | { ok: false; triage: TriageResult; reason: string; kind: "unknown_skill" | "escalated" };

export function resolveSkillKeyForLegislation(opts: {
  root: string;
  manifest: Manifest;
  intent: string;
  skillKey?: string;
}): ResolveSkillKeyResult {
  const explicit = opts.skillKey?.trim();
  if (explicit) {
    if (!opts.manifest.skills[explicit]) {
      return {
        ok: false,
        triage: triageIntent(opts.root, opts.intent, opts.manifest),
        reason: `unknown skill_key "${explicit}" (manifest skills: ${Object.keys(opts.manifest.skills).join(", ")})`,
        kind: "unknown_skill",
      };
    }
    const triage = triageIntent(opts.root, opts.intent, opts.manifest);
    return { ok: true, skillKey: explicit, triage };
  }

  const triage = triageIntent(opts.root, opts.intent, opts.manifest);
  if (isTriageEscalated(triage)) {
    return {
      ok: false,
      triage,
      reason: `triage escalation — ${triage.reason}. Pass --skill-key <manifest skill> after Teacher assigns scope.`,
      kind: "escalated",
    };
  }
  return { ok: true, skillKey: triage.skill_key, triage };
}
