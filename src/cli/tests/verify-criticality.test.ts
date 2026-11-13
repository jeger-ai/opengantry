// MSN-0375: the criticality verdict next to the verify result (ADR-0051 decisions 13-16).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gitChildEnv } from "#git/git.js";
import { COMMITLY_GATE_SCHEMA, parseVerifyContract, parseVerifyYaml } from "#verify/contract.js";
import { parseCriticality } from "#verify/criticality.js";
import { runVerifyContract } from "#verify/run.js";

function git(dest: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dest, "-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: gitChildEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(dest: string, rel: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
  fs.writeFileSync(path.join(dest, rel), body);
}

function commit(dest: string): string {
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "--allow-empty", "-m", "c");
  return git(dest, "rev-parse", "HEAD");
}

const CLASSES = [
  "criticality:",
  "  default_level: medium",
  "  classes:",
  "    - { name: auth, paths: [app/auth], never_auto: true }",
  "    - { name: docs, paths: [docs], level: low }",
];

/** A base with a contract outside the repository (read from disk), then `files` committed on top. */
function run(contractLines: string[], files: Record<string, string>, opts: { recordDir?: string } = {}) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-crit-"));
  git(dest, "init", "-q", "-b", "main");
  write(dest, "README.md", "x\n");
  const base = commit(dest);
  for (const [rel, body] of Object.entries(files)) write(dest, rel, body);
  commit(dest);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-crit-contract-"));
  write(outside, "verify.yaml", ["schema: opengantry.verify.v1", `base: ${base}`, ...contractLines, ""].join("\n"));
  return runVerifyContract({ cwd: dest, contract: path.join(outside, "verify.yaml"), recordDir: opts.recordDir });
}

/** A classifier script that answers `body` (or exits/sleeps), returning the run command. */
function classifier(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-crit-cls-"));
  const file = path.join(dir, "classify.sh");
  fs.writeFileSync(file, `#!/bin/sh\ncat > "${dir}/input.json"\n${body}\n`, { mode: 0o755 });
  return file;
}

test("criticality: no section is unknown; path classes decide; a never_auto class is critical; files in no class take default_level (MSN-0375)", () => {
  assert.deepEqual(run([], { "app/a.py": "a\n" }).criticality, { level: "unknown", source: "none", paths_level: null, classes: [], unclassified: [], classifier: null });
  const docs = run(CLASSES, { "docs/a.md": "a\n" }).criticality;
  assert.equal(docs.level, "low");
  assert.equal(docs.source, "paths");
  assert.deepEqual(docs.classes, [{ name: "docs", level: "low", never_auto: false, files: ["docs/a.md"] }]);
  const mixed = run(CLASSES, { "docs/a.md": "a\n", "app/x.py": "x\n" }).criticality;
  assert.equal(mixed.level, "medium");
  assert.deepEqual(mixed.unclassified, ["app/x.py"]);
  const auth = run(CLASSES, { "docs/a.md": "a\n", "app/auth/login.py": "x\n" }).criticality;
  assert.equal(auth.level, "critical");
  assert.equal(auth.classes.find((c) => c.name === "auth")?.never_auto, true);
  // The verdict never fails the run by itself.
  assert.equal(run(CLASSES, { "app/auth/login.py": "x\n" }).status, "pass");
});

