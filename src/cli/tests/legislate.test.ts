import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { runLegislate } from "../commands/legislate.js";
import { getRepoRoot } from "../lib/git.js";
import { execSync } from "node:child_process";
test("legislate: writes next YAML mission under .gitagent/missions/", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-leg-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "prior.yaml"),
    `msn_id: MSN-0988
skill_key: ui-ralph
gate_command: "echo OK"
gate_success_substring: "OK"
trace_rows: []
`,
    "utf8",
  );
  execSync("git init", { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    runLegislate({
      intent: "Add button hover state ui-ralph",
      msn: "MSN-0989",
      skillKey: "ui-ralph",
    });
    assert.equal(process.exitCode, undefined);
    const files = fs.readdirSync(path.join(dest, ".gitagent", "missions"));
    assert.ok(files.some((f) => f.startsWith("MSN-0989.") && f.endsWith(".yaml")));
    const created = fs
      .readdirSync(path.join(dest, ".gitagent", "missions"))
      .find((f) => f.startsWith("MSN-0989.") && f.endsWith(".yaml"))!;
    const body = fs.readFileSync(path.join(dest, ".gitagent", "missions", created), "utf8");
    assert.ok(body.includes("msn_id: MSN-0989") || body.includes("MSN-0989"));
    assert.ok(body.includes("skill_key: ui-ralph"));
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});


test("legislate: triage escalation exits 2 without --skill-key", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-leg-ex-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  execSync("git init", { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    runLegislate({ intent: "refactor all security-critical paths everywhere", msn: "MSN-4444" });
    assert.equal(process.exitCode, 2);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});


test("legislate: rejects missing msn", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-leg-no-msn-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  execSync("git init", { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    runLegislate({ intent: "ui-ralph adjust spacing", skillKey: "ui-ralph" });
    assert.equal(process.exitCode, 2);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});


test("legislate: rejects malformed msn", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-leg-bad-msn-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  execSync("git init", { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    runLegislate({
      intent: "ui-ralph adjust spacing",
      msn: "msn-0043",
      skillKey: "ui-ralph",
    });
    assert.equal(process.exitCode, 2);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});


test("legislate: duplicate msn fails closed by default", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-leg-dupe-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  const missionsDir = path.join(dest, ".gitagent", "missions");
  fs.mkdirSync(missionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(missionsDir, "existing.yaml"),
    "msn_id: MSN-0999\nskill_key: ui-ralph\ngate_command: echo OK\ngate_success_substring: OK\ntrace_rows: []\n",
    "utf8",
  );
  execSync("git init", { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    runLegislate({
      intent: "ui-ralph adjust spacing",
      msn: "MSN-0999",
      skillKey: "ui-ralph",
    });
    assert.equal(process.exitCode, 2);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});


test("legislate: --allow-duplicate permits duplicate msn", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-leg-dupe-allow-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  const missionsDir = path.join(dest, ".gitagent", "missions");
  fs.mkdirSync(missionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(missionsDir, "existing.yaml"),
    "msn_id: MSN-0999\nskill_key: ui-ralph\ngate_command: echo OK\ngate_success_substring: OK\ntrace_rows: []\n",
    "utf8",
  );
  execSync("git init", { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    runLegislate({
      intent: "ui-ralph add hover state",
      msn: "MSN-0999",
      skillKey: "ui-ralph",
      allowDuplicate: true,
    });
    assert.equal(process.exitCode, undefined);
    const files = fs.readdirSync(missionsDir);
    assert.ok(files.some((f) => f !== "existing.yaml" && f.startsWith("MSN-0999.") && f.endsWith(".yaml")));
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});

