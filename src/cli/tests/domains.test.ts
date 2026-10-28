import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { domainSpec, walkDomainFiles } from "#missions/arch/domains.js";
import {
  checkArchBoundariesForFiles,
  validateTargetArchitecture,
} from "#missions/arch/target-architecture.js";
import YAML from "yaml";

describe("domains", () => {
  it("code and content are built in; unknown domains are refused", () => {
    assert.equal(domainSpec("code").importRules, true);
    assert.equal(domainSpec(" Content ").importRules, false);
    assert.throws(() => domainSpec("video"), /unknown domain: video/);
  });

  it("walkDomainFiles matches extensions and skips dot and build directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-domain-walk-"));
    for (const rel of ["content/a.md", "content/B.MD", "content/c.ts", "node_modules/x.md", ".cache/y.md"]) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), "x\n", "utf8");
    }
    const rels = walkDomainFiles(root, domainSpec("content").extensions).map((f) => path.relative(root, f));
    assert.deepEqual(rels, ["content/B.MD", "content/a.md"]);
  });

  it("content perimeter forbid_pattern and require_pattern are deterministic", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-perimeter-content-"));
    const contentDir = path.join(root, "content");
    fs.mkdirSync(contentDir, { recursive: true });
    fs.writeFileSync(
      path.join(contentDir, "good.md"),
      "# Good\nBrand color #1A2B3C\nFDA disclaimer here.\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(contentDir, "bad.md"),
      "# Bad\nCures cancer instantly.\nBrand #FF0000\n",
      "utf8",
    );
    const spec = validateTargetArchitecture(
      YAML.parse(`schema_version: "0.3.0"
domain: content
scan_roots:
  - content
layers:
  - id: content
    globs:
      - content/**
rules:
  - id: forbid-cure-claim
    from_layer: content
    applies_to:
      - content/**
    forbid_pattern: "(?i)cures cancer"
  - id: require-fda
    from_layer: content
    applies_to:
      - content/**
    require_pattern: "FDA"
`),
    );
    const files = [path.join(contentDir, "good.md"), path.join(contentDir, "bad.md")];
    const result = checkArchBoundariesForFiles(spec, root, files);
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.rule_id === "forbid-cure-claim"));
    assert.ok(result.violations.some((v) => v.rule_id === "require-fda"));
  });
});
