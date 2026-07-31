import { LEGISLATE_TRACE_PLACEHOLDER } from "../constants.js";
import { GantryUserError } from "../errors.js";
import type { InterrogationFinding, InterrogationRow } from "./findings.js";

export const INTERROGATION_STUB_ANSWERS = [
  LEGISLATE_TRACE_PLACEHOLDER,
  "PENDING_OPERATOR_RESPONSE",
  "REPLACE_WITH_OPERATOR_ANSWER",
] as const;

export function isStubOperatorAnswer(answer: string): boolean {
  const trimmed = answer.trim();
  if (trimmed.length === 0) return true;
  const upper = trimmed.toUpperCase();
  return INTERROGATION_STUB_ANSWERS.some((s) => upper === s.toUpperCase());
}

export function mergeInterrogationAnswers(
  findings: InterrogationFinding[],
  rows: InterrogationRow[],
): { complete: InterrogationRow[]; unanswered: InterrogationFinding[] } {
  const findingMap = new Map(findings.map((f) => [f.finding_id, f]));
  const answerMap = new Map(rows.map((r) => [r.finding_id, r]));

  const complete: InterrogationRow[] = [];
  const unanswered: InterrogationFinding[] = [];

  for (const finding of findings) {
    const row = answerMap.get(finding.finding_id);
    if (!row || isStubOperatorAnswer(row.operator_answer)) {
      unanswered.push(finding);
      continue;
    }
    if (row.kind !== finding.kind) {
      unanswered.push(finding);
      continue;
    }
    if (finding.risk_tier === "Tier-3" && (!row.adr_refs || row.adr_refs.length === 0)) {
      unanswered.push(finding);
      continue;
    }
    complete.push({
      finding_id: finding.finding_id,
      kind: finding.kind,
      question: finding.question,
      hypothesis: finding.hypothesis,
      operator_answer: row.operator_answer.trim(),
      ...(row.adr_refs && row.adr_refs.length > 0 ? { adr_refs: [...row.adr_refs] } : {}),
    });
  }

  for (const row of rows) {
    if (!findingMap.has(row.finding_id)) {
      throw new GantryUserError(
        "INVALID_ARGUMENT",
        `interrogation: unknown finding_id ${row.finding_id}`,
        undefined,
        2,
      );
    }
  }

  return { complete, unanswered };
}
