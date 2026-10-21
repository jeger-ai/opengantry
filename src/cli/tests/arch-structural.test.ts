import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkArchStructure, loadTargetArchitecture, ratchetArchBaseline, runArchCheck, walkPerimeterFiles } from "#missions/arch/target-architecture.js";

function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-structural-"));
  const w = (rel: string, body: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  spawnSync("git", ["-C", root, "init", "-q"]);
  w("src/core/law.ts", 'export function isPathUnderRoot(a: string): boolean {\n  return a.length > 0;\n}\nexport const CODE = "GXT_KNOWN";\n');
  w("src/lib/util.ts", 'import "lodash";\nexport const x = 1;\n');
  w("src/lib/dup.ts", "same\n");
  w("src/lib/tests/t.ts", 'const t = "GXT_UNREGISTERED";\nfunction isPathUnderRoot() {}\nexport const u = 1;\nexport const v = 2;\n');
  w("src/cyc/a.ts", 'import { b } from "./b.js";\nexport const a = b;\n');
  w("src/cyc/b.ts", 'import type { a } from "./a.js";\nexport { c } from "./c.js";\nexport const b: typeof a = 1;\n');
  w("src/cyc/c.ts", 'import { a } from "./a.js";\nexport const c = a;\n');
  w("templates/src/lib/dup.ts", "same\n");
  w("package.json", JSON.stringify({ name: "fixture", dependencies: { lodash: "1" }, devDependencies: { yaml: "1", zod: "^3" } }));
  w(".gitagent/registry/error-codes.yaml", "schema: opengantry.registry.v1\nkind: error-codes\nentries:\n  - name: GXT_KNOWN\n");
  w(".gitagent/registry/dependencies.yaml", "schema: opengantry.registry.v1\nkind: dependencies\nentries:\n  - name: lodash\n    scope: runtime\n    range: \"1\"\n  - name: zod\n    scope: dev\n    range: ^4\n");
  w(
    "TARGET_ARCHITECTURE.yaml",
    `schema_version: "0.4.0"
scan_roots:
  - src/**
exclude:
  - "**/tests/**"
file_ceiling_lines: 3
layers:
  - id: core
    globs: [src/core/**]
  - id: lib
    globs: [src/lib/**]
rules:
  - id: B-LIB
    kind: budget
    layer: lib
  - id: B-CORE
    kind: budget
    layer: core
  - id: OWN-ROOT
    kind: owner
    pattern: "function isPathUnderRoot\\\\("
    owners: [src/core/law.ts]
  - id: REG-CODES
    kind: registry
    patterns: ['"(GXT_[A-Z0-9_]+)"']
    registries: [.gitagent/registry/error-codes.yaml]
  - id: DEPS
    kind: dependency
    registry: .gitagent/registry/dependencies.yaml
  - id: DUP
    kind: duplicate
    between: [src/, templates/src/]
  - id: CYCLES
    kind: cycles
`,
  );
  return root;
}

test("schema 0.4.0 parses the six structural kinds; a whole-tree check reports owner, registry, dependency, duplicate, cycle and ceiling findings; excluded files are neither judged nor counted", () => {
  const root = repo();
  try {
    const spec = loadTargetArchitecture(root);
    assert.deepEqual(spec.rules.map((r) => r.kind), ["budget", "budget", "owner", "registry", "dependency", "duplicate", "cycles"]);
    assert.deepEqual(spec.exclude, ["**/tests/**"]);
    fs.writeFileSync(path.join(root, "src/lib/copy.ts"), 'function isPathUnderRoot(b: string) {}\nconst c = "GXT_NEW";\n');
    const files = walkPerimeterFiles(root, spec);
    assert.equal(files.some((f) => f.includes("/tests/")), false);
    const result = runArchCheck(root, files, { wholeTree: true });
    const rows = result.violations.map((v) => `${v.rule_id} ${v.file} ${v.module_specifier}`).sort();
    assert.deepEqual(rows, [
      "B-CORE src/core/law.ts file lines 4 > ceiling 3",
      "CYCLES src/cyc/a.ts runtime import cycle among src/cyc/a.ts, src/cyc/b.ts, src/cyc/c.ts",
      "DEPS package.json dev dependency yaml is not in .gitagent/registry/dependencies.yaml",
      "DEPS package.json dev dependency zod range ^3 is registered as ^4 in .gitagent/registry/dependencies.yaml",
      "DUP src/lib/dup.ts byte-identical to templates/src/lib/dup.ts",
      "OWN-ROOT src/lib/copy.ts function isPathUnderRoot( (owned by src/core/law.ts)",
      "REG-CODES src/lib/copy.ts GXT_NEW is not in .gitagent/registry/error-codes.yaml",
    ]);
    // An excluded file named explicitly is not judged either.
    assert.deepEqual(runArchCheck(root, [path.join(root, "src/lib/tests/t.ts")], { wholeTree: false }).violations, []);
    // A partial file list judges only per-file rules.
    const partial = runArchCheck(root, [path.join(root, "src/lib/util.ts")], { wholeTree: false });
    assert.deepEqual(partial.violations, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("budgets ratchet: no baseline passes, --ratchet records counts, growth fails the check and is refused by a lower-only ratchet", () => {
  const root = repo();
  try {
    const spec = loadTargetArchitecture(root);
    const files = () => walkPerimeterFiles(root, spec);
    assert.deepEqual(checkArchStructure(spec, root, files()).violations.filter((v) => v.rule_id.startsWith("B-") && !v.module_specifier.includes("ceiling")), []);
    const first = ratchetArchBaseline(spec, root, files(), false);
    assert.equal(first.written, true);
    assert.deepEqual(first.layers.lib, { files: 2, lines: 3, exports: 1 });
    fs.writeFileSync(path.join(root, "src/lib/more.ts"), "export const m = 1;\n");
    const grown = checkArchStructure(spec, root, files()).violations.filter((v) => v.rule_id === "B-LIB").map((v) => v.module_specifier).sort();
    assert.deepEqual(grown, ["exports 2 > 1", "files 3 > 2", "lines 4 > 3"]);
    const refused = ratchetArchBaseline(spec, root, files(), false);
    assert.equal(refused.written, false);
    assert.deepEqual(refused.raised, ["lib"]);
    const raised = ratchetArchBaseline(spec, root, files(), true);
    assert.equal(raised.written, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "ARCH_BASELINE.json"), "utf8")).layers.lib, { files: 3, lines: 4, exports: 2 });
    assert.deepEqual(checkArchStructure(spec, root, files()).violations.filter((v) => v.rule_id === "B-LIB"), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
