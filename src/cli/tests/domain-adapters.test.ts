import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runDiscoveryScan } from "../lib/discovery-scanner.js";
import { getDomainAdapter, listDomainKeys } from "../lib/domains/index.js";
import {
  checkArchBoundariesForFiles,
  validateTargetArchitecture,
} from "../lib/target-architecture.js";
import YAML from "yaml";

describe("domain adapters", () => {
  it("registers built-in code and content adapters", () => {
    assert.deepEqual(listDomainKeys(), ["code", "content"]);
    assert.equal(getDomainAdapter("code").key, "code");
    assert.equal(getDomainAdapter("content").key, "content");
  });

  it("code discovery defaults to code domain", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-domain-code-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    for (let i = 0; i < 4; i++) {
      fs.writeFileSync(
        path.join(root, "src", `a${i}.ts`),
        `import { x } from "@app/lib";\nexport const v = x;\n`,
        "utf8",
      );
    }
    const proposal = runDiscoveryScan(root);
    assert.equal(proposal.domain, "code");
    assert.ok(proposal.conventions.length >= 0);
  });

  it("content discovery detects verbatim boilerplate without heuristics", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-domain-content-"));
    const contentDir = path.join(root, "content");
    fs.mkdirSync(contentDir, { recursive: true });
    const disclaimer =
      "These statements have not been evaluated by the FDA.\nThis product is not intended to diagnose, treat, cure, or prevent any disease.\n";
    fs.writeFileSync(path.join(contentDir, "ad-a.md"), `# Ad A\n\n${disclaimer}`, "utf8");
    fs.writeFileSync(path.join(contentDir, "ad-b.md"), `# Ad B\n\n${disclaimer}`, "utf8");
    fs.writeFileSync(path.join(contentDir, "ad-c.md"), `# Ad C\n\nNo disclaimer here.\n`, "utf8");

    const proposal = runDiscoveryScan(root, { domain: "content" });
    assert.equal(proposal.domain, "content");
    assert.ok(proposal.conventions.length >= 1);
    assert.ok(proposal.anomalies.length >= 1);
    const stripDuration = (p: ReturnType<typeof runDiscoveryScan>) => {
      const clone = structuredClone(p);
      clone.scan_stats.duration_ms = 0;
      return JSON.stringify(clone);
    };
    assert.equal(stripDuration(proposal), stripDuration(runDiscoveryScan(root, { domain: "content" })));
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
