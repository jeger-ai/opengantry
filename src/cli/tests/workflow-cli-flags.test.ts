import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { mapLegislateCommanderOptions, verifyOptionsFromCli } from "../program-workflow.js";

test("commander maps interrogate --path and --answers to path/answers keys", () => {
  const cmd = new Command("interrogate");
  cmd.argument("[intent...]", "Planner intent summary");
  cmd.option("--path <paths...>", "Declared paths");
  cmd.option("--answers <file>", "Answers file");
  cmd.option("--msn <id>", "MSN");
  cmd.parse(
    ["fix", "cli", "--path", "src/a.ts", "src/b.ts", "--answers", "/tmp/ans.json", "--msn", "MSN-0100"],
    { from: "user" },
  );
  const opts = cmd.opts() as { path?: string[]; answers?: string; msn?: string };
  assert.deepEqual(opts.path, ["src/a.ts", "src/b.ts"]);
  assert.equal(opts.answers, "/tmp/ans.json");
  assert.equal(opts.msn, "MSN-0100");
});

test("commander maps legislate --path to path key and mapLegislateCommanderOptions forwards paths", () => {
  const cmd = new Command("legislate");
  cmd.argument("[intent...]", "One-line Planner intent summary");
  cmd.option("--path <paths...>", "Declared paths");
  cmd.requiredOption("--msn <id>", "MSN");
  cmd.parse(["ship", "gate", "--msn", "MSN-0101", "--path", "src/cli/foo.ts"], { from: "user" });
  const opts = cmd.opts() as { path?: string[]; msn: string };
  assert.deepEqual(opts.path, ["src/cli/foo.ts"]);

  const mapped = mapLegislateCommanderOptions(
    { msn: opts.msn, path: opts.path },
    "ship gate",
  );
  assert.deepEqual(mapped.paths, ["src/cli/foo.ts"]);
  assert.equal(mapped.intent, "ship gate");
});

test("mapLegislateCommanderOptions reads --interrogation-file JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-legislate-flag-"));
  const answersPath = path.join(dir, "answers.json");
  fs.writeFileSync(
    answersPath,
    JSON.stringify([
      {
        finding_id: "abc",
        kind: "missing_test_criteria",
        question: "q",
        hypothesis: "h",
        operator_answer: "ok",
      },
    ]),
    "utf8",
  );
  const mapped = mapLegislateCommanderOptions(
    { msn: "MSN-0102", interrogationFile: answersPath },
    "intent",
  );
  assert.equal(mapped.interrogation?.source, "operator_file");
  assert.equal(mapped.interrogation?.rows.length, 1);
});

test("verifyOptionsFromCli: requireInterrogation is false when unset (not undefined)", () => {
  const prev = process.env.GANTRY_REQUIRE_INTERROGATION;
  delete process.env.GANTRY_REQUIRE_INTERROGATION;
  try {
    const opts = verifyOptionsFromCli({});
    assert.equal(opts.requireInterrogation, false);
    const explicitOff = verifyOptionsFromCli({ requireInterrogation: false, ci: false });
    assert.equal(explicitOff.requireInterrogation, false);
    const ciOn = verifyOptionsFromCli({ ci: true });
    assert.equal(ciOn.requireInterrogation, true);
  } finally {
    if (prev === undefined) delete process.env.GANTRY_REQUIRE_INTERROGATION;
    else process.env.GANTRY_REQUIRE_INTERROGATION = prev;
  }
});

test("verifyOptionsFromCli: --format text is human output and sarif is kept", () => {
  assert.equal(verifyOptionsFromCli({ format: "text" }).format, undefined);
  assert.equal(verifyOptionsFromCli({ format: "sarif" }).format, "sarif");
  assert.equal(verifyOptionsFromCli({ format: "junit" }).format, "junit");
  assert.throws(() => verifyOptionsFromCli({ format: "html" }), /--format must be text, json, sarif, or junit/);
});

test("context-request commander maps --stage-worker-log to stageWorkerLog", () => {
  const cmd = new Command("context-request");
  cmd.requiredOption("--reason <text>", "reason");
  cmd.option("--stage-worker-log", "stage log");
  cmd.parse(["--reason", "need path", "--stage-worker-log"], { from: "user" });
  const opts = cmd.opts() as { stageWorkerLog?: boolean; reason: string };
  assert.equal(opts.stageWorkerLog, true);
  assert.equal(opts.reason, "need path");
});
