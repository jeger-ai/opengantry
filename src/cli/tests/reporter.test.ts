import test from "node:test";
import assert from "node:assert/strict";
import { Reporter, currentReporter, reporterFromArgv, resetReporter } from "../output/reporter.js";
import { logError, logInfo, logWarn, writeStdout } from "../output/cli-io.js";
import { resolveAudience } from "#missions/audience-output.js";
import { asCommand, captureConsoleAsync } from "./test-shared.js";

test("resolveAudience: CLI overrides env; invalid CLI value is reported", () => {
  assert.equal(resolveAudience("executor", "verifier").audience, "executor");
  const r = resolveAudience("bot", "planner");
  assert.equal(r.invalidCli, "bot");
  assert.equal(r.audience, undefined);
});

test("human reporter: info on stdout, warnings and errors on stderr", async () => {
  const { output } = await captureConsoleAsync(() =>
    asCommand(new Reporter(), () => {
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
    asCommand(new Reporter("human", "verifier"), () => {
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
    asCommand(new Reporter("json", "verifier"), () => {
      logInfo("setup");
      logError("plain failure");
      writeStdout("{}");
    }),
  );
  assert.equal(output.stdout.trim(), "{}");
  assert.match(output.stderr, /setup/);
  assert.match(output.stderr, /plain failure/);
});

test("one reporter per command: set for the action, the plain human reporter back after, also when it throws", async () => {
  resetReporter();
  const inner = new Reporter("sarif");
  await assert.rejects(
    asCommand(inner, () => {
      assert.equal(currentReporter(), inner);
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(currentReporter().structured, false);
});

test("nextSteps: the audience's section title when it has one, the fallback otherwise, steps indented", async () => {
  const plain = await captureConsoleAsync(async () => new Reporter().nextSteps("next actions", ["a", "b"]));
  assert.equal(plain.output.stdout.trim(), "next actions:\n  a\n  b");
  const planner = await captureConsoleAsync(async () =>
    new Reporter("human", "planner").nextSteps("next actions", [], [{ audience: "planner", step: "stamp it" }, { audience: "executor", step: "run it" }]),
  );
  assert.equal(planner.output.stdout.trim(), "Planner next steps:\n  Planner: stamp it");
  assert.doesNotMatch(planner.output.stdout, /run it/);
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
