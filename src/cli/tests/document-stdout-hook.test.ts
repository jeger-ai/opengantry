import test from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";
import { logInfo } from "../lib/cli-io.js";
import { currentReporter, resetReporter } from "../lib/reporter.js";
import { registerReporterHook } from "../program-reporter-hook.js";
import { captureConsoleAsync } from "./test-shared.js";

function programWithSpeak(): Command {
  const program = new Command();
  program.exitOverride((err) => {
    throw err;
  });
  registerReporterHook(program);
  program
    .command("speak")
    .option("--json")
    .option("--format <fmt>")
    .action(() => {
      logInfo("hello");
    });
  program.command("boom").option("--json").action(() => {
    throw new Error("boom");
  });
  return program;
}

test("document stdout hook: sequential --json then human does not leak", async () => {
  resetReporter();
  const first = await captureConsoleAsync(async () => {
    await programWithSpeak().parseAsync(["speak", "--json"], { from: "user" });
  });
  assert.match(first.output.stderr, /hello/);
  assert.equal(first.output.stdout.trim(), "");
  assert.equal(currentReporter().structured, false);

  const second = await captureConsoleAsync(async () => {
    await programWithSpeak().parseAsync(["speak"], { from: "user" });
  });
  assert.match(second.output.stdout, /hello/);
  assert.doesNotMatch(second.output.stderr, /hello/);
  assert.equal(currentReporter().structured, false);
});

test("document stdout hook: thrown --json action still decrements", async () => {
  resetReporter();
  await assert.rejects(
    () => programWithSpeak().parseAsync(["boom", "--json"], { from: "user" }),
    /boom/,
  );
  assert.equal(currentReporter().structured, false);

  const after = await captureConsoleAsync(async () => {
    await programWithSpeak().parseAsync(["speak"], { from: "user" });
  });
  assert.match(after.output.stdout, /hello/);
  assert.equal(currentReporter().structured, false);
});

test("document stdout hook: --format sarif diverts logInfo and postAction clears it", async () => {
  resetReporter();
  const captured = await captureConsoleAsync(async () => {
    await programWithSpeak().parseAsync(["speak", "--format", "sarif"], { from: "user" });
  });
  assert.match(captured.output.stderr, /hello/);
  assert.equal(currentReporter().structured, false);
});
