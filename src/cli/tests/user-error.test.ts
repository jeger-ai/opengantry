import test from "node:test";
import assert from "node:assert/strict";
import {
  GapmanUserError,
  isGapmanUserError,
  reportUserFacingError,
} from "../lib/errors.js";
import { captureConsole } from "./test-shared.js";

test("GapmanUserError: isGapmanUserError type guard", () => {
  const err = new GapmanUserError("TEST", "test message", "do this");
  assert.equal(isGapmanUserError(err), true);
  assert.equal(isGapmanUserError(new Error("x")), false);
  assert.equal(err.gxtCode, "GXT_VERIFY_FAILED");
});

test("GapmanUserError: git-proof codes expose stable GXT code", () => {
  const err = new GapmanUserError("NO_MSN_COMMITS", "missing stamp", "commit first");
  assert.equal(err.gxtCode, "GXT_MISSION_UNSTAMPED");
});

test("reportUserFacingError: GapmanUserError prints Fix hint without stack", () => {
  const prevExit = process.exitCode;
  try {
    const err = new GapmanUserError(
      "MISSION_NO_GATE",
      "gapman verify: MISSION_NO_GATE — no gate",
      "add gate_command to mission",
      1,
    );
    const { output } = captureConsole(() => {
      process.exitCode = undefined;
      reportUserFacingError(err);
    });
    const combined = output.stdout + output.stderr;
    assert.match(combined, /MISSION_NO_GATE/);
    assert.match(combined, /Fix: add gate_command/);
    assert.doesNotMatch(combined, /at reportUserFacingError/);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = prevExit;
  }
});

test("reportUserFacingError: legacy git-proof message gets code-specific hint", () => {
  const prevExit = process.exitCode;
  try {
    const err = new Error(
      "gapman verify: git-proof: NO_MSN_COMMITS — No commits found starting with [MSN-0999].",
    );
    const { output } = captureConsole(() => {
      process.exitCode = undefined;
      reportUserFacingError(err);
    });
    const combined = output.stdout + output.stderr;
    assert.match(combined, /NO_MSN_COMMITS/);
    assert.match(combined, /Fix:/);
    assert.match(combined, /git commit -m "\[MSN-0999\]/);
    assert.doesNotMatch(combined, /at reportUserFacingError/);
  } finally {
    process.exitCode = prevExit;
  }
});

test("reportUserFacingError: plain Error has no stack unless GAPMAN_DEBUG", () => {
  const prevExit = process.exitCode;
  const prevDebug = process.env.GAPMAN_DEBUG;
  delete process.env.GAPMAN_DEBUG;
  try {
    const err = new Error("unexpected internal");
    err.stack = "Error: unexpected internal\n    at fakeFn (fake.ts:1:1)";
    const { output } = captureConsole(() => reportUserFacingError(err));
    const combined = output.stdout + output.stderr;
    assert.match(combined, /unexpected internal/);
    assert.doesNotMatch(combined, /at fakeFn/);
  } finally {
    process.exitCode = prevExit;
    if (prevDebug === undefined) delete process.env.GAPMAN_DEBUG;
    else process.env.GAPMAN_DEBUG = prevDebug;
  }
});
