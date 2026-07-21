import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalJson } from "../lib/canonical-json.js";
import {
  buildAttestationReceipt,
  computeReceiptSha256,
} from "../lib/attestation-receipt.js";
import { REL_MANIFEST } from "../lib/constants.js";
import { GantryUserError } from "../lib/errors.js";
import { getRepoRoot } from "../lib/git.js";
import { parseMissionFile } from "../lib/missions/parser.js";
import { writeRuntimeExecRepo } from "./test-fixtures.js";
import { signReceiptHash, verifyReceiptSignature } from "../lib/receipt-signing.js";
import { gitConfigGet } from "../lib/git.js";

test("canonicalJson: deterministic key order", () => {
  const a = canonicalJson({ b: 2, a: 1, nested: { z: 1, y: 2 } });
  const b = canonicalJson({ nested: { y: 2, z: 1 }, a: 1, b: 2 });
  assert.equal(a, b);
});

test("attestation receipt: stable receipt_sha256 and no stream bodies", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-attest-"));
  writeRuntimeExecRepo(dest, ogRoot, []);
  const missionArg = ".gitagent/missions/runtime.yaml";
  const mission = parseMissionFile(dest, missionArg);
  const receipt = buildAttestationReceipt({
    root: dest,
    mission,
    missionArg,
    verifyStatus: "attest_only",
  });
  assert.equal(receipt.schema_version, "0.1.0");
  assert.equal(receipt.verify_status, "attest_only");
  assert.equal(receipt.receipt_sha256, computeReceiptSha256(receipt));
  assert.equal(receipt.signature, undefined);
  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /chunk_b64/);
});

test("attestation receipt: rejects missing MANIFEST with GantryUserError", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-attest-no-manifest-"));
  writeRuntimeExecRepo(dest, ogRoot, []);
  fs.rmSync(path.join(dest, REL_MANIFEST), { force: true });
  const missionArg = ".gitagent/missions/runtime.yaml";
  const mission = parseMissionFile(dest, missionArg);
  assert.throws(
    () =>
      buildAttestationReceipt({
        root: dest,
        mission,
        missionArg,
        verifyStatus: "attest_only",
      }),
    (err: unknown) => {
      assert.ok(err instanceof GantryUserError);
      assert.equal(err.code, "MANIFEST_MISSING");
      assert.equal(err.exitCode, 2);
      return true;
    },
  );
});

test("attestation receipt: verify mapping uses failed status", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-attest-fail-"));
  writeRuntimeExecRepo(dest, ogRoot, []);
  const missionArg = ".gitagent/missions/runtime.yaml";
  const mission = parseMissionFile(dest, missionArg);
  const receipt = buildAttestationReceipt({
    root: dest,
    mission,
    missionArg,
    verifyStatus: "failed",
    errorCode: "GATE_FAILED",
  });
  assert.equal(receipt.verify_status, "failed");
  assert.equal(receipt.error_code, "GATE_FAILED");
});

test("receipt signing: SSH round-trip when local signing key is configured", () => {
  const ogRoot = getRepoRoot();
  if (gitConfigGet(ogRoot, "gpg.format") !== "ssh") return;
  if (!gitConfigGet(ogRoot, "user.signingkey")) return;

  const hash = "abc123deadbeef";
  const signed = signReceiptHash(ogRoot, hash);
  if (!signed) return;
  assert.equal(signed.kind, "ssh");
  assert.ok(signed.signature_b64.length > 0);
  assert.equal(verifyReceiptSignature(ogRoot, hash, signed), "good");
});
