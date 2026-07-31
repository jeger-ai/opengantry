import type { Manifest } from "../types.js";
import { mergeInterrogationAnswers } from "./answers.js";
import { computeGaps, type ComputeGapsInput } from "./gaps.js";
import {
  compareFindingSeverity,
  interrogationSha256,
  stableFindingId,
  type InterrogationFinding,
  type InterrogationFindingKind,
  type InterrogationRow,
  type PresentedQuestion,
} from "./findings.js";

export interface RunInterrogateInput {
  root: string;
  manifest: Manifest;
  intent: string;
  skillKey: string;
  gateCommand: string;
  gateSuccessSubstring: string | null;
  paths: string[];
  interrogation?: InterrogationRow[];
}

export type InterrogateResult =
  | {
      status: "halt";
      next_question: PresentedQuestion;
      remaining_count: number;
    }
  | {
      status: "clear";
      interrogation: InterrogationRow[];
      interrogation_sha256: string;
      declared_paths: string[];
    };

function presentFinding(finding: InterrogationFinding): PresentedQuestion {
  return {
    finding_id: finding.finding_id,
    kind: finding.kind,
    question: finding.question,
    hypothesis: finding.hypothesis,
    evidence: finding.evidence,
    risk_tier: finding.risk_tier,
  };
}

export function runInterrogate(input: RunInterrogateInput): InterrogateResult {
  const gapsInput: ComputeGapsInput = {
    root: input.root,
    manifest: input.manifest,
    intent: input.intent,
    skillKey: input.skillKey,
    gateCommand: input.gateCommand,
    gateSuccessSubstring: input.gateSuccessSubstring,
    paths: input.paths,
  };
  const findings = computeGaps(gapsInput);
  const { complete, unanswered } = mergeInterrogationAnswers(
    findings,
    input.interrogation ?? [],
  );
  const next = unanswered[0] ?? null;
  if (next) {
    return {
      status: "halt",
      next_question: presentFinding(next),
      remaining_count: unanswered.length,
    };
  }
  const rows = complete.sort((a, b) => a.finding_id.localeCompare(b.finding_id));
  return {
    status: "clear",
    interrogation: rows,
    interrogation_sha256: interrogationSha256(rows),
    declared_paths: [...input.paths].map((p) => p.replace(/\\/g, "/")).sort(),
  };
}

export { stableFindingId, compareFindingSeverity };
export type { InterrogationFindingKind };
