import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contractSha256 } from "#missions/contract/contract-hash.js";
import { getRepoRoot, gitRevParse } from "#git/git.js";
import { GXT_ERROR } from "#core/error-codes.js";
import { loadManifest } from "#missions/manifest.js";
import { parseMissionFile } from "#missions/mission/parser.js";
import { REL_PLANNER_ALLOWLIST } from "#missions/planner-identity.js";
import type { MissionContract } from "#core/contract-types.js";
import { evaluateContractPhase } from "#missions/mission-verify/contract.js";
import { copyMissionSchema, gitCommit, gitInitCommit, writeManifest, type MiniManifestSkill } from "./test-fixtures.js";

const PLANNER = "planner@example.com";
const EXECUTOR = "executor@example.com";
const SKILLS: Record<string, MiniManifestSkill> = {
  ui: { trust_threshold: "Tier-1", tmvc_roots: ["src/"], forbidden_zones: ["src/db/"] },
  db: { trust_threshold: "Tier-1", tmvc_roots: ["src/db/"], forbidden_zones: [] },
  rootless: { trust_threshold: "Tier-1", tmvc_roots: [], forbidden_zones: ["vendor/"] },
};

const missionRel = (msn: string): string => `.gitagent/missions/${msn}.yaml`;

function missionYaml(msn: string, skill: string, contract: MissionContract | null): string {
  const head = `msn_id: ${msn}\nskill_key: ${skill}\ngate_command: echo OK\ngate_success_substring: OK\ntrace_rows: []\n`;
  if (!contract) return head;
  const lines = Object.entries(contract).map(([k, v]) => `  ${k}:\n${(v as string[]).map((x) => `    - ${x}`).join("\n")}`);
  return `${head}contract:\n${lines.join("\n")}\ncontract_sha256: "${contractSha256(contract)}"\n`;
}

function write(dest: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.writeFileSync(path.join(dest, rel), body, "utf8");
  }
}

/** A repo whose first commit is the Planner stamp of `msn`. */
function scaffold(msn: string, skill: string, contract: MissionContract | null): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-changed-paths-"));
  copyMissionSchema(path.join(getRepoRoot(), ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, SKILLS);
  write(dest, { [REL_PLANNER_ALLOWLIST]: `${PLANNER}\n`, [missionRel(msn)]: missionYaml(msn, skill, contract) });
  gitInitCommit(dest, `[${msn}] Legislate`, PLANNER);
  return dest;
}

/** An executor commit (not a Planner stamp). */
function work(dest: string, msn: string, files: Record<string, string>): string {
  write(dest, files);
  gitCommit(dest, `[${msn}] Work`, EXECUTOR);
  return gitRevParse(dest, "HEAD")!;
}

function runPhase(dest: string, msn: string, options: { record?: boolean } = {}) {
  return evaluateContractPhase({
    root: dest,
    manifest: loadManifest(dest),
    mission: parseMissionFile(dest, missionRel(msn)),
    options,
    executorLogPath: path.join(dest, "EXECUTOR_LOG.md"),
    proofMsnId: msn,
    missionRel: missionRel(msn),
  });
}

const recordJson = (msn: string, head: string): string => `${JSON.stringify({ msn_id: msn, head })}\n`;

