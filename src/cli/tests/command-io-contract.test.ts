import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { captureConsole } from "./test-shared.js";
import { getRepoRoot } from "#git/git.js";
import { copyMissionSchema } from "./test-fixtures.js";
import { runCheck } from "../commands/check.js";

function scaffoldMiniRepo(): string {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-cmd-io-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config user.email "test@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dest, stdio: "pipe" });
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, "skills"), { recursive: true });
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  fs.writeFileSync(
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify(
      {
        schema_version: "0.5.0",
        skills: {
          gantry: {
            desc: "test",
            trust_threshold: "Tier-2",
            tmvc_roots: ["src/cli/"],
            forbidden_zones: [],
          },
        },
        path_risks: { "src/cli/": "Tier-2" },
        risk_keywords: [],
        perimeter_protected: [],
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(path.join(dest, "skills", "gantry.md"), "# gantry\n", "utf8");
  fs.mkdirSync(path.join(dest, "src", "cli", "lib"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "cli", "lib", "sample.ts"), "export const ok = 1;\n", "utf8");
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dest, stdio: "pipe" });
  return dest;
}

test("command I/O contract: gantry check happy path", () => {
  const dest = scaffoldMiniRepo();
  const prev = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    const { output } = captureConsole(() => runCheck());
    assert.equal(process.exitCode, undefined);
    assert.match(output.stdout, /MANIFEST OK/);
  } finally {
    process.chdir(prev);
    process.exitCode = undefined;
  }
});

