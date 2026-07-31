import { layerForFile, loadTargetArchitecture, resolveArchScanRoots, fileMatchesScanRoots } from "../arch/cage/target-architecture.js";
import { findForbiddenZoneHits } from "../legislate-forbidden-zone.js";
import { triageIntent, isTriageEscalated } from "../triage-logic.js";
import type { Manifest } from "../types.js";
import { normalizeRepoRelativePath, pathRiskTier } from "../tmvc-path.js";
import {
  compareFindingSeverity,
  stableFindingId,
  type InterrogationFinding,
  type InterrogationFindingKind,
} from "./findings.js";
import { gateRequiresInterrogation } from "./gate-integrity.js";

export interface ComputeGapsInput {
  root: string;
  manifest: Manifest;
  intent: string;
  skillKey: string;
  gateCommand: string;
  gateSuccessSubstring: string | null;
  paths: string[];
}

function makeFinding(
  kind: InterrogationFindingKind,
  subject: string,
  question: string,
  hypothesis: string,
  evidence: string,
  riskTier: string,
): InterrogationFinding {
  return {
    finding_id: stableFindingId(kind, subject),
    kind,
    subject,
    question,
    hypothesis,
    evidence,
    risk_tier: riskTier,
  };
}

function collectRiskEscalationFinding(triage: ReturnType<typeof triageIntent>): InterrogationFinding | null {
  if (!isTriageEscalated(triage)) return null;
  const subject = `triage:${triage.reason}`;
  return makeFinding(
    "risk_escalation",
    subject,
    `Triage escalated: ${triage.reason}. Which skill_key and TMVC scope authorize this work?`,
    `Planner assigns explicit skill_key and narrows TMVC in the mission after operator confirmation.`,
    triage.match_reasons.join("; ") || triage.reason,
    triage.risk_tier,
  );
}

function collectForbiddenZoneFindings(
  manifest: Manifest,
  skillKey: string,
  intent: string,
): InterrogationFinding[] {
  const hits = findForbiddenZoneHits(manifest, skillKey, intent);
  return hits.map((zone) =>
    makeFinding(
      "forbidden_zone",
      `zone:${zone}`,
      `Intent may touch forbidden zone ${zone} for skill ${skillKey}. Confirm Planner override or narrow intent.`,
      `Work stays outside ${zone} unless operator explicitly authorizes Planner override in TMVC.`,
      `forbidden_zone glob: ${zone}`,
      manifest.path_risks[zone.replace(/\*\*/g, "").replace(/\/$/, "")] ?? "Tier-3",
    ),
  );
}

function bucketPathByTier(
  tierBuckets: Map<string, string[]>,
  manifest: Manifest,
  archSpec: ReturnType<typeof loadTargetArchitecture> | null,
  scanRoots: string[],
  raw: string,
): void {
  const repoRel = normalizeRepoRelativePath(raw);
  if (!archSpec) {
    const tier = pathRiskTier(manifest, repoRel);
    const list = tierBuckets.get(tier) ?? [];
    list.push(repoRel);
    tierBuckets.set(tier, list);
    return;
  }
  if (scanRoots.length > 0 && !fileMatchesScanRoots(repoRel, scanRoots)) return;
  const layer = layerForFile(archSpec, repoRel);
  if (layer !== "other") return;
  const tier = pathRiskTier(manifest, repoRel);
  const list = tierBuckets.get(tier) ?? [];
  list.push(repoRel);
  tierBuckets.set(tier, list);
}

