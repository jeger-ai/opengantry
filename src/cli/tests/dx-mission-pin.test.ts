import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { REL_RECEIPTS_DIR } from "../lib/constants.js";
import { resolveMissionArg } from "../lib/mission-arg.js";
import {
  listReceipts,
  resolveReceiptPath,
  summarizeReceipt,
} from "../lib/receipt-inspect.js";
import {
  pinMissionFile,
  readActiveMissionPin,
} from "../lib/missions/parser.js";
import { GantryUserError } from "../lib/errors.js";
import type { AttestationReceipt } from "../lib/attestation-receipt.js";

function setupRepo(): { root: string; missionRel: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-dx-"));
  const missionRel = ".gitagent/missions/MSN-0999.test.yaml";
  fs.mkdirSync(path.join(root, ".gitagent/missions"), { recursive: true });
  fs.writeFileSync(
    path.join(root, missionRel),
    "msn_id: MSN-0999\nskill_key: ui\ngate_command: echo OK\ntrace_rows: []\n",
    "utf8",
  );
  return { root, missionRel };
}

test("resolveMissionArg: explicit flag wins over pin", () => {
  const { root, missionRel } = setupRepo();
  const otherRel = ".gitagent/missions/MSN-0001.other.yaml";
  fs.writeFileSync(
    path.join(root, otherRel),
    "msn_id: MSN-0001\nskill_key: ui\ngate_command: echo OK\ntrace_rows: []\n",
    "utf8",
  );
  pinMissionFile(root, path.join(root, missionRel));
  const resolved = resolveMissionArg(root, otherRel);
  assert.equal(resolved.source, "flag");
  assert.equal(resolved.missionRel, otherRel);
});

test("resolveMissionArg: pin when flag omitted", () => {
  const { root, missionRel } = setupRepo();
  pinMissionFile(root, path.join(root, missionRel));
  const resolved = resolveMissionArg(root);
  assert.equal(resolved.source, "pin");
  assert.equal(resolved.missionRel, missionRel);
});

test("resolveMissionArg: MISSION_REQUIRED when unset", () => {
  const { root } = setupRepo();
  assert.throws(
    () => resolveMissionArg(root),
    (e: unknown) => e instanceof GantryUserError && e.code === "MISSION_REQUIRED",
  );
});

test("pinMissionFile writes repo-relative path", () => {
  const { root, missionRel } = setupRepo();
  pinMissionFile(root, path.join(root, missionRel));
  assert.equal(readActiveMissionPin(root), missionRel);
});

test("receipt list/show latest by MSN", () => {
  const { root } = setupRepo();
  const receiptsDir = path.join(root, REL_RECEIPTS_DIR);
  fs.mkdirSync(receiptsDir, { recursive: true });

  const older: AttestationReceipt = {
    schema_version: "0.1.0",
    msn_id: "MSN-0999",
    mission_rel: ".gitagent/missions/MSN-0999.test.yaml",
    mission_sha256: "a".repeat(64),
    manifest_sha256: null,
    target_architecture_sha256: null,
    config_sha256: null,
    git_head: "abc",
    planner_stamp: null,
    verify_status: "passed",
    issued_at: "2026-01-01T00:00:00.000Z",
    receipt_sha256: "b".repeat(64),
  };
  const newer: AttestationReceipt = { ...older, receipt_sha256: "c".repeat(64), issued_at: "2026-02-01T00:00:00.000Z" };

  const olderPath = path.join(receiptsDir, "MSN-0999-oldhash.json");
  const newerPath = path.join(receiptsDir, "MSN-0999-newhash.json");
  fs.writeFileSync(olderPath, JSON.stringify(older));
  fs.writeFileSync(newerPath, JSON.stringify(newer));
  const olderMtime = Date.now() - 60_000;
  const newerMtime = Date.now();
  fs.utimesSync(olderPath, olderMtime / 1000, olderMtime / 1000);
  fs.utimesSync(newerPath, newerMtime / 1000, newerMtime / 1000);

  const listed = listReceipts(root, "MSN-0999");
  assert.equal(listed.length, 2);
  assert.ok(listed[0]!.path.includes("newhash"));

  const { receipt, relPath } = resolveReceiptPath(root, "MSN-0999");
  assert.equal(receipt.receipt_sha256, newer.receipt_sha256);
  const summary = summarizeReceipt(relPath, receipt);
  assert.equal(summary.verify_status, "passed");
});

test("emitPinnedMissionBanner only for pin source", () => {
  const { root, missionRel } = setupRepo();
  assert.equal(resolveMissionArg(root, missionRel).source, "flag");
  pinMissionFile(root, path.join(root, missionRel));
  assert.equal(resolveMissionArg(root).source, "pin");
});
