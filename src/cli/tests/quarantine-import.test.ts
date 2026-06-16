import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import { quarantineImportDeclaration } from "../lib/surgeons/quarantine-import.js";

test("quarantineImportDeclaration: AST quarantine for lib-to-command import", () => {
  const root = getRepoRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-quarantine-ast-"));
  const libDir = path.join(dir, "src", "cli", "lib");
  fs.mkdirSync(libDir, { recursive: true });
  const file = path.join(libDir, "bad.ts");
  fs.writeFileSync(
    file,
    `import { runVerify } from "../commands/verify.js";\nexport const x = runVerify;\n`,
    "utf8",
  );

  const result = quarantineImportDeclaration({
    absPath: file,
    moduleSpecifier: "../commands/verify.js",
    ruleId: "RULE-IMPORT-LAYER",
    reason: "removed lib-to-command import",
    root,
  });

  assert.equal(result.mutated, true);
  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /GXT-SURGEON-QUARANTINE-START \[RULE-IMPORT-LAYER\]/);
  assert.match(out, /const runVerify = new Proxy\(Object\.create\(null\)/);
  assert.doesNotMatch(out, /^import .*verify\.js/m);
});

test("quarantineImportDeclaration: multi-line import quarantine", () => {
  const root = getRepoRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-quarantine-multiline-"));
  const file = path.join(dir, "bad.ts");
  fs.writeFileSync(
    file,
    `import {
  fetchData,
  postData,
} from "axios";
export const x = fetchData;
`,
    "utf8",
  );

  const result = quarantineImportDeclaration({
    absPath: file,
    moduleSpecifier: "axios",
    ruleId: "RULE-BANNED-IMPORT",
    reason: "removed banned specifier",
    root,
  });

  assert.equal(result.mutated, true);
  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /const fetchData = new Proxy/);
  assert.match(out, /const postData = new Proxy/);
  assert.doesNotMatch(out, /from "axios"/);
});

test("quarantineImportDeclaration: type-only import is no-op", () => {
  const root = getRepoRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-quarantine-type-"));
  const file = path.join(dir, "types.ts");
  const source = `import type { ParsedMission } from "./types.js";\nexport type M = ParsedMission;\n`;
  fs.writeFileSync(file, source, "utf8");

  const result = quarantineImportDeclaration({
    absPath: file,
    moduleSpecifier: "./types.js",
    ruleId: "RULE-IMPORT-LAYER",
    reason: "removed lib-to-command import",
    root,
  });

  assert.equal(result.mutated, false);
  assert.equal(fs.readFileSync(file, "utf8"), source);
});

test("quarantineImportDeclaration: mixed default + named quarantines all bindings", () => {
  const root = getRepoRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-quarantine-mixed-"));
  const file = path.join(dir, "bad.ts");
  fs.writeFileSync(
    file,
    `import runVerify, { runPerimeter } from "../commands/verify.js";\nexport const a = runVerify;\nexport const b = runPerimeter;\n`,
    "utf8",
  );

  const result = quarantineImportDeclaration({
    absPath: file,
    moduleSpecifier: "../commands/verify.js",
    ruleId: "RULE-IMPORT-LAYER",
    reason: "removed lib-to-command import",
    root,
  });

  assert.equal(result.mutated, true);
  assert.deepEqual(result.bindings, ["runVerify", "runPerimeter"]);
  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /const runVerify = new Proxy/);
  assert.match(out, /const runPerimeter = new Proxy/);
  assert.doesNotMatch(out, /^import .*verify\.js/m);
});

test("quarantineImportDeclaration: mixed default + namespace quarantines both bindings", () => {
  const root = getRepoRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-quarantine-mixed-ns-"));
  const file = path.join(dir, "bad.ts");
  fs.writeFileSync(
    file,
    `import def, * as ns from "axios";\nexport const a = def;\nexport const b = ns;\n`,
    "utf8",
  );

  const result = quarantineImportDeclaration({
    absPath: file,
    moduleSpecifier: "axios",
    ruleId: "RULE-BANNED-IMPORT",
    reason: "removed banned specifier",
    root,
  });

  assert.equal(result.mutated, true);
  assert.deepEqual(result.bindings, ["def", "ns"]);
  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /const def = new Proxy/);
  assert.match(out, /const ns = new Proxy/);
});

test("quarantineImportDeclaration: inline type-only named skipped in mixed import", () => {
  const root = getRepoRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-quarantine-mixed-type-"));
  const file = path.join(dir, "bad.ts");
  fs.writeFileSync(file, `import foo, { type T, bar } from "axios";\n`, "utf8");

  const result = quarantineImportDeclaration({
    absPath: file,
    moduleSpecifier: "axios",
    ruleId: "RULE-BANNED-IMPORT",
    reason: "removed banned specifier",
    root,
  });

  assert.equal(result.mutated, true);
  assert.deepEqual(result.bindings, ["foo", "bar"]);
});
