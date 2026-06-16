import test from "node:test";
import assert from "node:assert/strict";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import type { VerifyPhaseFailure } from "../lib/verify-engine.js";
import {
  getSurgeonForErrorCode,
  hasRegisteredSurgeon,
  resolveSurgeonErrorCode,
} from "../lib/surgeons/registry.js";

function gateFailure(stderr: string): VerifyPhaseFailure {
  return {
    ok: false,
    phase: "gate",
    message: "GATE FAILED",
    exitCode: 1,
    workerLogPath: "WORKER_LOG.md",
    gateStderr: stderr,
  };
}

test("resolveSurgeonErrorCode: maps banned-import gate stderr", () => {
  const code = resolveSurgeonErrorCode(
    gateFailure('src/bad.ts: banned import "axios"\n'),
  );
  assert.equal(code, GXT_ERROR.BANNED_IMPORT_DETECTED);
});

test("resolveSurgeonErrorCode: non-gate phase returns null", () => {
  const failure: VerifyPhaseFailure = {
    ok: false,
    phase: "trace",
    message: "trace fail",
    exitCode: 1,
    workerLogPath: "WORKER_LOG.md",
  };
  assert.equal(resolveSurgeonErrorCode(failure), null);
});

test("getSurgeonForErrorCode: BANNED_IMPORT_DETECTED registered", () => {
  assert.equal(hasRegisteredSurgeon(GXT_ERROR.BANNED_IMPORT_DETECTED), true);
  const surgeon = getSurgeonForErrorCode(GXT_ERROR.BANNED_IMPORT_DETECTED);
  assert.ok(surgeon);
  assert.equal(surgeon!.errorCode, GXT_ERROR.BANNED_IMPORT_DETECTED);
});
