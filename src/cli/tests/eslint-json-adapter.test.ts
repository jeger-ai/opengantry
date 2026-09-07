import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  EslintJsonAdapter,
  eslintFindingsFromRun,
  parseEslintJsonOutput,
} from "../lib/gate-adapters/eslint-json-adapter.js";
import type { GateExecContext } from "../lib/gate-adapters/gate-adapter-types.js";

function ctxIn(dir: string, successSubstring: string | null = null): GateExecContext {
  return {
    msn_id: "MSN-TEST",
    gate_log_path: path.join(dir, "gate.log"),
    cwd: dir,
    repo_root: dir,
    successSubstring,
  };
}

function eslintResults(dir: string): string {
  return JSON.stringify([
    {
      filePath: path.join(dir, "src", "b.ts"),
      messages: [
        { ruleId: "no-unused-vars", severity: 2, message: "'y' is defined but never used.", line: 2, column: 7, endLine: 2, endColumn: 8 },
      ],
    },
    {
      filePath: path.join(dir, "src", "a.ts"),
      messages: [
        { ruleId: "eqeqeq", severity: 1, message: "Expected '===' and instead saw '=='.", line: 3, column: 5, endLine: 3, endColumn: 7 },
        { ruleId: null, fatal: true, severity: 2, message: "Parsing error: Unexpected token", line: 1, column: 1 },
      ],
    },
  ]);
}

describe("parseEslintJsonOutput", () => {
  it("maps messages and tolerates a leading npm banner", () => {
    const parsed = parseEslintJsonOutput(`\n> demo@1.0.0 lint\n> eslint --format json src\n\n${eslintResults("/repo")}\n`);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.diagnostics.length, 3);
    const fatal = parsed.diagnostics.find((d) => d.ruleId === "eslint/parse");
    assert.ok(fatal);
    assert.equal(fatal.severity, "error");
    const warn = parsed.diagnostics.find((d) => d.ruleId === "eqeqeq");
    assert.equal(warn?.severity, "warning");
    assert.equal(warn?.endColumn, 7);
  });

  it("rejects non-JSON stdout", () => {
    const parsed = parseEslintJsonOutput("src/a.ts\n  3:5  error  Expected ===  eqeqeq\n");
    assert.equal(parsed.ok, false);
  });
});

describe("eslintFindingsFromRun", () => {
  it("exit 0 with substring match yields no findings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-eslint-ok-"));
    const findings = eslintFindingsFromRun(ctxIn(dir), {
      exitCode: 0,
      successSubstringMatched: true,
      stdout: "[]",
      stdoutTruncated: false,
    });
    assert.deepEqual(findings, []);
  });

  it("produces sorted v3 findings with repo-relative paths, rule ids, and evidence", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-eslint-map-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "const x = 1;\nconst y = 2;\nif (x == y) {}\n");
    fs.writeFileSync(path.join(dir, "src", "b.ts"), "// b\nconst y = 1;\n");
    const findings = eslintFindingsFromRun(ctxIn(dir), {
      exitCode: 1,
      successSubstringMatched: false,
      stdout: eslintResults(dir),
      stdoutTruncated: false,
    });
    assert.equal(findings.length, 3);
    assert.deepEqual(
      findings.map((f) => [f.offending_file, f.line, f.start_column ?? 0]),
      [
        ["src/a.ts", 1, 1],
        ["src/a.ts", 3, 5],
        ["src/b.ts", 2, 7],
      ],
    );
    const eq = findings[1]!;
    assert.equal(eq.rule_id, "eqeqeq");
    assert.equal(eq.severity, "warning");
    assert.equal(eq.end_line, 3);
    assert.equal(eq.end_column, 7);
    assert.equal(eq.evidence, "x == y) {}");
    assert.equal(findings[0]!.rule_id, "eslint/parse");
    assert.equal(findings[2]!.evidence, "y = 1;");
    assert.equal(findings.every((f) => f.failed_gate === "gate"), true);
  });

  it("truncated stdout yields the truncation finding, never the --format json hint", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-eslint-trunc-"));
    const findings = eslintFindingsFromRun(ctxIn(dir), {
      exitCode: 1,
      successSubstringMatched: false,
      stdout: '[{"filePath":"a.ts","messages":[{"ruleId":"x","severity":2,"me',
      stdoutTruncated: true,
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.rule_id, "eslint/stdout-truncated");
    assert.match(findings[0]!.resolution_hint, /MiB/);
    assert.doesNotMatch(findings[0]!.resolution_hint, /--format json/);
  });

  it("non-truncated unparseable stdout yields the --format json hint", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-eslint-bad-"));
    const findings = eslintFindingsFromRun(ctxIn(dir), {
      exitCode: 1,
      successSubstringMatched: false,
      stdout: "src/a.ts\n  3:5  error  something  rule\n",
      stdoutTruncated: false,
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.rule_id, "eslint/unparseable-output");
    assert.match(findings[0]!.resolution_hint, /--format json/);
  });

  it("exit 2 with an empty result set falls back to one generic gate finding", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-eslint-exit2-"));
    const findings = eslintFindingsFromRun(ctxIn(dir), {
      exitCode: 2,
      successSubstringMatched: false,
      stdout: "[]",
      stdoutTruncated: false,
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.rule_id, undefined);
    assert.equal(findings[0]!.resolution_hint, "gate command failed");
  });
});

describe("EslintJsonAdapter", () => {
  it("captures stdout from a real subprocess and streams it to gate_log_path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-eslint-spawn-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "let a = 1;\n");
    const payload = JSON.stringify([
      { filePath: path.join(dir, "src", "a.ts"), messages: [{ ruleId: "prefer-const", severity: 2, message: "use const", line: 1, column: 5 }] },
    ]);
    fs.writeFileSync(path.join(dir, "fake-eslint.cjs"), `process.stdout.write(${JSON.stringify(payload)}); process.exit(1);\n`);
    const adapter = new EslintJsonAdapter();
    const result = await adapter.execute("node fake-eslint.cjs", ctxIn(dir));
    assert.equal(result.adapter_id, "eslint");
    assert.equal(result.exitCode, 1);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.offending_file, "src/a.ts");
    assert.equal(result.findings[0]!.line, 1);
    assert.equal(result.findings[0]!.rule_id, "prefer-const");
    assert.ok(fs.readFileSync(path.join(dir, "gate.log"), "utf8").includes("prefer-const"));
  });
});
