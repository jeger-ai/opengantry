import test from "node:test";
import assert from "node:assert/strict";
import { buildLedgerEntry, entryHash, genesisPrevHash } from "../src/ledger-entry.js";
import { depsRefForRepo, depsSlug, gitUrlForRepo } from "../src/deps-slug.js";
import { canonicalizeRepositoryIdentifier, hmacSha256Hex, resolveAttestationAgent } from "../src/receipt-attribution.js";
import { configFloorViolations } from "../src/policy-resolve.js";

test("ledger entries chain by canonical hash from the genesis prev hash", () => {
  const first = buildLedgerEntry({ kind: "receipt", org_id: "o", repository_hash: "r", msn_id: "MSN-0001", git_head: "h", payload: { verify_status: "passed" }, prev_entry_hash: genesisPrevHash(), issued_at: "2026-01-01T00:00:00Z" });
  const second = buildLedgerEntry({ kind: "break_glass", org_id: "o", repository_hash: "r", msn_id: "MSN-0001", git_head: "h", payload: { reason_sha256: "x", error_code: "E" }, prev_entry_hash: entryHash(first), issued_at: "2026-01-01T00:00:01Z" });
  assert.equal(second.prev_entry_hash, entryHash(first));
  assert.equal(first.payload_sha256.length, 64);
});

test("dependency slugs and refs are canonical and safe", () => {
  assert.equal(depsSlug("git@github.com:Jeger-AI/OpenGantry.git"), "github-com-jeger-ai-opengantry");
  assert.equal(depsRefForRepo("github.com/jeger-ai/opengantry"), "refs/gxt/deps/github-com-jeger-ai-opengantry");
  assert.equal(gitUrlForRepo("github.com/jeger-ai/opengantry"), "https://github.com/jeger-ai/opengantry.git");
  assert.throws(() => gitUrlForRepo("https://evil.example/x;rm -rf /"), /unsafe repository identifier/);
});

test("attribution: canonical repository ids, keyed digests, and the agent carries the caller's version", () => {
  assert.equal(canonicalizeRepositoryIdentifier("https://GitHub.com/Org/Repo.git"), "github.com/org/repo");
  assert.equal(hmacSha256Hex("pepper", "x"), hmacSha256Hex("pepper", "x"));
  assert.equal(resolveAttestationAgent("9.9.9", "cli").version, "9.9.9");
});

test("policy floor: the org floor may only tighten the local config", () => {
  assert.deepEqual(configFloorViolations({ planner_signature: "off" }, { planner_signature: "require" }), []);
  assert.match(configFloorViolations({ planner_signature: "require" }, { planner_signature: "off" })[0] ?? "", /planner_signature floor require > local off/);
});
