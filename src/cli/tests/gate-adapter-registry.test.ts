import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { GATE_EXEC_ADAPTERS, resolveGateExecAdapter } from "../lib/gate-adapters/registry.js";
import { getRepoRoot } from "../lib/git.js";
import { GATE_ADAPTER_IDS, isGateAdapterId } from "../lib/types.js";

describe("resolveGateExecAdapter", () => {
  it("registers every GateAdapterId", () => {
    assert.deepEqual((Object.keys(GATE_EXEC_ADAPTERS) as string[]).sort(), [...GATE_ADAPTER_IDS].sort());
    for (const id of GATE_ADAPTER_IDS) {
      assert.equal(typeof resolveGateExecAdapter(id), "function");
    }
  });

  it("undefined (mission without gate_adapter) resolves to generic", () => {
    assert.equal(resolveGateExecAdapter(undefined), GATE_EXEC_ADAPTERS.generic);
  });

  it("isGateAdapterId guards the enum", () => {
    assert.equal(isGateAdapterId("eslint"), true);
    assert.equal(isGateAdapterId("jest"), false);
    assert.equal(isGateAdapterId(undefined), false);
  });
});

describe("gate-adapters import-direction contract (ADR-0041)", () => {
  const forbidden = [
    "verify-phase-steps",
    "verify-engine",
    "verify-options",
    "verify-payload",
    "verify-failure",
    "verify-finding-gate-projector",
  ];

  it("adapter modules never import the verify engine layer", () => {
    const dir = path.join(getRepoRoot(), "src", "cli", "lib", "gate-adapters");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
    assert.ok(files.length >= 6, `expected adapter modules in ${dir}`);
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      for (const spec of source.matchAll(/from\s+"([^"]+)"/g)) {
        const target = spec[1]!;
        for (const banned of forbidden) {
          assert.ok(!target.includes(banned), `${file} imports ${target} (forbidden: ${banned})`);
        }
      }
    }
  });

  it("registry is consumed only by verify-phase-steps", () => {
    const lib = path.join(getRepoRoot(), "src", "cli", "lib");
    const importers = fs
      .readdirSync(lib)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => fs.readFileSync(path.join(lib, f), "utf8").includes("gate-adapters/registry.js"));
    assert.deepEqual(importers, ["verify-phase-steps.ts"]);
  });
});
