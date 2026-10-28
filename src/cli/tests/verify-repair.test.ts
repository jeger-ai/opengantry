import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "#git/git.js";
import { runVerify } from "../commands/verify.js";
import {
  copyMissionSchema,
  gitInitCommit,
  writeManifest,
  writeSkillsForManifest,
} from "./test-fixtures.js";
import { captureConsoleAsync, PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";

function writeImportLayerFixtureRepo(
  dest: string,
  ogRoot: string,
  options: { gateCommand: string; gateSubstring: string },
): string {
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    ui: { trust_threshold: "Tier-1", tmvc_roots: [], forbidden_zones: [] },
  });
  writeSkillsForManifest(dest, ["ui"]);

  const libDir = path.join(dest, "src", "cli", "flows");
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(
    path.join(libDir, "bad.ts"),
    `import { runVerify } from "../commands/verify.js";\nexport const x = runVerify;\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(dest, "TARGET_ARCHITECTURE.yaml"),
    `schema_version: "0.4.0"
scan_roots: [src/cli/**]
layers:
  - id: command
    globs: [src/cli/commands/**]
  - id: lib
    globs: [src/cli/flows/**]
rules:
  - id: RULE-LIB-TO-COMMAND
    from_layer: lib
    forbid_import_layer: command
`,
    "utf8",
  );

  const missionRel = ".gitagent/missions/repair-layer.yaml";
  const traceQuote = "import layer repair quarantine evidence";
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, missionRel),
    `msn_id: MSN-0998
skill_key: ui
gate_command: ${options.gateCommand}
gate_success_substring: '${options.gateSubstring}'
trace_rows:
  - dod_id: "1"
    trace_quote: "${traceQuote}"
    anchor: "1"
    status: PASS
`,
    "utf8",
  );
  fs.writeFileSync(path.join(dest, "EXECUTOR_LOG.md"), `${traceQuote}\n`, "utf8");
  return missionRel;
}

test("runVerify: --fix quarantines import-layer violation from JSON gate", async () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-repair-layer-"));
  const missionRel = writeImportLayerFixtureRepo(dest, ogRoot, {
    gateCommand: `node ${cli} arch check --json src/cli/flows/bad.ts`,
    gateSubstring: '"ok": true',
  });
  gitInitCommit(dest, "[MSN-0998] legislate import-layer repair mission", PLANNER_EMAIL);

  const badPath = path.join(dest, "src/cli/flows/bad.ts");
  const before = fs.readFileSync(badPath, "utf8");
  const prevCwd = process.cwd();

  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: missionRel,
          executorLog: "EXECUTOR_LOG.md",
          fix: true,
          fixNonInteractive: true,
        });
      });
      const combined = output.stdout + output.stderr;
      const after = fs.readFileSync(badPath, "utf8");
      const executorLog = fs.readFileSync(path.join(dest, "EXECUTOR_LOG.md"), "utf8");

      assert.notEqual(after, before);
      assert.match(after, /GXT-SURGEON-QUARANTINE-START \[RULE-IMPORT-LAYER\]/);
      assert.match(executorLog, /\[SURGEON-MUTATION\] import-layer quarantined: src\/cli\/flows\/bad\.ts/);
      assert.match(combined, /\[Repair\] mutation logged; re-evaluating verify phases \(fix disabled\)/);
      assert.equal(process.exitCode ?? 0, 0);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: without --fix does not quarantine an import-layer violation", async () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-repair-plain-"));
  const missionRel = writeImportLayerFixtureRepo(dest, ogRoot, {
    gateCommand: `node ${cli} arch check --json src/cli/flows/bad.ts`,
    gateSubstring: '"ok": true',
  });
  gitInitCommit(dest, "[MSN-0998] legislate import-layer repair mission", PLANNER_EMAIL);

  const badPath = path.join(dest, "src/cli/flows/bad.ts");
  const before = fs.readFileSync(badPath, "utf8");
  const prevCwd = process.cwd();

  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({ mission: missionRel, executorLog: "EXECUTOR_LOG.md" });
      });
      const combined = output.stdout + output.stderr;
      const executorLog = fs.readFileSync(path.join(dest, "EXECUTOR_LOG.md"), "utf8");

      assert.equal(fs.readFileSync(badPath, "utf8"), before);
      assert.doesNotMatch(executorLog, /\[SURGEON-MUTATION\]/);
      assert.equal(process.exitCode, 1);
      assert.match(combined, /GXT_IMPORT_LAYER_VIOLATION/);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --fix writes only one SURGEON-MUTATION line on successful rerun", async () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-repair-once-"));
  const missionRel = writeImportLayerFixtureRepo(dest, ogRoot, {
    gateCommand: `node ${cli} arch check --json src/cli/flows/bad.ts`,
    gateSubstring: '"ok": true',
  });
  gitInitCommit(dest, "[MSN-0998] legislate import-layer repair mission", PLANNER_EMAIL);

  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await captureConsoleAsync(async () => {
        await runVerify({
          mission: missionRel,
          executorLog: "EXECUTOR_LOG.md",
          fix: true,
          fixNonInteractive: true,
        });
      });
      const executorLog = fs.readFileSync(path.join(dest, "EXECUTOR_LOG.md"), "utf8");
      assert.equal(executorLog.match(/\[SURGEON-MUTATION\]/g)?.length ?? 0, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});
