import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

/**
 * MSN-0263: this repository's own CI workflows install the iii integration example's dependencies before verifying
 * missions, and run every iii example step only when the example exists. The shipped adopter templates under
 * templates/.github/workflows/ are no longer mirrors and carry no iii step (ci-template-adopter.test.ts, 4.0.1).
 */

// Compiled to dist/cli/tests/, the repo root is three levels up. Import-free of src/cli/lib on purpose.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const GUARD = "hashFiles('examples/iii-integration/package-lock.json') != ''";
const INSTALL = "npm ci --prefix examples/iii-integration --no-audit --no-fund";
const WORKFLOWS = ["gxt-validate.yml", "gxt-attest-ingest.yml"] as const;

interface Step {
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
}

function workflow(file: string): string {
  return path.join(REPO_ROOT, ".github", "workflows", file);
}

function jobs(file: string): Record<string, { steps: Step[] }> {
  return (YAML.parse(fs.readFileSync(file, "utf8")) as { jobs: Record<string, { steps: Step[] }> }).jobs;
}

function touchesExample(step: Step): boolean {
  return /examples\/iii-integration|iii integration/i.test(`${step.name ?? ""}\n${step.run ?? ""}`);
}

test("ci iii example: every step that touches examples/iii-integration runs only when the example exists (MSN-0263 DoD 1, DoD 3)", () => {
  let guarded = 0;
  for (const file of WORKFLOWS) {
    for (const [job, def] of Object.entries(jobs(workflow(file)))) {
      for (const step of def.steps.filter(touchesExample)) {
        assert.ok(step.if?.includes(GUARD), `${file} ${job} "${step.name ?? step.run}" carries the hashFiles guard`);
        guarded += 1;
      }
    }
  }
  assert.equal(guarded, 3, "manifest offline validate, mission_verify install, attest_ingest install");
});

test("ci iii example: mission_verify installs the example's deps before the full verify (MSN-0263 DoD 1, DoD 3)", () => {
  const steps = jobs(workflow("gxt-validate.yml")).mission_verify!.steps;
  const install = steps.findIndex((s) => s.name === "Install iii integration example deps");
  const verify = steps.findIndex((s) => s.name === "Full verify on PR-changed missions");
  assert.ok(install >= 0 && verify > install, "install runs before the full verify");
  assert.equal(steps[install]!.run, INSTALL);
  assert.equal(steps[install]!.if, GUARD);
});

test("ci iii example: attest_ingest installs the example's deps before verify and export (MSN-0263 DoD 1, DoD 3)", () => {
  const all = jobs(workflow("gxt-attest-ingest.yml"));
  const job = Object.values(all).find((j) => j.steps.some((s) => s.name === "Verify and export envelope"))!;
  const install = job.steps.findIndex((s) => s.name === "Install iii integration example deps");
  const verify = job.steps.findIndex((s) => s.name === "Verify and export envelope");
  assert.ok(install >= 0 && verify > install, "install runs before verify and export");
  assert.equal(job.steps[install]!.run, INSTALL);
  assert.equal(job.steps[install]!.if, `steps.mission.outputs.path != '' && ${GUARD}`);
});
