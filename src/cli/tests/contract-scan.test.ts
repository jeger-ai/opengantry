import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listChangedSourceFiles, scanContractImports } from "../lib/contract/contract-scan.js";
import { gitInitCommit, gitInitStaged } from "./test-fixtures.js";
import type { EffectiveScope } from "../lib/contract/contract-types.js";
import { extractImportSites } from "../lib/import-scanner.js";
import { bareSpecifierPackage, classifySpecifier, loadTsconfigPaths } from "../lib/contract/resolve-specifier.js";

function scope(overrides: Partial<EffectiveScope> = {}): EffectiveScope {
  return {
    tmvcRoots: ["src/ui/"],
    forbiddenZones: ["src/db/"],
    allowedImports: [],
    bannedImports: [],
    allowDynamicSpecifiers: false,
    strictRelativeImports: false,
    hasContract: true,
    ...overrides,
  };
}

function tmpRepo(files: Record<string, string>): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-contract-scan-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dest, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  return dest;
}

test("import sites: static, export-from, dynamic import, require, and non-literal forms", () => {
  const src = `import a from "pkg-a";
import type { T } from "./types.js";
export { x } from "../shared/x.js";
export * as ns from "pkg-ns";
const b = await import("pkg-b");
const c = require("pkg-c");
const d = await import(\`pkg-\${name}\`);
const e = require(variable);
// import("commented-out")
/* require("also-commented") */
`;
  const sites = extractImportSites(src);
  const bySpec = new Map(sites.map((s) => [s.spec ?? `<expr:${s.expression}>`, s.kind]));
  assert.equal(bySpec.get("pkg-a"), "static");
  assert.equal(bySpec.get("./types.js"), "static");
  assert.equal(bySpec.get("../shared/x.js"), "export_from");
  assert.equal(bySpec.get("pkg-ns"), "export_from");
  assert.equal(bySpec.get("pkg-b"), "dynamic_import");
  assert.equal(bySpec.get("pkg-c"), "require");
  assert.equal(bySpec.get("<expr:`pkg-${name}`>"), "dynamic_import_expr");
  assert.equal(bySpec.get("<expr:variable>"), "require_expr");
  assert.equal(sites.some((s) => s.spec === "commented-out" || s.spec === "also-commented"), false);
  assert.equal(sites.find((s) => s.spec === "pkg-b")?.line, 5);
});

test("resolve specifier: builtin, bare package name, relative, and tsconfig alias", () => {
  const dest = tmpRepo({
    "tsconfig.json": `{
  // comment allowed
  "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"], }, },
}`,
  });
  const ts = loadTsconfigPaths(dest);
  assert.ok(ts);
  assert.equal(classifySpecifier("node:fs", "src/ui/a.ts", ts).kind, "builtin");
  assert.equal(classifySpecifier("path", "src/ui/a.ts", ts).kind, "builtin");
  assert.equal(bareSpecifierPackage("@scope/pkg/sub"), "@scope/pkg");
  assert.equal(bareSpecifierPackage("lodash/fp"), "lodash");
  const rel = classifySpecifier("../db/client.js", "src/ui/a.ts", ts);
  assert.equal(rel.kind, "relative");
  assert.equal(rel.kind === "relative" && rel.resolvedRepoRel, "src/db/client.js");
  const alias = classifySpecifier("@app/db/client.js", "src/ui/a.ts", ts);
  assert.equal(alias.kind, "alias");
  assert.equal(alias.kind === "alias" && alias.resolvedRepoRel, "src/db/client.js");
  assert.equal(classifySpecifier("@other/thing", "src/ui/a.ts", ts).kind, "bare");
});

test("contract scan: banned, unlisted, dynamic, and forbidden-zone escapes are reported in order", () => {
  const dest = tmpRepo({
    "src/ui/a.ts": `import React from "react";
import { db } from "../db/client.js";
import prisma from "prisma/client";
const m = await import(dynamicName);
import left from "left-pad";
`,
    "src/db/client.ts": `export const db = 1;`,
  });
  const violations = scanContractImports(
    dest,
    scope({ allowedImports: ["react", "prisma"], bannedImports: ["prisma"] }),
  );
  assert.deepEqual(
    violations.map((v) => [v.kind, v.line, v.specifier]),
    [
      ["scope_escape", 2, "../db/client.js"],
      ["banned", 3, "prisma/client"],
      ["dynamic", 4, "dynamicName"],
      ["unlisted", 5, "left-pad"],
    ],
  );
  assert.equal(violations[0]!.file, "src/ui/a.ts");
});

