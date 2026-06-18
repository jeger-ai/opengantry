import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runAuditRigorChecks } from "../lib/audit-rigor.js";
import { getRepoRoot } from "../lib/git.js";

test("audit-rigor: strict tsconfig passes in isolated sandbox", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ar-strict-"));
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true } }),
    "utf8",
  );
  fs.mkdirSync(path.join(root, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify({
      schema_version: "0.5.0",
      skills: {
        ui: { tmvc_roots: ["src/ui/"], forbidden_zones: [".gitagent/foreman/"] },
      },
    }),
    "utf8",
  );
  fs.mkdirSync(path.join(root, "coverage"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "coverage/coverage-summary.json"),
    JSON.stringify({ total: { lines: { pct: 80 } } }),
    "utf8",
  );

  const report = runAuditRigorChecks(root);
  assert.equal(report.exit_code, 0);
  assert.ok(report.lines.some((l) => l.check_id === "typescript_strict" && l.level === "ok"));
  assert.ok(report.lines.some((l) => l.check_id === "coverage_threshold" && l.level === "ok"));
});

test("audit-rigor: degraded sandbox fails strict mode without host repo leakage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ar-loose-"));
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: false } }),
    "utf8",
  );
  fs.mkdirSync(path.join(root, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify({
      schema_version: "0.5.0",
      skills: {
        bad: { tmvc_roots: ["**"], forbidden_zones: ["*"] },
      },
    }),
    "utf8",
  );

  const report = runAuditRigorChecks(root, { strict: true });
  assert.equal(report.exit_code, 1);
  assert.ok(report.lines.some((l) => l.check_id === "typescript_strict" && l.level === "fail"));
  assert.ok(report.lines.some((l) => l.check_id === "wildcard_paths" && l.level === "fail"));
  assert.ok(report.lines.some((l) => l.check_id === "coverage_threshold"));
});

test("audit-rigor: scanner uses provided workspaceRoot not ambient cwd", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "og-ar-root-"));
  fs.writeFileSync(
    path.join(sandbox, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true } }),
    "utf8",
  );
  fs.mkdirSync(path.join(sandbox, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(
    path.join(sandbox, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify({ schema_version: "0.5.0", skills: {} }),
    "utf8",
  );

  const host = getRepoRoot();
  const hostReport = runAuditRigorChecks(host);
  const sandboxReport = runAuditRigorChecks(sandbox, { strict: true });
  assert.notEqual(hostReport.workspace_root, sandboxReport.workspace_root);
  assert.equal(sandboxReport.workspace_root, sandbox);
  assert.ok(
    sandboxReport.lines.some((l) => l.check_id === "coverage_threshold" && l.level === "fail"),
  );
});