function collectUndefinedBoundaryFindings(
  root: string,
  manifest: Manifest,
  skillKey: string,
  paths: string[],
): InterrogationFinding[] {
  const findings: InterrogationFinding[] = [];
  const skill = manifest.skills[skillKey];
  if (skill && skill.tmvc_roots.length === 0) {
    findings.push(
      makeFinding(
        "undefined_boundary",
        "tmvc_roots:empty",
        `Skill ${skillKey} has empty tmvc_roots. What TMVC roots does this mission authorize?`,
        `Planner narrows tmvc_roots in the mission or assigns a skill with declared roots.`,
        `manifest.skills.${skillKey}.tmvc_roots is []`,
        String(skill.trust_threshold),
      ),
    );
  }

  let archSpec: ReturnType<typeof loadTargetArchitecture> | null = null;
  try {
    archSpec = loadTargetArchitecture(root);
  } catch {
    archSpec = null;
  }

  const tierBuckets = new Map<string, string[]>();
  const tmvcRoots = manifest.skills[skillKey]?.tmvc_roots ?? [];
  const scanRoots = archSpec ? resolveArchScanRoots(archSpec, tmvcRoots) : [];

  for (const raw of paths) {
    bucketPathByTier(tierBuckets, manifest, archSpec, scanRoots, raw);
  }

  if (archSpec && scanRoots.length === 0 && archSpec.layers.length === 0 && paths.length > 0) {
    const tier = "unlisted";
    tierBuckets.set(tier, paths.map((p) => normalizeRepoRelativePath(p)));
  }

  for (const [tier, tierPaths] of tierBuckets) {
    if (tierPaths.length === 0) continue;
    const sorted = [...tierPaths].sort();
    const subject = `unmapped:${tier}:${sorted.join(",")}`;
    findings.push(
      makeFinding(
        "undefined_boundary",
        subject,
        `Paths are not mapped to any TARGET_ARCHITECTURE layer (tier ${tier}). Confirm boundary for all listed paths.`,
        `Operator authorizes work within declared TMVC and documents boundary decision on the record.`,
        sorted.map((p) => `- ${p}`).join("\n"),
        tier === "unlisted" ? "Tier-2" : tier,
      ),
    );
  }

  return findings;
}

function collectMissingTestCriteriaFinding(
  manifest: Manifest,
  skillKey: string,
  gateCommand: string,
  gateSuccessSubstring: string | null,
): InterrogationFinding | null {
  if (!gateRequiresInterrogation(manifest, skillKey, gateCommand)) return null;
  const subject = `gate:${gateCommand}`;
  const substringNote =
    gateSuccessSubstring?.trim()
      ? `gate_success_substring is set but does not exempt non-allowlisted gates.`
      : `gate_success_substring is not set.`;
  return makeFinding(
    "missing_test_criteria",
    subject,
    `Gate command is not on the skill allowlist. Authorize this gate and its success criteria on the record.`,
    `Planner accepts gate_command "${gateCommand}" with documented success substring for verify.`,
    `${substringNote} gate_command: ${gateCommand}`,
    manifest.skills[skillKey]?.trust_threshold ?? "Tier-2",
  );
}

function collectAdrConflictFindings(triage: ReturnType<typeof triageIntent>): InterrogationFinding[] {
  const hints = triage.adr_hints ?? [];
  return hints.map((h) =>
    makeFinding(
      "adr_conflict",
      `adr:${h.id}`,
      `Intent may relate to ${h.id}. Accept ADR decision, reject applicability, or cite superseding rationale?`,
      `Operator explicitly accepts or rejects ADR ${h.id} before legislation proceeds.`,
      h.note,
      "Tier-3",
    ),
  );
}

export function computeGaps(input: ComputeGapsInput): InterrogationFinding[] {
  const findings: InterrogationFinding[] = [];
  const triage = triageIntent(input.root, input.intent, input.manifest);
  const risk = collectRiskEscalationFinding(triage);
  if (risk) findings.push(risk);
  findings.push(...collectForbiddenZoneFindings(input.manifest, input.skillKey, input.intent));
  findings.push(
    ...collectUndefinedBoundaryFindings(input.root, input.manifest, input.skillKey, input.paths),
  );
  const gateFinding = collectMissingTestCriteriaFinding(
    input.manifest,
    input.skillKey,
    input.gateCommand,
    input.gateSuccessSubstring,
  );
  if (gateFinding) findings.push(gateFinding);
  findings.push(...collectAdrConflictFindings(triage));

  const byId = new Map<string, InterrogationFinding>();
  for (const f of findings) {
    byId.set(f.finding_id, f);
  }
  return [...byId.values()].sort((a, b) => compareFindingSeverity(a.kind, b.kind));
}
