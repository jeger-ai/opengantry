import test from "node:test";
import assert from "node:assert/strict";
import { archLaw, evaluateImportSite, evaluateLayerImport, evaluatePatternRules, findPatternMatch, law, layerForFile } from "../src/law.js";
import { classifySpecifier, importMatchesBan, isBuiltinSpecifier } from "../src/specifier.js";
import { extractImportSites } from "../src/import-scanner.js";

const contract = law({ allowedRoots: ["src/cli/"], forbiddenZones: [".gitagent/foreman/"], bannedImports: ["lodash"], allowedImports: [], strictRelativeImports: true });
const site = (spec: string | null, kind = "static", expression?: string) => ({ kind, spec, expression, line: 3, column: 1 });

test("specifier classification: builtin, bare package, relative and tsconfig alias", () => {
  assert.equal(isBuiltinSpecifier("node:fs"), true);
  assert.equal(classifySpecifier("fs/promises", "src/a.ts", null).kind, "builtin");
  assert.deepEqual(classifySpecifier("@scope/pkg/sub", "src/a.ts", null), { kind: "bare", specifier: "@scope/pkg/sub", packageName: "@scope/pkg" });
  assert.deepEqual(classifySpecifier("../lib/x.js", "src/cli/commands/a.ts", null), { kind: "relative", specifier: "../lib/x.js", resolvedRepoRel: "src/cli/lib/x.js" });
  assert.deepEqual(classifySpecifier("#core/law.js", "src/a.ts", { baseDirRel: "", paths: { "#core/*": ["packages/core/src/*"] } }), { kind: "alias", specifier: "#core/law.js", resolvedRepoRel: "packages/core/src/law.js" });
  assert.equal(importMatchesBan("lodash/fp", "lodash"), true);
  assert.equal(importMatchesBan("lodash-es", "lodash"), false);
});

test("evaluateImportSite: dynamic, banned, unlisted, forbidden zone and strict roots", () => {
  assert.equal(evaluateImportSite(contract, "src/cli/a.ts", site(null, "require_expr", "p"), null)?.kind, "dynamic");
  assert.equal(evaluateImportSite(law({ allowDynamicSpecifiers: true }), "src/cli/a.ts", site(null, "import_expr", "p"), null), null);
  assert.equal(evaluateImportSite(contract, "src/cli/a.ts", site("node:fs"), classifySpecifier("node:fs", "src/cli/a.ts", null)), null);
  assert.equal(evaluateImportSite(contract, "src/cli/a.ts", site("lodash/fp"), classifySpecifier("lodash/fp", "src/cli/a.ts", null))?.kind, "banned");
  const allow = law({ allowedImports: ["yaml"] });
  assert.equal(evaluateImportSite(allow, "src/cli/a.ts", site("zod"), classifySpecifier("zod", "src/cli/a.ts", null))?.kind, "unlisted");
  assert.equal(evaluateImportSite(allow, "src/cli/a.ts", site("yaml"), classifySpecifier("yaml", "src/cli/a.ts", null)), null);
  const fz = evaluateImportSite(contract, "src/cli/a.ts", site("../../.gitagent/foreman/x.js"), classifySpecifier("../../.gitagent/foreman/x.js", "src/cli/a.ts", null));
  assert.equal(fz?.kind, "scope_escape");
  assert.match(fz?.detail ?? "", /forbidden zone/);
  const outside = evaluateImportSite(contract, "src/cli/a.ts", site("../../docs/x.js"), classifySpecifier("../../docs/x.js", "src/cli/a.ts", null));
  assert.match(outside?.detail ?? "", /outside effective TMVC roots/);
});

const arch = archLaw({
  layers: [{ id: "command", globs: ["src/cli/commands/**"] }, { id: "lib", globs: ["src/cli/lib/**"] }],
  layerImportRules: [
    { id: "LIB-TO-COMMAND", from_layer: "lib", forbid_import_layer: "command" },
    { id: "LIB-COMMANDER", from_layer: "lib", forbid_specifier_substring: "commander" },
  ],
  patternRules: [{ id: "NO-EXIT", from_layer: "command", applies_to: ["src/cli/commands/**"], forbid_pattern: "process\\.exit\\(" }],
});

test("layers, layer import rules and pattern rules reproduce the arch check rows", () => {
  assert.equal(layerForFile(arch, "src/cli/lib/x.ts"), "lib");
  assert.equal(layerForFile(arch, "docs/x.md"), "other");
  const rows = evaluateLayerImport(arch, "src/cli/lib/x.ts", { spec: "../commands/y.js", line: 2, column: 1, bindings: ["y"], resolved: "src/cli/commands/y.ts" });
  assert.deepEqual(rows, [{ file: "src/cli/lib/x.ts", rule_id: "LIB-TO-COMMAND", module_specifier: "../commands/y.js", bindings: ["y"], line: 2, column: 1 }]);
  assert.equal(evaluateLayerImport(arch, "src/cli/lib/x.ts", { spec: "commander", line: 1, column: 1, bindings: [], resolved: null })[0]?.rule_id, "LIB-COMMANDER");
  assert.deepEqual(evaluateLayerImport(arch, "src/cli/commands/x.ts", { spec: "commander", line: 1, column: 1, bindings: [], resolved: null }), []);
  const hits = evaluatePatternRules(arch, "src/cli/commands/pin.ts", "const a = 1;\nprocess.exit(1);\n", () => false);
  assert.deepEqual(hits, [{ file: "src/cli/commands/pin.ts", rule_id: "NO-EXIT", module_specifier: "process.exit(", bindings: [], line: 2, column: 1 }]);
  assert.deepEqual(evaluatePatternRules(arch, "src/cli/lib/x.ts", "process.exit(1)", () => false), []);
  assert.equal(findPatternMatch("a\nb", "(?i)B")?.line, 2);
  assert.equal(findPatternMatch("a", "("), null);
});

test("the import scanner lists static, re-export, dynamic and require sites", () => {
  // The dynamic site is spelled by concatenation so this test file does not itself contain a dynamic import.
  const dynamic = "imp" + "ort(p)";
  const sites = extractImportSites(`import a from "x";\nexport * from "./y.js";\nconst z = await ${dynamic};\nconst q = require("./r.js");\n`);
  assert.deepEqual(sites.map((s) => [s.kind, s.spec]), [["static", "x"], ["export_from", "./y.js"], ["dynamic_import_expr", null], ["require", "./r.js"]]);
});

test("quarantine regions are stripped linearly and bindings after `as` are the alias", async () => {
  const { stripSurgeonQuarantineRegions, extractBindingsFromSnippet } = await import("../src/import-scanner.js");
  const start = "// GXT-SURGEON-QUARANTINE-START";
  const end = "// GXT-SURGEON-QUARANTINE-END";
  assert.equal(stripSurgeonQuarantineRegions(`a\n${start}\nx\n${end}\n\nb`), "a\nb");
  assert.equal(stripSurgeonQuarantineRegions(`a\n${start}\nx`), `a\n${start}\nx`);
  assert.equal(stripSurgeonQuarantineRegions(start.repeat(5000)).length, start.length * 5000);
  assert.deepEqual(extractBindingsFromSnippet('import { a as b, type T, c } from "x"'), ["b", "c"]);
  assert.deepEqual(extractBindingsFromSnippet('import d, { e as f } from "x"'), ["d", "f"]);
  // No binding form matches, so the scanner falls back to its placeholder binding; the point is that it returns at all.
  assert.deepEqual(extractBindingsFromSnippet("import {{".repeat(2000)), ["__gxtImportLayer"]);
});
