import test from "node:test";
import assert from "node:assert/strict";
import {
  GXT_ERROR,
  gxtCodeFromGapmanUserError,
  isKnownGapmanUserErrorCode,
  mapGitProofCodeToGxt,
} from "../lib/gxt-error-codes.js";

test("mapGitProofCodeToGxt: known git-proof codes map to MISSION_UNSTAMPED", () => {
  assert.equal(mapGitProofCodeToGxt("NO_MSN_COMMITS"), GXT_ERROR.MISSION_UNSTAMPED);
  assert.equal(mapGitProofCodeToGxt("MISSION_NO_GATE"), GXT_ERROR.MISSION_UNSTAMPED);
});

test("gxtCodeFromGapmanUserError: upgrade codes map to VERIFY_FAILED not MISSION_UNSTAMPED", () => {
  assert.equal(gxtCodeFromGapmanUserError("UPGRADE_STAGING_MISSING"), GXT_ERROR.VERIFY_FAILED);
  assert.equal(gxtCodeFromGapmanUserError("UPGRADE_HASH_MISMATCH"), GXT_ERROR.VERIFY_FAILED);
  assert.equal(gxtCodeFromGapmanUserError("MISSION_NOT_FOUND"), GXT_ERROR.VERIFY_FAILED);
});

test("gxtCodeFromGapmanUserError: unknown codes fall back to VERIFY_FAILED", () => {
  assert.equal(gxtCodeFromGapmanUserError("TOTALLY_UNKNOWN"), GXT_ERROR.VERIFY_FAILED);
  assert.equal(isKnownGapmanUserErrorCode("TOTALLY_UNKNOWN"), false);
});

test("gxtCodeFromGapmanUserError: passthrough GXT_* codes", () => {
  assert.equal(gxtCodeFromGapmanUserError("GXT_GATE_FAILED"), GXT_ERROR.GATE_FAILED);
});
