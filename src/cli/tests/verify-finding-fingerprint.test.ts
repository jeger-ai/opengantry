import { appendDigestToRing, computeFindingsDigest } from "#missions/mission-verify/finding-fingerprint.js";
import { verifyFinding } from "#missions/mission-verify/finding.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("verify-finding-fingerprint", () => {
  it("the findings digest ignores line drift", () => {
    const at = (line: number) => [verifyFinding("gate", "fix", { offending_file: "src/a.ts", line, rule_id: "tsc" })];
    assert.equal(computeFindingsDigest(at(40)), computeFindingsDigest(at(43)));
  });

  it("the findings digest keeps the value it had with per-finding fingerprints, so an existing ring still trips", () => {
    const findings = [
      verifyFinding("gate", "x", { offending_file: "src/a.ts", line: 3, rule_id: "TS2322" }),
      verifyFinding("gate", "gate command failed"),
    ];
    assert.equal(computeFindingsDigest(findings), "eea6efcfcd1fb0f43bf1fa5d4c095c792c4916cda84fc0ae6d7ecfe012b06139");
  });

  it("the findings digest changes with the rule or the file", () => {
    const base = computeFindingsDigest([verifyFinding("gate", "fix", { offending_file: "src/a.ts", rule_id: "tsc" })]);
    assert.notEqual(base, computeFindingsDigest([verifyFinding("gate", "fix", { offending_file: "src/a.ts", rule_id: "eslint" })]));
    assert.notEqual(base, computeFindingsDigest([verifyFinding("gate", "fix", { offending_file: "src/b.ts", rule_id: "tsc" })]));
  });

  it("ring detects A-B-A flap", () => {
    const dA = "digest-a";
    const dB = "digest-b";
    let ring = appendDigestToRing([], dA);
    ring = appendDigestToRing(ring, dB);
    assert.equal(ring.includes(dB), true);
    assert.equal(ring.includes(dA), true);
    assert.equal(ring.includes("digest-c"), false);
  });

  it("the ring moves a repeated digest to the end and keeps four", () => {
    assert.deepEqual(appendDigestToRing(["a", "b", "c", "d"], "e"), ["b", "c", "d", "e"]);
    assert.deepEqual(appendDigestToRing(["a", "b", "c"], "a"), ["b", "c", "a"]);
  });

  it("computeFindingsDigest sorts unique semantic keys", () => {
    const f1 = verifyFinding("gate", "a", { offending_file: "a.ts" });
    const f2 = verifyFinding("gate", "b", { offending_file: "b.ts" });
    const digest = computeFindingsDigest([f1, f2]);
    assert.equal(digest, computeFindingsDigest([f2, f1]));
    assert.equal(digest, computeFindingsDigest([f1, f2, f1]));
  });
});
