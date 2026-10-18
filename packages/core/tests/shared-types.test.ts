import test from "node:test";
import assert from "node:assert/strict";
import { interrogationSha256, stableFindingId, compareFindingSeverity } from "../src/interrogation.js";
import { isPassTraceRow, normalizeTraceStatus } from "../src/trace-status.js";
import { isGateAdapterId, isTypedGateAdapterId } from "../src/gate-adapter.js";
import { explicitLedgerMode, parseGxtConfig, resolveLedgerSignatureTier, resolvePlannerSignatureTier } from "../src/config.js";
import { msnIdOrDefault } from "../src/mission-types.js";

test("interrogation digest is order-independent in adr_refs and ignores evidence", () => {
  const a = interrogationSha256([{ finding_id: "x", kind: "adr_conflict", question: "q", hypothesis: "h", operator_answer: "a", adr_refs: ["ADR-0002", "ADR-0001"] }]);
  const b = interrogationSha256([{ finding_id: "x", kind: "adr_conflict", question: "q", hypothesis: "h", operator_answer: "a", adr_refs: ["ADR-0001", "ADR-0002"] }]);
  assert.equal(a, b);
  assert.equal(stableFindingId("adr_conflict", "ADR-0052").length, 12);
  assert.ok(compareFindingSeverity("risk_escalation", "adr_conflict") < 0);
});

test("trace status normalizes case and defaults to PENDING", () => {
  assert.equal(normalizeTraceStatus(" pass "), "PASS");
  assert.equal(normalizeTraceStatus("nope"), "PENDING");
  assert.equal(isPassTraceRow("PASS"), true);
});

test("gate adapter ids", () => {
  assert.equal(isGateAdapterId("tsc"), true);
  assert.equal(isTypedGateAdapterId("generic"), false);
});

test("config: parse tolerates junk; tiers fall back to off; explicit ledger mode is null when left to a preset", () => {
  assert.deepEqual(parseGxtConfig("not json"), {});
  const c = parseGxtConfig(JSON.stringify({ planner_signature: "require", ledger: { signature: "bogus" } }));
  assert.equal(resolvePlannerSignatureTier(c), "require");
  assert.equal(resolveLedgerSignatureTier(c), "off");
  assert.equal(explicitLedgerMode(c), null);
  assert.equal(explicitLedgerMode(parseGxtConfig(JSON.stringify({ ledger: { mode: "local" } }))), "local");
  assert.equal(msnIdOrDefault(null), "MSN-0000");
});
