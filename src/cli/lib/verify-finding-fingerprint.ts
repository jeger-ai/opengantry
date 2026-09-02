import crypto from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import type { VerifyFailedGate, VerifyFinding } from "./verify-finding.js";

export const EVIDENCE_BYTE_LIMIT = 2048 as const;
export const EVIDENCE_TRUNCATION_SENTINEL = "\n[...truncated]" as const;
export const DIGEST_RING_CAP = 4 as const;

/** Byte-safe UTF-8 truncation at newline or code-point boundary, then sentinel. */
export function truncateEvidenceBytes(text: string): string {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= EVIDENCE_BYTE_LIMIT) return text;

  let end = EVIDENCE_BYTE_LIMIT;
  let slice = encoded.subarray(0, end);
  let decoded = slice.toString("utf8");

  const lastNewline = decoded.lastIndexOf("\n");
  if (lastNewline > 0) {
    decoded = decoded.slice(0, lastNewline);
  } else {
    while (decoded.length > 0 && decoded.endsWith("\uFFFD")) {
      end -= 1;
      slice = encoded.subarray(0, end);
      decoded = slice.toString("utf8");
    }
  }

  return `${decoded}${EVIDENCE_TRUNCATION_SENTINEL}`;
}

/** Normalize evidence for semantic fingerprint (NFC, whitespace, strip diff hunk headers). */
export function normalizeEvidenceForSemantic(text: string): string {
  const nfc = text.normalize("NFC");
  const withoutHunks = nfc.replace(/^@@.*@@\s*$/gm, "");
  return withoutHunks.replace(/\s+/g, " ").trim();
}

export interface FingerprintInput {
  failed_gate: VerifyFailedGate;
  offending_file: string;
  line: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  rule_id?: string;
  evidence?: string;
}

function sha256Hex(payload: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

export function computeExactFingerprint(input: FingerprintInput): string {
  const evidence =
    input.evidence !== undefined ? truncateEvidenceBytes(input.evidence) : undefined;
  return sha256Hex({
    failed_gate: input.failed_gate,
    offending_file: input.offending_file,
    line: input.line,
    ...(input.end_line !== undefined ? { end_line: input.end_line } : {}),
    ...(input.start_column !== undefined ? { start_column: input.start_column } : {}),
    ...(input.end_column !== undefined ? { end_column: input.end_column } : {}),
    ...(input.rule_id !== undefined && input.rule_id !== "" ? { rule_id: input.rule_id } : {}),
    ...(evidence !== undefined && evidence !== "" ? { evidence } : {}),
  });
}

export function computeSemanticFingerprint(input: FingerprintInput): string {
  const evidence =
    input.evidence !== undefined && input.evidence !== ""
      ? normalizeEvidenceForSemantic(input.evidence)
      : undefined;
  const base: Record<string, string> = {
    failed_gate: input.failed_gate,
    offending_file: input.offending_file,
  };
  if (input.rule_id !== undefined && input.rule_id !== "") {
    base.rule_id = input.rule_id;
  }
  if (evidence !== undefined && evidence !== "") {
    base.evidence_normalized = evidence;
  }
  return sha256Hex(base);
}

export function finalizeVerifyFinding(
  finding: Omit<VerifyFinding, "fingerprint" | "semantic_fingerprint">,
): VerifyFinding {
  const evidence =
    finding.evidence !== undefined ? truncateEvidenceBytes(finding.evidence) : undefined;
  const withEvidence =
    evidence !== undefined && evidence !== finding.evidence
      ? { ...finding, evidence }
      : finding;
  const fpInput: FingerprintInput = {
    failed_gate: withEvidence.failed_gate,
    offending_file: withEvidence.offending_file,
    line: withEvidence.line,
    ...(withEvidence.end_line !== undefined ? { end_line: withEvidence.end_line } : {}),
    ...(withEvidence.start_column !== undefined ? { start_column: withEvidence.start_column } : {}),
    ...(withEvidence.end_column !== undefined ? { end_column: withEvidence.end_column } : {}),
    ...(withEvidence.rule_id !== undefined ? { rule_id: withEvidence.rule_id } : {}),
    ...(withEvidence.evidence !== undefined ? { evidence: withEvidence.evidence } : {}),
  };
  return {
    ...withEvidence,
    fingerprint: computeExactFingerprint(fpInput),
    semantic_fingerprint: computeSemanticFingerprint(fpInput),
  };
}

export function finalizeVerifyFindings(findings: VerifyFinding[]): VerifyFinding[] {
  return findings.map((f) =>
    finalizeVerifyFinding({
      failed_gate: f.failed_gate,
      offending_file: f.offending_file,
      line: f.line,
      severity: f.severity,
      resolution_hint: f.resolution_hint,
      ...(f.end_line !== undefined ? { end_line: f.end_line } : {}),
      ...(f.start_column !== undefined ? { start_column: f.start_column } : {}),
      ...(f.end_column !== undefined ? { end_column: f.end_column } : {}),
      ...(f.rule_id !== undefined ? { rule_id: f.rule_id } : {}),
      ...(f.evidence !== undefined ? { evidence: f.evidence } : {}),
    }),
  );
}

export function computeFindingsDigest(findings: readonly VerifyFinding[]): string {
  const semantic = [
    ...new Set(findings.map((f) => f.semantic_fingerprint).filter((s) => s.length > 0)),
  ].sort();
  return sha256Hex(semantic);
}

export function appendDigestToRing(ring: readonly string[], digest: string): string[] {
  const next = ring.filter((d) => d !== digest);
  next.push(digest);
  while (next.length > DIGEST_RING_CAP) {
    next.shift();
  }
  return next;
}

export function digestRecurredInRing(ring: readonly string[], digest: string): boolean {
  return ring.includes(digest);
}
