import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRunRecord, RUN_RECORD_SCHEMA, runRecordDigest, type RunRecord } from "../src/run-record.js";

const record: RunRecord = { schema: RUN_RECORD_SCHEMA, kind: "verify", msn_id: "MSN-0001", mission_path: ".gitagent/missions/m.yaml", head: "a".repeat(40), tree: "b".repeat(40), law_sha256: "c".repeat(64), checks: [{ name: "gate", command: "npm test", exit: 0, duration_ms: 12, output_sha256: "d".repeat(64) }], status: "PASS", issued_at: "2026-01-01T00:00:00Z" };
const expect = { msnId: "MSN-0001", missionPath: ".gitagent/missions/m.yaml", lawSha256: "c".repeat(64), headIsAncestor: true, changedSinceHead: [] as string[] };

test("a matching, fresh record passes; the digest is stable across key order", () => {
  assert.equal(evaluateRunRecord(record, expect), null);
  const { issued_at, status, ...rest } = record;
  const shuffled = JSON.parse(JSON.stringify({ issued_at, status, ...rest })) as RunRecord;
  assert.equal(runRecordDigest(shuffled), runRecordDigest(record));
});

test("missing, mismatch (msn, mission, law, status, ancestor) and stale are reported in that order", () => {
  assert.equal(evaluateRunRecord(null, expect)?.kind, "missing");
  assert.equal(evaluateRunRecord({ ...record, msn_id: "MSN-0002" }, expect)?.kind, "mismatch");
  assert.equal(evaluateRunRecord({ ...record, mission_path: "x" }, expect)?.kind, "mismatch");
  assert.equal(evaluateRunRecord({ ...record, law_sha256: "0".repeat(64) }, expect)?.kind, "mismatch");
  assert.equal(evaluateRunRecord({ ...record, status: "FAIL" as unknown as "PASS" }, expect)?.kind, "mismatch");
  assert.equal(evaluateRunRecord(record, { ...expect, headIsAncestor: false })?.kind, "mismatch");
  const stale = evaluateRunRecord(record, { ...expect, changedSinceHead: ["src/a.ts", "src/b.ts"] });
  assert.equal(stale?.kind, "stale");
  assert.deepEqual(stale?.stalePaths, ["src/a.ts", "src/b.ts"]);
  assert.match(stale?.reason ?? "", /src\/a\.ts, src\/b\.ts/);
});
