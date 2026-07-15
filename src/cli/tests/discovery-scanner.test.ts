import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, it } from "node:test";
import { applyDiscoveryProposal, emitDiscoveryProposal } from "../lib/discovery-proposal.js";
import { runDiscoveryScan, serializeDiscoveryProposal } from "../lib/discovery-scanner.js";
import { validateTargetArchitecture } from "../lib/target-architecture.js";
import { runTargetArchitectureDoctorChecks } from "../lib/target-architecture-doctor.js";

function writeFixtureRepo(root: string): void {
  fs.mkdirSync(path.join(root, "src", "services"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "routes"), { recursive: true });
  const svcImport = `import { db } from "@app/data/db";\nexport function svc() { return db; }\n`;
  for (let i = 0; i < 4; i++) {
    fs.writeFileSync(path.join(root, "src", "services", `svc${i}.ts`), svcImport, "utf8");
  }
  fs.writeFileSync(
    path.join(root, "src", "routes", "odd.ts"),
    `import fs from "node:fs";\nexport default () => fs;\n`,
    "utf8",
  );
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(
      path.join(root, "src", "routes", `route${i}.ts`),
      `import { svc } from "../services/svc0";\nexport default svc;\n`,
      "utf8",
    );
  }
}

function writeLargeFixture(root: string, fileCount: number): void {
  fs.mkdirSync(path.join(root, "src", "bulk"), { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(
      path.join(root, "src", "bulk", `file${i}.ts`),
      `import { x } from "@app/lib/util";\nexport const v${i} = x;\n`,
      "utf8",
    );
  }
}

describe("discovery-scanner", () => {
  it("emits conventions, anomalies, and deterministic proposal JSON", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-discover-"));
    writeFixtureRepo(root);
    const first = runDiscoveryScan(root);
    const second = runDiscoveryScan(root);
    assert.ok(first.conventions.length >= 1);
    assert.ok(first.anomalies.length >= 1);
    const stripDuration = (p: ReturnType<typeof runDiscoveryScan>) => {
      const clone = structuredClone(p);
      clone.scan_stats.duration_ms = 0;
      return serializeDiscoveryProposal(clone);
    };
    assert.equal(stripDuration(first), stripDuration(second));
  });

  it("emitDiscoveryProposal writes only proposal file before apply", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-discover-"));
    writeFixtureRepo(root);
    const { proposalPath } = emitDiscoveryProposal(root);
    assert.ok(fs.existsSync(path.join(root, proposalPath)));
    assert.equal(fs.existsSync(path.join(root, "TARGET_ARCHITECTURE.yaml")), false);
    assert.equal(fs.existsSync(path.join(root, ".gitagent", "foreman", "MANIFEST.json")), false);
    const applied = applyDiscoveryProposal(root, JSON.parse(fs.readFileSync(path.join(root, proposalPath), "utf8")));
    assert.ok(applied.targetArchitecturePath);
    const spec = validateTargetArchitecture(
      YAML.parse(fs.readFileSync(path.join(root, "TARGET_ARCHITECTURE.yaml"), "utf8")),
    );
    assert.ok(spec.layers.length >= 1);
    const doctor = runTargetArchitectureDoctorChecks(root);
    assert.ok(doctor.some((l) => l.level === "ok"));
  });

  it("completes large-repo scan within performance budget", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-discover-large-"));
    writeLargeFixture(root, 5000);
    const proposal = runDiscoveryScan(root);
    assert.equal(proposal.scan_stats.files_scanned, 5000);
    assert.ok(
      proposal.scan_stats.duration_ms < 5000,
      `expected <5000ms, got ${proposal.scan_stats.duration_ms}ms`,
    );
  });
});