test("verify changed paths: a skill forbidden zone touched after the stamp fails GXT_FORBIDDEN_ZONE per path", () => {
  const dest = scaffold("MSN-0961", "ui", null);
  work(dest, "MSN-0961", { "src/ui/a.ts": "a\n", "src/db/x.ts": "x\n", "src/db/y.ts": "y\n" });
  const r = runPhase(dest, "MSN-0961");
  assert.equal(r.kind, "fail");
  if (r.kind !== "fail") return;
  assert.equal(r.failure.code, GXT_ERROR.FORBIDDEN_ZONE);
  assert.equal(r.failure.exitCode, 1);
  assert.deepEqual(r.failure.findings?.map((f) => [f.failed_gate, f.offending_file, f.rule_id]), [
    ["contract", "src/db/x.ts", GXT_ERROR.FORBIDDEN_ZONE],
    ["contract", "src/db/y.ts", GXT_ERROR.FORBIDDEN_ZONE],
  ]);
  assert.match(r.failure.findings?.[0]?.resolution_hint ?? "", /forbidden zone src\/db\//);
});

test("verify changed paths: a path outside the roots warns; .gitagent/ and EXECUTOR_LOG.md do not", () => {
  const dest = scaffold("MSN-0962", "ui", { tmvc_roots: ["src/ui/"] });
  work(dest, "MSN-0962", { "src/ui/a.ts": "a\n", "docs/x.md": "x\n", ".gitagent/notes.md": "n\n", "EXECUTOR_LOG.md": "log\n" });
  assert.deepEqual(runPhase(dest, "MSN-0962"), {
    kind: "ok",
    skipped: false,
    warnings: ["path outside the mission's TMVC roots changed since the Planner stamp: docs/x.md"],
  });
});

test("verify changed paths: a forbidden zone under .gitagent/ fails; the mission file, its run record and the log are exempt", () => {
  const contract = { tmvc_roots: ["src/ui/"], forbidden_zones: [".gitagent/", "EXECUTOR_LOG.md"] };
  const dest = scaffold("MSN-0963", "ui", contract);
  work(dest, "MSN-0963", {
    [missionRel("MSN-0963")]: `${missionYaml("MSN-0963", "ui", contract)}# executor note\n`,
    ".gitagent/runs/MSN-0963.json": "{}\n",
    "EXECUTOR_LOG.md": "log\n",
  });
  assert.deepEqual(runPhase(dest, "MSN-0963"), { kind: "ok", skipped: false });
  work(dest, "MSN-0963", { ".gitagent/foreman/x.yaml": "x\n" });
  const r = runPhase(dest, "MSN-0963");
  assert.equal(r.kind, "fail");
  if (r.kind === "fail") assert.deepEqual(r.failure.findings?.map((f) => f.offending_file), [".gitagent/foreman/x.yaml"]);
});

test("verify changed paths: a rootless skill does not warn outside roots but keeps its forbidden zones", () => {
  const dest = scaffold("MSN-0964", "rootless", null);
  work(dest, "MSN-0964", { "docs/x.md": "x\n" });
  assert.deepEqual(runPhase(dest, "MSN-0964"), { kind: "ok", skipped: true });
  work(dest, "MSN-0964", { "vendor/lib.js": "v\n" });
  const r = runPhase(dest, "MSN-0964");
  assert.equal(r.kind, "fail");
  if (r.kind === "fail") assert.equal(r.failure.code, GXT_ERROR.FORBIDDEN_ZONE);
});

test("verify changed paths: a run record whose head precedes later commits bounds the window; --record judges HEAD", () => {
  const dest = scaffold("MSN-0965", "ui", null);
  const head = work(dest, "MSN-0965", { "src/ui/a.ts": "a\n" });
  work(dest, "MSN-0965", { ".gitagent/runs/MSN-0965.json": recordJson("MSN-0965", head) });
  work(dest, "later", { "src/db/x.ts": "x\n" });
  assert.deepEqual(runPhase(dest, "MSN-0965"), { kind: "ok", skipped: true });
  const r = runPhase(dest, "MSN-0965", { record: true });
  assert.equal(r.kind, "fail");
  if (r.kind === "fail") assert.equal(r.failure.findings?.[0]?.offending_file, "src/db/x.ts");
});

test("verify changed paths: two missions on one branch; the second's work stays out of the first's judgement", () => {
  const dest = scaffold("MSN-0966", "ui", null);
  const head = work(dest, "MSN-0966", { "src/ui/a.ts": "a\n" });
  work(dest, "MSN-0966", { ".gitagent/runs/MSN-0966.json": recordJson("MSN-0966", head) });
  write(dest, { [missionRel("MSN-0967")]: missionYaml("MSN-0967", "db", null) });
  gitCommit(dest, "[MSN-0967] Legislate", PLANNER);
  work(dest, "MSN-0967", { "src/db/schema.ts": "s\n" });
  assert.deepEqual(runPhase(dest, "MSN-0966"), { kind: "ok", skipped: true });
  assert.deepEqual(runPhase(dest, "MSN-0967"), { kind: "ok", skipped: true });
});

test("verify changed paths: a run record head missing from history fails closed with the shallow-history hint", () => {
  const dest = scaffold("MSN-0968", "ui", null);
  work(dest, "MSN-0968", { ".gitagent/runs/MSN-0968.json": recordJson("MSN-0968", "0".repeat(40)) });
  const r = runPhase(dest, "MSN-0968");
  assert.equal(r.kind, "fail");
  if (r.kind !== "fail") return;
  assert.equal(r.failure.code, GXT_ERROR.FORBIDDEN_ZONE);
  assert.match(r.failure.message, /fetch-depth: 0/);
});
