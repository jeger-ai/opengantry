import test from "node:test";
import assert from "node:assert/strict";
import { Reporter, currentReporter, reporterFromArgv, resetReporter, withReporter } from "../lib/reporter.js";
import { logError, logInfo, logWarn, writeStdout } from "../lib/cli-io.js";
import { resolveAudience } from "../lib/audience-output.js";
import { captureConsoleAsync } from "./test-shared.js";

test("resolveAudience: CLI overrides env; invalid CLI value is reported", () => {
  assert.equal(resolveAudience("executor", "verifier").audience, "executor");
  const r = resolveAudience("bot", "planner");
  assert.equal(r.invalidCli, "bot");
  assert.equal(r.audience, undefined);
});

test("human reporter: info on stdout, warnings and errors on stderr", async () => {
  const { output } = await captureConsoleAsync(() =>
    withReporter(new Reporter(), () => {
      logInfo("plain");
      logWarn("careful");
      logError("[GXT_GATE_FAILED] no");
    }),
  );
  assert.equal(output.stdout.trim(), "plain");
  assert.match(output.stderr, /gantry: warning: careful/);
  assert.match(output.stderr, /gantry: \[GXT_GATE_FAILED\] no/);
});

test("verifier audience: info and uncoded errors are suppressed, coded errors pass", async () => {
  const { output } = await captureConsoleAsync(() =>
    withReporter(new Reporter("human", "verifier"), () => {
      logInfo("plain");
      logError("plain failure");
      logError("[GXT_GATE_FAILED] verify failed");
    }),
  );
  assert.equal(output.stdout.trim(), "");
  assert.doesNotMatch(output.stderr, /plain failure/);
  assert.match(output.stderr, /\[GXT_GATE_FAILED\] verify failed/);
});

test("structured reporter: stdout carries only the document, even for the verifier audience", async () => {
  const { output } = await captureConsoleAsync(() =>
    withReporter(new Reporter("json", "verifier"), () => {
      logInfo("setup");
      logError("plain failure");
      writeStdout("{}");
    }),
  );
  assert.equal(output.stdout.trim(), "{}");
  assert.match(output.stderr, /setup/);
  assert.match(output.stderr, /plain failure/);
});

test("withReporter restores the previous reporter, also when fn throws", async () => {
  resetReporter();
  const inner = new Reporter("sarif");
  await assert.rejects(
    withReporter(inner, () => {
      assert.equal(currentReporter(), inner);
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(currentReporter().structured, false);
});

test("reporterFromArgv: mode from --format or --json, audience from the flag or the env, invalid role reported", () => {
  const sarif = reporterFromArgv({ format: "sarif" }, undefined);
  assert.ok("reporter" in sarif && sarif.reporter.mode === "sarif");
  const json = reporterFromArgv({ json: true }, "planner");
  assert.ok("reporter" in json && json.reporter.mode === "json" && json.reporter.audience === "planner");
  const html = reporterFromArgv({ format: "html" }, undefined);
  assert.ok("reporter" in html && html.reporter.mode === "human");
  const bad = reporterFromArgv({ audience: "nope" }, undefined);
  assert.deepEqual(bad, { invalidAudience: "nope" });
});
