import type { Manifest, TriageResult } from "./types.js";

function normalizeIntent(text: string): string {
  return text.toLowerCase();
}

function intentReferencesPathRisk(intentNorm: string, riskPath: string): boolean {
  const trimmed = riskPath.endsWith("/") ? riskPath.slice(0, -1) : riskPath;
  const needle = normalizeIntent(trimmed);
  return intentNorm.includes(needle) || intentNorm.includes(`${needle}/`);
}

function shouldEscalateForRisk(intent: string, manifest: Manifest): { escalate: boolean; reason: string } {
  const intentNorm = normalizeIntent(intent);
  for (const riskPath of Object.keys(manifest.path_risks)) {
    if (intentReferencesPathRisk(intentNorm, riskPath)) {
      return { escalate: true, reason: `Intent references path under path_risks: ${riskPath}` };
    }
  }
  for (const kw of manifest.risk_keywords) {
    if (intentNorm.includes(normalizeIntent(kw))) {
      return { escalate: true, reason: `Intent contains risk_keyword: ${kw}` };
    }
  }
  return { escalate: false, reason: "" };
}

function skillMentionedInIntent(intentNorm: string, skillKey: string): boolean {
  const fullKey = normalizeIntent(skillKey);
  if (intentNorm.includes(fullKey)) return true;
  const firstSegment = skillKey.split("-")[0];
  if (firstSegment && intentNorm.includes(normalizeIntent(firstSegment))) return true;
  return false;
}

function legislativeEscalation(reason: string): TriageResult {
  return {
    action: "LEGISLATIVE_ESCALATION",
    skill_key: "NONE",
    risk_tier: "Tier-3",
    tmvc_roots: [],
    forbidden_zones: [],
    reason,
  };
}

function directExecution(skillKey: string, manifest: Manifest): TriageResult {
  const skill = manifest.skills[skillKey]!;
  return {
    action: "DIRECT_EXECUTION",
    skill_key: skillKey,
    risk_tier: String(skill.trust_threshold),
    tmvc_roots: [...skill.tmvc_roots],
    forbidden_zones: [...skill.forbidden_zones],
    reason: `Single confident skill match: ${skillKey}`,
  };
}

function matchingSkillKeys(intentNorm: string, manifest: Manifest): string[] {
  const keys = Object.keys(manifest.skills);
  return keys.filter((key) => skillMentionedInIntent(intentNorm, key));
}

/**
 * Foreman-style triage (manifest-only), aligned with .gitagent/foreman/SOUL.md
 */
export function triageIntent(intent: string, manifest: Manifest): TriageResult {
  const risk = shouldEscalateForRisk(intent, manifest);
  if (risk.escalate) {
    return legislativeEscalation(risk.reason);
  }

  const intentNorm = normalizeIntent(intent);
  const matches = matchingSkillKeys(intentNorm, manifest);

  if (matches.length === 1) {
    return directExecution(matches[0]!, manifest);
  }
  if (matches.length === 0) {
    return legislativeEscalation("No confident skill_key match in intent (ambiguous or missing)");
  }
  return legislativeEscalation(`Multiple skill matches: ${matches.join(", ")} — escalate to Teacher`);
}

export function formatTriageJson(result: TriageResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatTriageHuman(result: TriageResult): string {
  const lines = [
    `Action: ${result.action}`,
    `Skill_key: ${result.skill_key}`,
    `Risk_tier: ${result.risk_tier}`,
    `tmvc_roots: ${JSON.stringify(result.tmvc_roots)}`,
    `forbidden_zones: ${JSON.stringify(result.forbidden_zones)}`,
    `Reason: ${result.reason}`,
  ];
  return lines.join("\n");
}
