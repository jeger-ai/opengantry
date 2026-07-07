import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAudienceFromArgv,
  resetOutputContext,
  shouldEmitError,
  shouldEmitInfo,
  setJsonOutputMode,
  setOutputAudience,
} from "../lib/output-context.js";
import { resolveAudience } from "../lib/audience-output.js";

test("resolveAudience: CLI overrides env", () => {
  const r = resolveAudience("executor", "verifier");
  assert.equal(r.audience, "executor");
});

test("resolveAudience: invalid CLI value", () => {
  const r = resolveAudience("bot", "planner");
  assert.equal(r.invalidCli, "bot");
  assert.equal(r.audience, undefined);
});

test("verifier mode: suppress info and non-GXT errors", () => {
  resetOutputContext();
  setOutputAudience("verifier");
  assert.equal(shouldEmitInfo(), false);
  assert.equal(shouldEmitError("plain failure"), false);
  assert.equal(shouldEmitError("[GXT_GATE_FAILED] verify failed"), true);
});

test("json mode: emits despite verifier audience", () => {
  resetOutputContext();
  setOutputAudience("verifier");
  setJsonOutputMode(true);
  assert.equal(shouldEmitInfo(), true);
  assert.equal(shouldEmitError("plain failure"), true);
});

test("applyAudienceFromArgv: rejects invalid role", () => {
  resetOutputContext();
  const r = applyAudienceFromArgv("nope");
  assert.equal(r.ok, false);
  assert.equal(r.invalidValue, "nope");
});
