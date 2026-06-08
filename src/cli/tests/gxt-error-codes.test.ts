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
  assert.equal(gxtCodeFromGapmanUserError("MISSION_NOT_FOUND"), GXT_ERROR.PARSE_ERROR);
});

test("gxtCodeFromGapmanUserError: unknown codes fall back to VERIFY_FAILED", () => {
  assert.equal(gxtCodeFromGapmanUserError("TOTALLY_UNKNOWN"), GXT_ERROR.VERIFY_FAILED);
  assert.equal(isKnownGapmanUserErrorCode("TOTALLY_UNKNOWN"), false);
});

test("gxtCodeFromGapmanUserError: passthrough GXT_* codes", () => {
  assert.equal(gxtCodeFromGapmanUserError("GXT_GATE_FAILED"), GXT_ERROR.GATE_FAILED);
});

test("gxtCodeFromGapmanUserError: runtime and forbidden codes", () => {
  assert.equal(gxtCodeFromGapmanUserError("FORBIDDEN_ZONE_VIOLATION"), GXT_ERROR.FORBIDDEN_ZONE);
  assert.equal(gxtCodeFromGapmanUserError("RUNTIME_EXEC_FAILED"), GXT_ERROR.RUNTIME_EXEC_FAILED);
});

test("mapGitProofCodeToGxt: all git-proof codes are known", () => {
  const codes = [
    "MISSION_MISSING_MSN",
    "TEACHER_IDENTITY_UNCONFIGURED",
    "NO_MSN_COMMITS",
    "NO_TEACHER_MSN_COMMIT",
    "MISSION_FILE_NOT_MODIFIED_BY_TEACHER",
    "MISSION_OUTSIDE_MISSIONS_DIR",
    "MISSION_NO_GATE",
  ];
  for (const code of codes) {
    assert.equal(isKnownGapmanUserErrorCode(code), true);
    assert.equal(mapGitProofCodeToGxt(code), GXT_ERROR.MISSION_UNSTAMPED);
  }
});
