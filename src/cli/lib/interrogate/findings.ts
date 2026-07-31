import crypto from "node:crypto";
import { canonicalJson } from "../canonical-json.js";

export const INTERROGATION_FINDING_KINDS = [
  "risk_escalation",
  "forbidden_zone",
  "undefined_boundary",
  "missing_test_criteria",
  "adr_conflict",
] as const;

export type InterrogationFindingKind = (typeof INTERROGATION_FINDING_KINDS)[number];

/** Severity order: lower index = higher priority for single-question halt. */
export const FINDING_KIND_SEVERITY: readonly InterrogationFindingKind[] = [
  "risk_escalation",
  "forbidden_zone",
  "undefined_boundary",
  "adr_conflict",
  "missing_test_criteria",
];

export interface InterrogationFinding {
  finding_id: string;
  kind: InterrogationFindingKind;
  subject: string;
  question: string;
  hypothesis: string;
  evidence: string;
  risk_tier: string;
}

export interface InterrogationRow {
  finding_id: string;
  kind: InterrogationFindingKind;
  question: string;
  hypothesis: string;
  operator_answer: string;
  adr_refs?: string[];
}

export function stableFindingId(kind: string, subject: string): string {
  return crypto.createHash("sha256").update(`${kind}\0${subject}`, "utf8").digest("hex").slice(0, 12);
}

export function compareFindingSeverity(a: InterrogationFindingKind, b: InterrogationFindingKind): number {
  return FINDING_KIND_SEVERITY.indexOf(a) - FINDING_KIND_SEVERITY.indexOf(b);
}

/** Canonical SHA-256 over sorted interrogation rows (wire shape). */
export function interrogationSha256(rows: InterrogationRow[]): string {
  const canonical = rows.map((r) => ({
    finding_id: r.finding_id,
    kind: r.kind,
    question: r.question,
    hypothesis: r.hypothesis,
    operator_answer: r.operator_answer,
    ...(r.adr_refs && r.adr_refs.length > 0 ? { adr_refs: [...r.adr_refs].sort() } : {}),
  }));
  return crypto.createHash("sha256").update(canonicalJson(canonical), "utf8").digest("hex");
}

export type PresentedQuestion = Omit<InterrogationFinding, "subject">;
