/** `gantry admission capabilities` (MSN-0384): hidden, read-only, prints the full capability matrix. */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import { admissionCapabilityReport } from "#core/admission-capabilities.js";

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

function gantry(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: getRepoRoot(), encoding: "utf8", env: gitChildEnv() });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("admission capabilities --json prints the core report: 105 cells, none prevention", () => {
  const r = gantry(["admission", "capabilities", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout) as { schema: string; rows: { level: string }[] };
  assert.deepEqual(report, admissionCapabilityReport());
  assert.equal(report.schema, "opengantry.admission-capabilities.v1");
  assert.equal(report.rows.length, 105);
  assert.ok(report.rows.every((row) => row.level !== "prevention"));
});

test("admission capabilities prints a summary line and one line per cell; the group is hidden from help", () => {
  const r = gantry(["admission", "capabilities"]);
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout + r.stderr;
  assert.match(out, /gantry admission capabilities: 105 cells \(prevention 0, /);
  assert.match(out, /ubuntu-26\.04-x64\/claude-code\/network\.connect: unsupported/);
  assert.doesNotMatch(gantry(["--help"]).stdout, /admission/);
});
