import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findBannedImportsInFolder } from "../lib/ast-discovery.js";
import { quarantineBannedImportInFile } from "../lib/surgeons/banned-import.js";

test("quarantineBannedImportInFile: comments import and injects proxy roadblock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-surgeon-ban-"));
  const file = path.join(dir, "bad.ts");
  fs.writeFileSync(
    file,
    `import { fetchData } from "axios";
export const x = fetchData;
`,
    "utf8",
  );

  const result = quarantineBannedImportInFile(file, "axios", "RULE-BANNED-IMPORT");
  assert.equal(result.mutated, true);
  assert.equal(result.lineNumber, 1);

  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /GXT-SURGEON-QUARANTINE-START \[RULE-BANNED-IMPORT\]/);
  assert.match(out, /GXT-SURGEON-QUARANTINE: removed banned specifier axios/);
  assert.match(out, /const fetchData = new Proxy/);
  assert.match(out, /GXT Security Violation/);
  assert.match(out, /GXT-SURGEON-QUARANTINE-END/);
  assert.doesNotMatch(out, /^import .*axios/m);
});

test("quarantineBannedImportInFile: no-op when specifier absent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-surgeon-ban-miss-"));
  const file = path.join(dir, "clean.ts");
  const source = `import fs from "node:fs";\nexport const x = 1;\n`;
  fs.writeFileSync(file, source, "utf8");

  const result = quarantineBannedImportInFile(file, "axios");
  assert.equal(result.mutated, false);
  assert.equal(fs.readFileSync(file, "utf8"), source);
});

test("quarantineBannedImportInFile: gate scan no longer detects banned specifier", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-surgeon-ban-gate-"));
  const relDir = path.join("src", "pkg");
  const absDir = path.join(dir, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const file = path.join(absDir, "bad.ts");
  fs.writeFileSync(file, `import axios from "axios";\nexport const x = 1;\n`, "utf8");

  quarantineBannedImportInFile(file, "axios");

  const violations = findBannedImportsInFolder(dir, relDir, ["axios"]);
  assert.equal(violations.length, 0);
});
