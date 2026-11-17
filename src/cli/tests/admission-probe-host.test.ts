/**
 * MSN-0391 (#356 slice 4): the sandbox canaries on the real host, through `gantry admission probe`. Needs Linux,
 * bwrap, socat and the sandbox runtime's `srt` on PATH; where one is missing every test here is skipped with the
 * reason, never passed. Where the bwrap nested user namespace is refused (Ubuntu's AppArmor restriction), the probe
 * must refuse in policy mode; the diagnostic run then exercises every canary for real and must prove nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import { CANARY_TECHNIQUES, type BrokerVerdict, type FamilyVerdict, type ProbeRecord } from "#core/admission-canary.js";
import { checkCapabilityReport } from "#core/admission-capabilities.js";
import type { AdmissionCapabilityReport } from "#core/schemas/admission-schema.js";
import { collectHostFacts } from "#cage/sandbox-probe/host.js";

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");
const onPath = (cmd: string): boolean => (process.env.PATH ?? "").split(path.delimiter).some((d) => d !== "" && fs.existsSync(path.join(d, cmd)));

function skipReason(): string | null {
  if (process.platform !== "linux") return `skipped: ${process.platform} is not Linux; the probe runs the bubblewrap sandbox only`;
  for (const [cmd, what] of [
    ["bwrap", "bubblewrap"],
    ["socat", "socat"],
    ["srt", "srt (@anthropic-ai/sandbox-runtime)"],
    ["npm", "npm"],
  ] as const) {
    if (!onPath(cmd)) return `skipped: ${what} is not on PATH, so the sandbox canaries cannot run on this host`;
  }
  return null;
}

const SKIP = skipReason();
const host = SKIP === null ? collectHostFacts() : null;
const opts = { skip: SKIP ?? false, timeout: 600_000 };

interface ProbeJson {
  probe: ProbeRecord;
  probeDigest: string;
  verdicts: FamilyVerdict[];
  broker: BrokerVerdict;
  report: AdmissionCapabilityReport;
}

function probe(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const env = gitChildEnv();
  delete env.GANTRY_CAGE_SESSION;
  const r = spawnSync(process.execPath, [CLI, "admission", "probe", ...args], { cwd: getRepoRoot(), encoding: "utf8", env, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function assertWellFormed(out: ProbeJson): void {
  assert.deepEqual(
    out.probe.canaries.map((c) => c.id),
    CANARY_TECHNIQUES.map((t) => t.id),
    "every canary has an outcome, in order",
  );
  assert.ok(checkCapabilityReport(out.report).ok, "the probed report is valid and complete");
  const proven = new Set(out.verdicts.filter((v) => v.level === "prevention").map((v) => `${out.probe.host.platform}/claude-code/${v.family}`));
  for (const row of out.report.rows) {
    if (row.level === "prevention") assert.ok(proven.has(row.capabilityId), `${row.capabilityId} is prevention without a proving verdict`);
  }
}

test("admission probe (policy mode): refuses where the nested user namespace is refused, else runs every canary", opts, () => {
  const r = probe(["--json"]);
  if (!host!.nestedUserns) {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const err = JSON.parse(r.stdout) as { code?: string; error?: { code?: string; message?: string } };
    assert.match(JSON.stringify(err), /GXT_ADMISSION_PROBE_UNAVAILABLE/);
    assert.match(JSON.stringify(err), /user namespace with capabilities/);
    return;
  }
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as ProbeJson;
  assertWellFormed(out);
  assert.equal(out.probe.mechanism.mode, "policy");
});

test("admission probe --diagnostic: every canary runs for real; direct attacks are blocked; nothing is proven", opts, () => {
  const r = probe(["--diagnostic", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as ProbeJson;
  assertWellFormed(out);
  assert.equal(out.probe.mechanism.mode, "diagnostic");
  assert.equal(out.probe.mechanism.seccompHelper, false);
  assert.equal(out.probe.control.ok, true, out.probe.control.detail);
  const result = (id: string): string => out.probe.canaries.find((c) => c.id === id)!.result;
  for (const id of ["read-home-secret", "read-state-dir", "read-state-dir-env", "read-journal", "read-proc-root", "read-dotdot", "write-git-config", "write-git-hooks", "write-journal", "write-state-dir", "write-forbidden-path"]) {
    assert.equal(result(id), "blocked", `${id}: ${out.probe.canaries.find((c) => c.id === id)!.detail}`);
  }
  assert.ok(out.verdicts.every((v) => v.level === "not-proven"), "a diagnostic run proves no family");
  assert.ok(out.report.rows.every((row) => row.level !== "prevention"), "and no cell");
  assert.equal(out.broker.proven, false);
  assert.equal(out.broker.stateProtected, true, "the broker's journal, broker.json, policy and exec dir stay out of reach");
});
