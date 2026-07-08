import test from "node:test";
import assert from "node:assert/strict";
import { resolveVerifySink } from "../lib/verify-presenters.js";

test("resolveVerifySink: human default", () => {
  assert.equal(resolveVerifySink({}), "human");
});

test("resolveVerifySink: json mode", () => {
  assert.equal(resolveVerifySink({ json: true }), "json");
});

test("resolveVerifySink: break-glass human and json", () => {
  assert.equal(resolveVerifySink({ breakGlass: true }), "break_glass_human");
  assert.equal(resolveVerifySink({ breakGlass: true, json: true }), "break_glass_json");
});

test("resolveVerifySink: fix interactive and non-interactive", () => {
  assert.equal(resolveVerifySink({ fix: true }), "fix_interactive");
  assert.equal(resolveVerifySink({ fix: true, fixNonInteractive: true }), "fix_noninteractive");
});

test("resolveVerifySink: break-glass takes precedence over fix", () => {
  assert.equal(resolveVerifySink({ breakGlass: true, fix: true }), "break_glass_human");
});
