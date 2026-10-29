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

  const missionRel = ".gitagent/missions/fix-layer.yaml";
  const traceQuote = "import layer fix evidence";
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

test("runVerify: --fix --non-interactive leaves source files unchanged and prints fix hints", async () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-fix-"));
  const missionRel = writeImportLayerFixtureRepo(dest, ogRoot, {
    gateCommand: `node ${cli} arch check --json src/cli/flows/bad.ts`,
    gateSubstring: '"ok": true',
  });
  gitInitCommit(dest, "[MSN-0998] legislate import-layer fix mission", PLANNER_EMAIL);

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

      assert.equal(fs.readFileSync(badPath, "utf8"), before);
      assert.equal(process.exitCode, 1);
      assert.match(combined, /GXT_IMPORT_LAYER_VIOLATION/);
      assert.match(combined, /^Fix: /m);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});
