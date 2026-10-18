import test from "node:test";
import assert from "node:assert/strict";
import { pathMatchesGlobPattern } from "../src/path-glob.js";
import { archLaw, countLayers, evaluateBudgets, evaluateDependencies, evaluateDuplicates, evaluateOwner, evaluateRegistry, structuralLaw } from "../src/law.js";

const arch = archLaw({ layers: [{ id: "core", globs: ["packages/core/src/**"] }, { id: "lib", globs: ["src/cli/lib/**"] }] });
const files = [
  { path: "packages/core/src/a.ts", body: "export const a = 1;\nexport function f() {}\n" },
  { path: "src/cli/lib/b.ts", body: "const b = 1;\n" },
  { path: "src/cli/lib/tests/t.test.ts", body: "x\n".repeat(50) },
];

test("the general glob: ** any depth, * one segment, ? one char", () => {
  assert.equal(pathMatchesGlobPattern("src/cli/lib/tests/t.ts", "**/tests/**"), true);
  assert.equal(pathMatchesGlobPattern("tests/t.ts", "**/tests/**"), true);
  assert.equal(pathMatchesGlobPattern("packages/core/src/x.ts", "packages/*/src/**"), true);
  assert.equal(pathMatchesGlobPattern("packages/core/src/x.ts", "packages/*/tests/**"), false);
  assert.equal(pathMatchesGlobPattern("a/b.ts", "a/?.ts"), true);
  assert.equal(pathMatchesGlobPattern("src/cli/x.ts", "src/cli/x.ts"), true);
});

test("countLayers counts files, lines and exports per layer, excluding by glob", () => {
  const c = countLayers(arch, files, ["**/tests/**"]);
  assert.deepEqual(c, { core: { files: 1, lines: 2, exports: 2 }, lib: { files: 1, lines: 1, exports: 0 } });
});

test("budgets ratchet against the baseline, start a new layer at its own size, and enforce the file ceiling", () => {
  const law = structuralLaw({ fileCeilingLines: 10, budgetRules: [{ id: "B-LIB", layer: "lib", exclude: ["**/tests/**"] }, { id: "B-CORE", layer: "core", max_exports: 1 }] });
  const findings = evaluateBudgets(law, arch, files, { lib: { files: 1, lines: 0, exports: 0 } });
  assert.deepEqual(findings.map((f) => [f.rule_id, f.file, f.module_specifier]), [
    ["B-LIB", "lib", "lines 1 > 0"],
    ["B-CORE", "core", "exports 2 > 1"],
  ]);
  const tall = evaluateBudgets(law, arch, [{ path: "src/cli/lib/big.ts", body: "x\n".repeat(11) }], { lib: { files: 5, lines: 50, exports: 5 } });
  assert.deepEqual(tall.map((f) => f.module_specifier), ["file lines 11 > ceiling 10"]);
});

test("owner: a pattern may match only in the owner files", () => {
  const law = structuralLaw({ ownerRules: [{ id: "OWN", pattern: "function isPathUnderRoot\\(", owners: ["packages/core/src/law.ts"] }] });
  assert.deepEqual(evaluateOwner(law, "packages/core/src/law.ts", "export function isPathUnderRoot(a) {}", () => true), []);
  const hit = evaluateOwner(law, "src/cli/lib/x.ts", "\nfunction isPathUnderRoot(a) {}", () => true);
  assert.equal(hit.length, 1);
  assert.equal(hit[0]?.line, 2);
  assert.match(hit[0]?.module_specifier ?? "", /owned by packages\/core\/src\/law.ts/);
  assert.deepEqual(evaluateOwner(law, "docs/x.md", "function isPathUnderRoot(", () => false), []);
});

test("registry: every captured name must be registered, once per file", () => {
  const law = structuralLaw({ registryRules: [{ id: "REG", patterns: ['"(GXT_[A-Z0-9_]+)"'], registries: ["error-codes.yaml"], names: ["GXT_A"] }] });
  const hits = evaluateRegistry(law, "src/x.ts", 'a("GXT_A"); b("GXT_B");\nc("GXT_B");', () => true);
  assert.deepEqual(hits.map((h) => [h.module_specifier, h.line]), [["GXT_B is not in error-codes.yaml", 1]]);
});

test("dependencies and duplicates", () => {
  const law = structuralLaw({
    dependencyRules: [{ id: "DEP", registry: "dependencies.yaml", manifest: "package.json", allowed: ["yaml"] }],
    duplicateRules: [{ id: "DUP", between: ["scripts/", "templates/scripts/"], allowed: ["scripts/ok.sh"] }],
  });
  assert.deepEqual(evaluateDependencies(law, [{ name: "yaml", scope: "runtime" }, { name: "lodash", scope: "dev" }]).map((f) => f.module_specifier), ["dev dependency lodash is not in dependencies.yaml"]);
  const dup = evaluateDuplicates(law, [
    { path: "scripts/ok.sh", sha256: "1" }, { path: "templates/scripts/ok.sh", sha256: "1" },
    { path: "scripts/new.sh", sha256: "2" }, { path: "templates/scripts/new.sh", sha256: "2" },
    { path: "scripts/own.sh", sha256: "3" },
  ]);
  assert.deepEqual(dup.map((f) => [f.file, f.module_specifier]), [["scripts/new.sh", "byte-identical to templates/scripts/new.sh"]]);
});
