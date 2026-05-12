import type { Manifest, TriageResult } from "./types.js";

function norm(s: string): string {
  return s.toLowerCase();
}

/** Normalize path prefix for risk check: ensure trailing slash for directory-style keys */
function pathUnderRisk(intentNorm: string, riskPath: string): boolean {
  const p = riskPath.endsWith("/") ? riskPath.slice(0, -1) : riskPath;
  const needle = norm(p);
  if (intentNorm.includes(needle)) return true;
  if (intentNorm.includes(needle + "/")) return true;
  return false;
}

function hardGateEscalation(intent: string, manifest: Manifest): { escalate: boolean; reason: string } {
  const i = norm(intent);
  for (const [rp] of Object.entries(manifest.path_risks)) {
    if (pathUnderRisk(i, rp)) {
      return { escalate: true, reason: `Intent references path under path_risks: ${rp}` };
    }
  }
  for (const kw of manifest.risk_keywords) {
    if (i.includes(norm(kw))) {
      return { escalate: true, reason: `Intent contains risk_keyword: ${kw}` };
    }
  }
  return { escalate: false, reason: "" };
}

function skillMentioned(intentNorm: string, skillKey: string): boolean {
  const k = norm(skillKey);
  if (intentNorm.includes(k)) return true;
  const parts = skillKey.split("-");
  if (parts.length >= 2 && intentNorm.includes(norm(parts[0]!))) return true;
  return false;
}

/**
 * Foreman-style triage (manifest-only), aligned with .gitagent/foreman/SOUL.md
 */
export function triageIntent(intent: string, manifest: Manifest): TriageResult {
  const hg = hardGateEscalation(intent, manifest);
  if (hg.escalate) {
    return {
      action: "LEGISLATIVE_ESCALATION",
      skill_key: "NONE",
      risk_tier: "Tier-3",
      tmvc_roots: [],
      forbidden_zones: [],
      reason: hg.reason,
    };
  }

  const i = norm(intent);
  const matches: string[] = [];
  for (const key of Object.keys(manifest.skills)) {
    if (skillMentioned(i, key)) matches.push(key);
  }

  if (matches.length === 1) {
    const skill_key = matches[0]!;
    const sk = manifest.skills[skill_key]!;
    return {
      action: "DIRECT_EXECUTION",
      skill_key,
      risk_tier: String(sk.trust_threshold),
      tmvc_roots: [...sk.tmvc_roots],
      forbidden_zones: [...sk.forbidden_zones],
      reason: `Single confident skill match: ${skill_key}`,
    };
  }

  if (matches.length === 0) {
    return {
      action: "LEGISLATIVE_ESCALATION",
      skill_key: "NONE",
      risk_tier: "Tier-3",
      tmvc_roots: [],
      forbidden_zones: [],
      reason: "No confident skill_key match in intent (ambiguous or missing)",
    };
  }

  return {
    action: "LEGISLATIVE_ESCALATION",
    skill_key: "NONE",
    risk_tier: "Tier-3",
    tmvc_roots: [],
    forbidden_zones: [],
    reason: `Multiple skill matches: ${matches.join(", ")} — escalate to Teacher`,
  };
}

export function formatTriageJson(r: TriageResult): string {
  return JSON.stringify(r, null, 2);
}
