/** The capability matrix (MSN-0384, ADR-0063 decision 1, ADM05, ADM-T06 groundwork; owner decisions Q2 and Q8). */
import test from "node:test";
import assert from "node:assert/strict";
import { admissionCapabilityReport, checkCapabilityReport } from "../src/admission-capabilities.js";
import {
  ADMISSION_FAMILIES,
  ADMISSION_HARNESSES,
  ADMISSION_PLATFORMS,
  admissionCapabilityRowSchema,
} from "../src/schemas/admission-schema.js";

const report = admissionCapabilityReport();

test("capabilities: every platform x harness x family cell is present exactly once", () => {
  const ids = report.rows.map((r) => r.capabilityId);
  assert.equal(ids.length, ADMISSION_PLATFORMS.length * ADMISSION_HARNESSES.length * ADMISSION_FAMILIES.length);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of ADMISSION_PLATFORMS) {
    for (const h of ADMISSION_HARNESSES) {
      for (const f of ADMISSION_FAMILIES) assert.ok(ids.includes(`${p}/${h}/${f}`), `missing ${p}/${h}/${f}`);
    }
  }
  assert.deepEqual(checkCapabilityReport(report), { ok: true, report });
});

test("capabilities: no cell is prevention, and every cell cites the inventory", () => {
  for (const r of report.rows) {
    assert.notEqual(r.level, "prevention", r.capabilityId);
    assert.equal(r.evidence.kind, "inventory");
    assert.equal(r.evidence.ref, "docs/concepts/operation-admission-coverage.md");
  }
});

test("capabilities: macOS and Windows rows are only unsupported or unproven (owner decision Q8)", () => {
  for (const r of report.rows.filter((x) => x.platform !== "ubuntu-26.04-x64")) {
    assert.ok(r.level === "unsupported" || r.level === "unproven", `${r.capabilityId} is ${r.level}`);
  }
});

test("capabilities: Ubuntu 26.04 under Claude Code is at most unproven; network and delivery are unsupported everywhere", () => {
  for (const r of report.rows.filter((x) => x.platform === "ubuntu-26.04-x64" && x.harness === "claude-code")) {
    assert.ok(r.level === "unproven" || r.level === "unsupported", `${r.capabilityId} is ${r.level}`);
  }
  for (const r of report.rows.filter((x) => x.family === "network.connect" || x.family === "delivery.mutate")) assert.equal(r.level, "unsupported");
  const level = (id: string) => report.rows.find((r) => r.capabilityId === id)?.level;
  assert.equal(level("ubuntu-26.04-x64/claude-code/workspace.write"), "unproven");
  assert.equal(level("ubuntu-26.04-x64/headless/workspace.write"), "detection");
  assert.equal(level("macos-26.2-arm64/headless/workspace.write"), "unproven");
  assert.equal(level("windows-11-x64/headless/workspace.write"), "unsupported");
});

test("capabilities: a missing, duplicated or forged cell makes the report unusable", () => {
  const drop = checkCapabilityReport({ ...report, rows: report.rows.slice(1) });
  assert.equal(drop.ok, false);
  if (!drop.ok) assert.match(drop.problems.join("\n"), /missing cell ubuntu-26.04-x64\/claude-code\/artifact.read/);
  const dup = checkCapabilityReport({ ...report, rows: [...report.rows, report.rows[0]] });
  assert.equal(dup.ok, false);
  const first = report.rows[0];
  assert.equal(checkCapabilityReport({ ...report, rows: [{ ...first, level: "prevention" }, ...report.rows.slice(1)] }).ok, false);
  assert.equal(admissionCapabilityRowSchema.safeParse({ ...first, level: "prevention" }).success, false, "prevention needs a canary");
  const canary = { kind: "canary", ref: "test/canary/x.sh", probeDigest: "a".repeat(64), harnessVersion: "2.1.0" };
  assert.equal(admissionCapabilityRowSchema.safeParse({ ...first, level: "prevention", evidence: canary }).success, true);
  assert.equal(admissionCapabilityRowSchema.safeParse({ ...first, capabilityId: "windows-11-x64/claude-code/artifact.read" }).success, false);
  assert.equal(checkCapabilityReport({ ...report, rows: report.rows.map((r) => ({ ...r, platform: "wsl2" })) }).ok, false);
  assert.equal(checkCapabilityReport(null).ok, false);
});
