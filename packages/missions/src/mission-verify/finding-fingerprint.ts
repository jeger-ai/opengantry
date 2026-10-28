import crypto from "node:crypto";
import { canonicalJson } from "#core/canonical-json.js";
import type { VerifyFinding } from "./finding.js";

const DIGEST_RING_CAP = 4 as const;

function sha256Hex(payload: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

/** A finding's semantic key: its gate, file and rule, never its line, so a finding that moved still recurs. */
function semanticKey(finding: VerifyFinding): string {
  return sha256Hex({
    failed_gate: finding.failed_gate,
    offending_file: finding.offending_file,
    ...(finding.rule_id ? { rule_id: finding.rule_id } : {}),
  });
}

/** The findings digest of a failed run: the sorted, unique semantic keys of its findings. */
export function computeFindingsDigest(findings: readonly VerifyFinding[]): string {
  return sha256Hex([...new Set(findings.map(semanticKey))].sort());
}

/** The ring with `digest` as its newest entry, at most four long. */
export function appendDigestToRing(ring: readonly string[], digest: string): string[] {
  return [...ring.filter((d) => d !== digest), digest].slice(-DIGEST_RING_CAP);
}
