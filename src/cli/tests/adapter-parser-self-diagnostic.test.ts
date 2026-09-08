import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  eslintFindingsFromRun,
  parseEslintJsonOutput,
} from "../lib/gate-adapters/eslint-json-adapter.js";
import type { GateExecContext } from "../lib/gate-adapters/gate-adapter-types.js";
import { parseTscOutput, tscFindingsFromRun } from "../lib/gate-adapters/tsc-adapter.js";

function ctxIn(dir: string, successSubstring: string | null = null): GateExecContext {
  return {
    msn_id: "MSN-TEST",
    gate_log_path: path.join(dir, "gate.log"),
    cwd: dir,
    repo_root: dir,
    successSubstring,
  };
}

function runCtx(): GateExecContext {
  return ctxIn(fs.mkdtempSync(path.join(os.tmpdir(), "og-adapter-sd-")));
}

describe("tsc parser self-diagnostics", () => {
  const fixtures: Array<{ name: string; stdout: string; expectedFiles: string[] }> = [
    { name: "empty stdout", stdout: "", expectedFiles: [] },
    { name: "CRLF diagnostic", stdout: "src/a.ts(1,1): error TS2322: boom.\r\n", expectedFiles: ["src/a.ts"] },
    {
      name: "Windows paren path",
      stdout: "C:\\proj\\src\\a.ts(1,1): error TS2322: boom.\n",
      expectedFiles: ["C:\\proj\\src\\a.ts"],
    },
    {
      name: "POSIX absolute path",
      stdout: "/repo/src/a.ts(2,3): error TS2304: Cannot find name 'foo'.\n",
      expectedFiles: ["/repo/src/a.ts"],
    },
    {
      name: "path with spaces",
      stdout: "src/foo bar.ts(1,1): error TS2322: boom.\n",
      expectedFiles: ["src/foo bar.ts"],
    },
    { name: "missing column", stdout: "src/a.ts(1,): error TS2322: boom.\n", expectedFiles: [] },
    { name: "missing colon after parens", stdout: "src/a.ts(1,1) error TS2322: boom.\n", expectedFiles: [] },
    { name: "summary only", stdout: "Found 1 error in 1 file.\n", expectedFiles: [] },
    {
      name: "pretty colon with drive letter",
      stdout: "C:/src/a.ts:1:1 - error TS2322: boom.\n",
      expectedFiles: ["C:/src/a.ts"],
    },
  ];

  for (const row of fixtures) {
    it(`parseTscOutput never throws: ${row.name}`, () => {
      assert.doesNotThrow(() => parseTscOutput(row.stdout));
      const diagnostics = parseTscOutput(row.stdout);
      assert.deepEqual(
        diagnostics.map((d) => d.file),
        row.expectedFiles,
      );
    });
  }

  it("exit 0 with empty stdout and matched substring yields no findings", () => {
    assert.deepEqual(
      tscFindingsFromRun(runCtx(), {
        exitCode: 0,
        successSubstringMatched: true,
        stdout: "",
        stdoutTruncated: false,
      }),
      [],
    );
  });

  it("exit != 0 with unmatched stdout yields one generic finding and does not throw", () => {
    const findings = tscFindingsFromRun(runCtx(), {
      exitCode: 1,
      successSubstringMatched: false,
      stdout: "",
      stdoutTruncated: false,
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.resolution_hint, "gate command failed");
  });
});

describe("eslint parser self-diagnostics", () => {
  it("parseEslintJsonOutput never throws on malformed or unexpected payloads", () => {
    const payloads = [
      "",
      "{}",
      "null",
      "[]",
      "not json",
      "\uFEFF[]",
      '[{"filePath":"a.ts"}]',
      '[1, null, {"filePath":"a.ts","messages":[{"ruleId":"x","severity":2,"message":"m","line":1,"column":1}]}]',
      '[{"messages":[{"ruleId":"x","severity":2,"message":"m","line":1,"column":1}]}]',
      '[{"filePath":"C:\\\\repo\\\\src\\\\a.ts","messages":[]}]',
      '[{"filePath":"a.ts","messages":[]}]\nOops trailing',
    ];
    for (const stdout of payloads) {
      assert.doesNotThrow(() => parseEslintJsonOutput(stdout));
    }
  });

  it("{} / null / non-array JSON are unparseable", () => {
    for (const stdout of ["{}", "null", "not json"]) {
      const parsed = parseEslintJsonOutput(stdout);
      assert.equal(parsed.ok, false);
    }
  });

  it("[] is a valid empty result set", () => {
    const parsed = parseEslintJsonOutput("[]");
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.diagnostics.length, 0);
  });

  it("skips non-object entries and missing filePath without throwing", () => {
    const parsed = parseEslintJsonOutput(
      '[1, null, {"messages":[{"ruleId":"x","severity":2,"message":"m","line":1,"column":1}]}]',
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.diagnostics.length, 1);
    assert.equal(parsed.diagnostics[0]!.file, "");
  });

  it("tolerates a UTF-8 BOM and banner-wrapped JSON with trailing noise", () => {
    assert.equal(parseEslintJsonOutput("\uFEFF[]").ok, true);
    const parsed = parseEslintJsonOutput('\n> lint\n[{"filePath":"a.ts","messages":[]}]\nOops trailing');
    assert.equal(parsed.ok, true);
  });

  it("trailing garbage with no leading banner is unparseable, not a throw", () => {
    const parsed = parseEslintJsonOutput('[{"filePath":"a.ts","messages":[]}]\nOops trailing');
    assert.equal(parsed.ok, false);
  });

  it("exit 0 with [] yields no findings", () => {
    assert.deepEqual(
      eslintFindingsFromRun(runCtx(), {
        exitCode: 0,
        successSubstringMatched: true,
        stdout: "[]",
        stdoutTruncated: false,
      }),
      [],
    );
  });

  it("unparseable object JSON yields eslint/unparseable-output", () => {
    const findings = eslintFindingsFromRun(runCtx(), {
      exitCode: 1,
      successSubstringMatched: false,
      stdout: "{}",
      stdoutTruncated: false,
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.rule_id, "eslint/unparseable-output");
  });
});
