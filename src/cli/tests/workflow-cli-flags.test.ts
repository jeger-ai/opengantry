import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import {
  mapInterrogateCommanderOptions,
  mapLegislateCommanderOptions,
  verifyOptionsFromCli,
  type InterrogateCommanderOptions,
} from "../program-workflow.js";

test("commander maps interrogate --path and --answers to path/answers keys", () => {
  const cmd = new Command("interrogate");
  cmd.option("--path <paths...>", "Declared paths");
  cmd.option("--answers <file>", "Answers file");
  cmd.option("--msn <id>", "MSN");
  cmd.parse(
    ["node", "test", "fix cli", "--path", "src/a.ts", "src/b.ts", "--answers", "/tmp/ans.json", "--msn", "MSN-0100"],
    { from: "user" },
  );
  const opts = cmd.opts() as InterrogateCommanderOptions;
  assert.deepEqual(opts.path, ["src/a.ts", "src/b.ts"]);
  assert.equal(opts.answers, "/tmp/ans.json");
  assert.equal(opts.msn, "MSN-0100");

  const mapped = mapInterrogateCommanderOptions(opts, "fix cli");
  assert.deepEqual(mapped.paths, ["src/a.ts", "src/b.ts"]);
  assert.equal(mapped.answersFile, "/tmp/ans.json");
  assert.equal(mapped.intent, "fix cli");
});

test("commander maps legislate --path to path key and mapLegislateCommanderOptions forwards paths", () => {
  const cmd = new Command("legislate");
  cmd.option("--path <paths...>", "Declared paths");
  cmd.requiredOption("--msn <id>", "MSN");
  cmd.parse(["node", "test", "ship gate", "--msn", "MSN-0101", "--path", "src/cli/foo.ts"], { from: "user" });
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
  const prev = process.env.GXT_REQUIRE_INTERROGATION;
  delete process.env.GXT_REQUIRE_INTERROGATION;
  try {
    const opts = verifyOptionsFromCli({});
    assert.equal(opts.requireInterrogation, false);
    const explicitOff = verifyOptionsFromCli({ requireInterrogation: false, ci: false });
    assert.equal(explicitOff.requireInterrogation, false);
    const ciOn = verifyOptionsFromCli({ ci: true });
    assert.equal(ciOn.requireInterrogation, true);
  } finally {
    if (prev === undefined) delete process.env.GXT_REQUIRE_INTERROGATION;
    else process.env.GXT_REQUIRE_INTERROGATION = prev;
  }
});

test("context-request commander maps --stage-worker-log to stageWorkerLog", () => {
  const cmd = new Command("context-request");
  cmd.requiredOption("--reason <text>", "reason");
  cmd.option("--stage-worker-log", "stage log");
  cmd.parse(["node", "test", "--reason", "need path", "--stage-worker-log"], { from: "user" });
  const opts = cmd.opts() as { stageWorkerLog?: boolean; reason: string };
  assert.equal(opts.stageWorkerLog, true);
  assert.equal(opts.reason, "need path");
});
