import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendVerifyRunRing,
  listVerifyRuns,
  readVerifyRunRing,
  readVerifyRunSnapshot,
  findLatestVerifyRunForMission,
  REL_VERIFY_RUNS_DIR,
  VERIFY_RUN_RING_MAX,
  type VerifyLastSnapshot,
} from "../lib/verify-run-ring.js";

function snapshot(n: number, msnId = "MSN-0181"): VerifyLastSnapshot {
  return {
    schema_version: 1,
    written_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    outcome: n % 2 === 0 ? "PASS" : "FAIL",
    msn_id: msnId,
    digest_ring: [],
    phases: [{ id: "gate", duration_ms: n, status: n % 2 === 0 ? "passed" : "failed" }],
  };
}

test("listVerifyRuns: missing dir is empty", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-miss-"));
  assert.deepEqual(listVerifyRuns(root), []);
});

test("appendVerifyRunRing: PASS and FAIL append; cap drops oldest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-cap-"));
  for (let i = 0; i < VERIFY_RUN_RING_MAX + 1; i += 1) {
    appendVerifyRunRing(root, snapshot(i));
  }
  const entries = listVerifyRuns(root);
  assert.equal(entries.length, VERIFY_RUN_RING_MAX);
  assert.equal(entries[0]?.findings_count, 0);
  assert.equal(
    fs.readdirSync(path.join(root, REL_VERIFY_RUNS_DIR)).filter((n) => /^\d{13}-[0-9a-f]{6}\.json$/.test(n))
      .length,
    VERIFY_RUN_RING_MAX,
  );
});

test("listVerifyRuns: corrupt file is skipped without throw", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-bad-"));
  appendVerifyRunRing(root, snapshot(1));
  const good = listVerifyRuns(root);
  assert.equal(good.length, 1);
  fs.writeFileSync(path.join(root, REL_VERIFY_RUNS_DIR, "not-a-run.json"), "{not-json", "utf8");
  const recovered = listVerifyRuns(root);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.id, good[0]?.id);
});

test("appendVerifyRunRing stores full snapshot for drill-down", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-snap-"));
  appendVerifyRunRing(root, snapshot(3));
  const [entry] = listVerifyRuns(root);
  assert.ok(entry?.id);
  const loaded = readVerifyRunSnapshot(root, entry!.id);
  assert.equal(loaded?.msn_id, "MSN-0181");
  assert.equal(loaded?.phases[0]?.duration_ms, 3);
});

test("readVerifyRunSnapshot rejects traversal ids", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-traversal-"));
  assert.equal(readVerifyRunSnapshot(root, "../evil"), null);
  assert.equal(readVerifyRunSnapshot(root, "foo/bar"), null);
});

test("findLatestVerifyRunForMission returns newest matching entry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-msn-"));
  appendVerifyRunRing(root, snapshot(1, "MSN-0001"));
  appendVerifyRunRing(root, snapshot(2, "MSN-0181"));
  const hit = findLatestVerifyRunForMission(root, "MSN-0181");
  assert.equal(hit?.snapshot.msn_id, "MSN-0181");
  assert.equal(hit?.snapshot.outcome, "PASS");
});

test("readVerifyRunRing is alias for listVerifyRuns", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-alias-"));
  appendVerifyRunRing(root, snapshot(1));
  assert.deepEqual(readVerifyRunRing(root), listVerifyRuns(root));
});
