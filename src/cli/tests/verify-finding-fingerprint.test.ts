import {
  truncateEvidenceBytes,
  normalizeEvidenceForSemantic,
  computeExactFingerprint,
  computeSemanticFingerprint,
  finalizeVerifyFinding,
  computeFindingsDigest,
  appendDigestToRing,
  digestRecurredInRing,
  EVIDENCE_TRUNCATION_SENTINEL,
} from "../lib/verify-finding-fingerprint.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("verify-finding-fingerprint", () => {
  it("truncates at byte boundary with sentinel", () => {
    const long = "x".repeat(3000);
    const out = truncateEvidenceBytes(long);
    assert.ok(out.endsWith(EVIDENCE_TRUNCATION_SENTINEL));
    assert.ok(Buffer.byteLength(out, "utf8") <= 2048 + Buffer.byteLength(EVIDENCE_TRUNCATION_SENTINEL, "utf8"));
  });

  it("semantic fingerprint ignores line drift in evidence", () => {
    const evidence = "error TS2345: Type 'string' is not assignable";
    const a = computeSemanticFingerprint({
      failed_gate: "gate",
      offending_file: "src/a.ts",
      line: 40,
      rule_id: "tsc",
      evidence,
    });
    const b = computeSemanticFingerprint({
      failed_gate: "gate",
      offending_file: "src/a.ts",
      line: 43,
      rule_id: "tsc",
      evidence,
    });
    assert.equal(a, b);
  });

  it("exact fingerprint changes when line changes", () => {
    const a = computeExactFingerprint({
      failed_gate: "gate",
      offending_file: "src/a.ts",
      line: 40,
      rule_id: "tsc",
    });
    const b = computeExactFingerprint({
      failed_gate: "gate",
      offending_file: "src/a.ts",
      line: 43,
      rule_id: "tsc",
    });
    assert.notEqual(a, b);
  });

  it("ring detects A-B-A flap", () => {
    const dA = "digest-a";
    const dB = "digest-b";
    let ring = appendDigestToRing([], dA);
    ring = appendDigestToRing(ring, dB);
    assert.equal(digestRecurredInRing(ring, dB), true);
    assert.equal(digestRecurredInRing(ring, dA), true);
    assert.equal(digestRecurredInRing(ring, "digest-c"), false);
  });

  it("finalize attaches fingerprints", () => {
    const f = finalizeVerifyFinding({
      failed_gate: "gate",
      offending_file: "f.ts",
      line: 1,
      severity: "error",
      resolution_hint: "fix",
    });
    assert.ok(f.fingerprint.length > 0);
    assert.ok(f.semantic_fingerprint.length > 0);
  });

  it("normalizeEvidence strips diff hunk headers", () => {
    const raw = "@@ -10,3 +13,4 @@\n const x = 1;";
    const norm = normalizeEvidenceForSemantic(raw);
    assert.ok(!norm.includes("@@"));
  });

  it("computeFindingsDigest sorts unique semantic keys", () => {
    const f1 = finalizeVerifyFinding({
      failed_gate: "gate",
      offending_file: "a.ts",
      line: 0,
      severity: "error",
      resolution_hint: "a",
    });
    const f2 = finalizeVerifyFinding({
      failed_gate: "gate",
      offending_file: "b.ts",
      line: 0,
      severity: "error",
      resolution_hint: "b",
    });
    const digest = computeFindingsDigest([f1, f2]);
    assert.equal(digest, computeFindingsDigest([f2, f1]));
  });
});