test("contract scan: strict_relative_imports flags TMVC exits; default allows them", () => {
  const dest = tmpRepo({
    "src/ui/a.ts": `import { util } from "../shared/util.js";\n`,
    "src/shared/util.ts": `export const util = 1;`,
  });
  assert.deepEqual(scanContractImports(dest, scope()), []);
  const strict = scanContractImports(dest, scope({ strictRelativeImports: true }));
  assert.equal(strict.length, 1);
  assert.equal(strict[0]!.kind, "scope_escape");
  assert.match(strict[0]!.detail, /outside effective TMVC roots/);
});

test("contract scan: allow_dynamic_specifiers permits non-literal arguments; builtins never flagged", () => {
  const dest = tmpRepo({
    "src/ui/a.ts": `import fs from "node:fs";\nimport path from "path";\nconst m = require(name);\n`,
  });
  assert.deepEqual(scanContractImports(dest, scope({ allowDynamicSpecifiers: true, allowedImports: ["react"] })), []);
  assert.equal(scanContractImports(dest, scope({ allowedImports: ["react"] })).length, 1);
});

test("contract scan: explicit files option restricts scan and skips non-source files", () => {
  const dest = tmpRepo({
    "src/ui/a.ts": `import x from "banned-pkg";\n`,
    "src/ui/b.ts": `import y from "banned-pkg";\n`,
    "src/ui/c.md": `import z from "banned-pkg";\n`,
  });
  const v = scanContractImports(dest, scope({ bannedImports: ["banned-pkg"] }), { files: ["src/ui/b.ts", "src/ui/c.md"] });
  assert.deepEqual(v.map((x) => x.file), ["src/ui/b.ts"]);
});

test("empty-roots scan: dirty sources only; deleted paths skipped; untracked ts included", () => {
  const dest = tmpRepo({
    "gone.ts": `import x from "banned-pkg";\n`,
    "keep.md": "not source\n",
  });
  gitInitCommit(dest, "init", "planner@example.com");
  fs.unlinkSync(path.join(dest, "gone.ts"));
  fs.writeFileSync(path.join(dest, "dirty.ts"), `import y from "banned-pkg";\n`);
  const changed = listChangedSourceFiles(dest);
  assert.deepEqual(changed, ["dirty.ts"]);
  const v = scanContractImports(dest, scope({ tmvcRoots: [], bannedImports: ["banned-pkg"] }));
  assert.deepEqual(v.map((x) => x.file), ["dirty.ts"]);
});

test("empty-roots scan: fresh repo with no HEAD scans staged and untracked sources", () => {
  const dest = tmpRepo({
    "staged.ts": `import x from "banned-pkg";\n`,
    "-h.ts": `import y from "banned-pkg";\n`,
    "notes.md": "not source\n",
  });
  gitInitStaged(dest, "planner@example.com");
  fs.writeFileSync(path.join(dest, "untracked.ts"), `import z from "banned-pkg";\n`);
  assert.deepEqual(listChangedSourceFiles(dest), ["-h.ts", "staged.ts", "untracked.ts"]);
  const v = scanContractImports(dest, scope({ tmvcRoots: [], bannedImports: ["banned-pkg"] }));
  assert.deepEqual(v.map((x) => x.file), ["-h.ts", "staged.ts", "untracked.ts"]);
});

test("empty-roots scan: fresh repo staged-then-deleted path is dropped, not read", () => {
  const dest = tmpRepo({
    "gone.ts": `import x from "banned-pkg";\n`,
    "kept.ts": `import y from "banned-pkg";\n`,
  });
  gitInitStaged(dest, "planner@example.com");
  fs.unlinkSync(path.join(dest, "gone.ts"));
  assert.deepEqual(listChangedSourceFiles(dest), ["kept.ts"]);
  assert.doesNotThrow(() => scanContractImports(dest, scope({ tmvcRoots: [], bannedImports: ["banned-pkg"] })));
});