test("criticality: the classifier decides below never_auto, gets the diff on stdin, and any failure is unknown (MSN-0375)", () => {
  const ok = classifier(`echo '{"level":"low","confidence":0.9,"rationale":"typo fix"}'`);
  const said = run([...CLASSES, "  classifier:", `    run: ${ok}`], { "app/x.py": "print(1)\n" }).criticality;
  assert.equal(said.level, "low");
  assert.equal(said.source, "classifier");
  assert.equal(said.paths_level, "medium");
  assert.deepEqual(said.classifier, { level: "low", confidence: 0.9, rationale: "typo fix", error: null });
  const input = JSON.parse(fs.readFileSync(path.join(path.dirname(ok), "input.json"), "utf8")) as { schema: string; changed: string[]; diff: string; paths_level: string };
  assert.equal(input.schema, "opengantry.criticality-input.v1");
  assert.deepEqual(input.changed, ["app/x.py"]);
  assert.match(input.diff, /\+print\(1\)/);
  assert.equal(input.paths_level, "medium");

  const neverAsked = classifier(`echo '{"level":"low"}'`);
  const auth = run([...CLASSES, "  classifier:", `    run: ${neverAsked}`], { "app/auth/x.py": "x\n" }).criticality;
  assert.equal(auth.level, "critical");
  assert.equal(auth.classifier, null);
  assert.equal(fs.existsSync(path.join(path.dirname(neverAsked), "input.json")), false);

  for (const [body, error] of [
    ["exit 3", /exit 3/],
    ["echo not json", /not JSON/],
    [`echo '{"level":"none"}'`, /level must be one of/],
    ["sleep 5", /timed out after 1s/],
  ] as const) {
    const v = run([...CLASSES, "  classifier:", `    run: ${classifier(body)}`, "    timeout_seconds: 1"], { "app/x.py": "x\n" }).criticality;
    assert.equal(v.level, "unknown", body);
    assert.match(v.classifier?.error ?? "", error, body);
  }
});

test("criticality: --criticality-record writes the classifier's input and the verdict, one file per run (MSN-0375)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-crit-rec-"));
  run([...CLASSES, "  classifier:", `    run: ${classifier(`echo '{"level":"high"}'`)}`], { "app/x.py": "x\n" }, { recordDir: dir });
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, files[0]!), "utf8")) as { schema: string; input: { diff: string }; verdict: { level: string } };
  assert.equal(rec.schema, "opengantry.criticality-record.v1");
  assert.match(rec.input.diff, /app\/x\.py/);
  assert.equal(rec.verdict.level, "high");
});

test("criticality: the section is strict, reads the same in the JSON gate contract, and repository law joins classes tighten-only (MSN-0375)", () => {
  for (const [raw, pattern] of [
    [{ extra: 1 }, /unknown key "extra"/],
    [{ classes: [{ name: "a", paths: [] }] }, /paths must list at least one path/],
    [{ classes: [{ name: "a", paths: ["x"], level: "urgent" }] }, /level must be one of/],
    [{ classes: [{ name: "a", paths: ["x"] }, { name: "a", paths: ["y"] }] }, /duplicate name/],
    [{ classifier: { run: "x", timeout_seconds: 0 } }, /timeout_seconds must be a positive integer/],
  ] as const) {
    assert.throws(() => parseCriticality(raw), (e: Error & { code?: string }) => e.code === "GXT_VERIFY_CONTRACT_INVALID" && pattern.test(e.message));
  }
  const gate = parseVerifyContract(JSON.stringify({ schema: COMMITLY_GATE_SCHEMA, allowed_paths: ["."], forbidden_paths: [], checks: [], criticality: { classes: [{ name: "db", paths: ["migrations"], never_auto: true }] } }), "gate.json");
  assert.deepEqual(gate.criticality, { classes: [{ name: "db", paths: ["migrations"], level: "critical", neverAuto: true }], defaultLevel: "high", classifier: null });

  // A task contract (gate.json outside the repository) inherits the base verify.yaml's classes.
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-crit-law-"));
  git(dest, "init", "-q", "-b", "main");
  write(dest, "verify.yaml", ["schema: opengantry.verify.v1", ...CLASSES, ""].join("\n"));
  const base = commit(dest);
  write(dest, "app/auth/x.py", "x\n");
  commit(dest);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-crit-task-"));
  write(outside, "gate.json", JSON.stringify({ schema: COMMITLY_GATE_SCHEMA, base, allowed_paths: ["."], forbidden_paths: [], checks: [], criticality: { classes: [{ name: "auth", paths: ["lib/auth"], level: "low" }] } }));
  const r = runVerifyContract({ cwd: dest, contract: path.join(outside, "gate.json") });
  assert.equal(r.criticality.level, "critical");
  assert.equal(parseVerifyYaml(["schema: opengantry.verify.v1", ...CLASSES, ""].join("\n")).criticality?.defaultLevel, "medium");
});
