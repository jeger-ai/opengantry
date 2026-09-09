import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { GateExecContext } from "../lib/gate-adapters/gate-adapter-types.js";
import { parseTscOutput, tscAdapter, tscFindingsFromRun } from "../lib/gate-adapters/tsc-adapter.js";

function ctxIn(dir: string, successSubstring: string | null = null): GateExecContext {
  return {
    cwd: dir,
    repoRoot: dir,
    gateLogPath: path.join(dir, "gate.log"),
    successSubstring,
  };
}

const NOISY_TSC_OUTPUT = [
  "(node:1234) ExperimentalWarning: VM Modules is an experimental feature",
  "(Use `node --trace-warnings ...` to show where the warning was created)",
  "",
  "> demo@1.0.0 build",
  "> tsc -p tsconfig.json",
  "",
  "src/(group)/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/b.ts(10,1): error TS2345: Argument of type '{ a: string; }' is not assignable to parameter of type 'Opts'.",
  "  Property 'b' is missing in type '{ a: string; }' but required in type 'Opts'.",
  "    Types of property 'a' are incompatible.",
  "src/c.ts(1,1): warning TS6133: 'x' is declared but its value is never read.",
  "",
  "Found 2 errors in 2 files.",
  "",
  "Errors  Files",
  "     1  src/(group)/a.ts:3",
  "     1  src/b.ts:10",
].join("\n");

describe("parseTscOutput", () => {
  it("extracts exactly the diagnostics, ignoring Node warnings, npm banners, and summaries", () => {
    const diagnostics = parseTscOutput(NOISY_TSC_OUTPUT);
    assert.deepEqual(
      diagnostics.map((d) => [d.file, d.line, d.column, d.ruleId, d.severity]),
      [
        ["src/(group)/a.ts", 3, 5, "TS2322", "error"],
        ["src/b.ts", 10, 1, "TS2345", "error"],
        ["src/c.ts", 1, 1, "TS6133", "warning"],
      ],
    );
  });

  it("appends indented continuation lines to the active diagnostic only", () => {
    const [, second] = parseTscOutput(NOISY_TSC_OUTPUT);
    assert.ok(second);
    assert.match(second.message, /^Argument of type/);
    assert.match(second.message, /Property 'b' is missing/);
    assert.match(second.message, /Types of property 'a' are incompatible\.$/);
    // The indented "Errors  Files" table rows follow a blank line, so they never attach.
    assert.doesNotMatch(second.message, /Errors\s+Files/);
  });

  it("parses the pretty colon form with ANSI colors stripped and never throws on garbage", () => {
    const out = "\u001b[96msrc/a.ts\u001b[0m:\u001b[93m4\u001b[0m:\u001b[93m9\u001b[0m - \u001b[91merror\u001b[0m\u001b[90m TS2304: \u001b[0mCannot find name 'foo'.\n\n~~~ random noise (1,2) error\n";
    const diagnostics = parseTscOutput(out);
    assert.equal(diagnostics.length, 1);
    assert.deepEqual([diagnostics[0]!.file, diagnostics[0]!.line, diagnostics[0]!.column, diagnostics[0]!.ruleId], ["src/a.ts", 4, 9, "TS2304"]);
    assert.deepEqual(parseTscOutput("\n\nnothing here\n"), []);
  });
});

describe("tscFindingsFromRun", () => {
  it("maps diagnostics to sorted v3 findings with evidence", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-tsc-map-"));
    fs.mkdirSync(path.join(dir, "src", "(group)"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "(group)", "a.ts"), "export {};\n\nlet n: number = 'x';\n");
    fs.writeFileSync(path.join(dir, "src", "b.ts"), "");
    fs.writeFileSync(path.join(dir, "src", "c.ts"), "const x = 1;\n");
    const findings = tscFindingsFromRun(ctxIn(dir), {
      exitCode: 2,
      successSubstringMatched: false,
      stdout: NOISY_TSC_OUTPUT,
      stdoutTruncated: false,
    });
    assert.deepEqual(
      findings.map((f) => [f.offending_file, f.line, f.start_column, f.rule_id, f.severity]),
      [
        ["src/(group)/a.ts", 3, 5, "TS2322", "error"],
        ["src/b.ts", 10, 1, "TS2345", "error"],
        ["src/c.ts", 1, 1, "TS6133", "warning"],
      ],
    );
    assert.equal(findings[0]!.evidence, "n: number = 'x';");
    assert.equal(findings[2]!.evidence, "const x = 1;");
  });

  it("exit != 0 with zero diagnostics falls back to one generic finding", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-tsc-empty-"));
    const findings = tscFindingsFromRun(ctxIn(dir), {
      exitCode: 1,
      successSubstringMatched: false,
      stdout: "error TS5083: Cannot read file 'tsconfig.json'.\n",
      stdoutTruncated: false,
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.resolution_hint, "gate command failed");
  });

  it("truncated stdout keeps the parsed prefix and appends the truncation finding", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-tsc-trunc-"));
    const findings = tscFindingsFromRun(ctxIn(dir), {
      exitCode: 2,
      successSubstringMatched: false,
      stdout: "src/a.ts(1,1): error TS2322: boom.\nsrc/b.ts(2,2): error TS23",
      stdoutTruncated: true,
    });
    assert.equal(findings.length, 2);
    assert.equal(findings[0]!.rule_id, "TS2322");
    assert.equal(findings[1]!.rule_id, "tsc/stdout-truncated");
  });

  it("exit 0 with success substring yields no findings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-tsc-ok-"));
    assert.deepEqual(
      tscFindingsFromRun(ctxIn(dir, "done"), { exitCode: 0, successSubstringMatched: true, stdout: "done\n", stdoutTruncated: false }),
      [],
    );
  });
});

describe("tscAdapter", () => {
  it("runs a fake tsc subprocess and emits line-level findings", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-tsc-spawn-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "let n: number = 'x';\n");
    fs.writeFileSync(
      path.join(dir, "fake-tsc.cjs"),
      "console.log(\"src/a.ts(1,5): error TS2322: Type 'string' is not assignable to type 'number'.\");\nconsole.log('Found 1 error in 1 file.');\nprocess.exit(2);\n",
    );
    const result = await tscAdapter("node fake-tsc.cjs", ctxIn(dir));
    assert.equal(result.adapter_id, "tsc");
    assert.equal(result.exitCode, 2);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.offending_file, "src/a.ts");
    assert.equal(result.findings[0]!.line, 1);
    assert.equal(result.findings[0]!.rule_id, "TS2322");
    assert.ok(fs.readFileSync(path.join(dir, "gate.log"), "utf8").includes("Found 1 error"));
  });
});
