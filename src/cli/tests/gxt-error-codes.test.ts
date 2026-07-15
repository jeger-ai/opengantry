import test from "node:test";
import assert from "node:assert/strict";
import {
  GXT_ERROR,
  gxtCodeFromGantryUserError,
  isKnownGantryUserErrorCode,
  mapGitProofCodeToGxt,
} from "../lib/gxt-error-codes.js";

test("mapGitProofCodeToGxt: known git-proof codes map to MISSION_UNSTAMPED", () => {
  assert.equal(mapGitProofCodeToGxt("NO_MSN_COMMITS"), GXT_ERROR.MISSION_UNSTAMPED);
  assert.equal(mapGitProofCodeToGxt("MISSION_NO_GATE"), GXT_ERROR.MISSION_UNSTAMPED);
});

test("gxtCodeFromGantryUserError: upgrade codes map to VERIFY_FAILED not MISSION_UNSTAMPED", () => {
  assert.equal(gxtCodeFromGantryUserError("UPGRADE_STAGING_MISSING"), GXT_ERROR.VERIFY_FAILED);
  assert.equal(gxtCodeFromGantryUserError("UPGRADE_HASH_MISMATCH"), GXT_ERROR.VERIFY_FAILED);
  assert.equal(gxtCodeFromGantryUserError("MISSION_NOT_FOUND"), GXT_ERROR.PARSE_ERROR);
});

test("gxtCodeFromGantryUserError: unknown codes fall back to VERIFY_FAILED", () => {
  assert.equal(gxtCodeFromGantryUserError("TOTALLY_UNKNOWN"), GXT_ERROR.VERIFY_FAILED);
  assert.equal(isKnownGantryUserErrorCode("TOTALLY_UNKNOWN"), false);
});

test("gxtCodeFromGantryUserError: passthrough GXT_* codes", () => {
  assert.equal(gxtCodeFromGantryUserError("GXT_GATE_FAILED"), GXT_ERROR.GATE_FAILED);
});

test("gxtCodeFromGantryUserError: INVALID_ARGUMENT maps to GXT_INVALID_ARGUMENT", () => {
  assert.equal(gxtCodeFromGantryUserError("INVALID_ARGUMENT"), GXT_ERROR.INVALID_ARGUMENT);
  assert.equal(isKnownGantryUserErrorCode("INVALID_ARGUMENT"), true);
});

test("gxtCodeFromGantryUserError: runtime and forbidden codes", () => {
  assert.equal(gxtCodeFromGantryUserError("FORBIDDEN_ZONE_VIOLATION"), GXT_ERROR.FORBIDDEN_ZONE);
  assert.equal(gxtCodeFromGantryUserError("RUNTIME_EXEC_FAILED"), GXT_ERROR.RUNTIME_EXEC_FAILED);
  assert.equal(gxtCodeFromGantryUserError("MCP_WRITE_DENIED"), GXT_ERROR.MCP_WRITE_DENIED);
});

test("mapGitProofCodeToGxt: all git-proof codes are known", () => {
  const codes = [
    "MISSION_MISSING_MSN",
    "PLANNER_IDENTITY_UNCONFIGURED",
    "NO_MSN_COMMITS",
    "NO_PLANNER_MSN_COMMIT",
    "MISSION_FILE_NOT_MODIFIED_BY_PLANNER",
    "MISSION_OUTSIDE_MISSIONS_DIR",
    "MISSION_NO_GATE",
    "PLANNER_STAMP_UNSIGNED",
  ];
  for (const code of codes) {
    assert.equal(isKnownGantryUserErrorCode(code), true);
    if (code === "PLANNER_STAMP_UNSIGNED") {
      assert.equal(mapGitProofCodeToGxt(code), GXT_ERROR.PLANNER_STAMP_UNSIGNED);
    } else {
      assert.equal(mapGitProofCodeToGxt(code), GXT_ERROR.MISSION_UNSTAMPED);
    }
  }
});
