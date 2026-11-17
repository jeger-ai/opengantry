/**
 * MSN-0391 (#356 slice 4): the sandbox canaries on the real host, through `gantry admission probe`. Needs Linux,
 * bwrap, socat and the sandbox runtime's `srt` on PATH; where one is missing every test here is skipped with the
 * reason, never passed. Where the bwrap nested user namespace is refused (Ubuntu's AppArmor restriction), the probe
 * must refuse in policy mode; the diagnostic run then exercises every canary for real and must prove nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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
  assert.equal(out.probe.mechanism.networkStrict, false, "the default policy prompts for a new host");
  const network = out.verdicts.find((v) => v.family === "network.connect")!;
  assert.equal(network.level, "not-proven");
  assert.ok(network.reasons.some((x) => /no strictAllowlist/.test(x)), `the strictAllowlist reason: ${network.reasons.join("; ")}`);
  assertInheritedFdConsistent(out);
});

/**
 * write-inherited-fd (PR #379 review): the probe hands the runtime fd 20 on .git/config with fds 3..19 closed. The
 * canary must have tested (an fd list was recorded) and its result must follow the list: fd 20 inside means effect.
 */
function assertInheritedFdConsistent(out: ProbeJson): void {
  const fd = out.probe.canaries.find((c) => c.id === "write-inherited-fd")!;
  assert.match(fd.detail, /\(observed fds: 0 /, fd.detail);
  assert.equal(fd.result, / 20 -> <fixture>\/repo\/\.git\/config/.test(fd.detail) ? "effect" : "blocked", fd.detail);
  if (fd.result === "effect") assert.equal(out.verdicts.find((v) => v.family === "workspace.write")!.level, "not-proven", "an fd that reached the sandbox leaves workspace.write unproven");
}

test("admission probe --strict-network (policy mode): probes the strictAllowlist policy; network.connect is proven only if every network canary is blocked (MSN-0395)", opts, () => {
  if (!host!.nestedUserns) {
    assert.equal(probe(["--strict-network", "--json"]).status, 1, "refuses like the default policy mode");
    return;
  }
  const r = probe(["--strict-network", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as ProbeJson;
  assertWellFormed(out);
  assert.equal(out.probe.control.ok, true, out.probe.control.detail);
  assert.equal(out.probe.mechanism.networkStrict, true);
  assert.equal(out.probe.control.socks?.ok, true, out.probe.control.socks?.detail);
  assert.equal(out.probe.control.proxyHost?.ok, true, out.probe.control.proxyHost?.detail);
  const network = out.probe.canaries.filter((c) => c.scope === "network.connect");
  const level = out.verdicts.find((v) => v.family === "network.connect")!.level;
  const allBlocked = network.every((c) => c.result === "blocked" || (c.id === "connect-ipv6" && c.result === "not-applicable"));
  const transportBlocked = out.probe.canaries.filter((c) => c.scope === "transport").every((c) => c.result === "blocked" || c.result === "not-applicable");
  if (!allBlocked) assert.equal(level, "not-proven");
  else if (transportBlocked && out.probe.mechanism.seccompHelperApplied && out.probe.host.platform === "ubuntu-26.04-x64") {
    assert.equal(level, "prevention", out.verdicts.find((v) => v.family === "network.connect")!.reasons.join("; "));
    const row = out.report.rows.find((x) => x.capabilityId === "ubuntu-26.04-x64/claude-code/network.connect")!;
    assert.match(row.evidence.note ?? "", /requires sandbox\.network\.strictAllowlist in user or managed settings/);
  }
  assertInheritedFdConsistent(out);
});

test("admission probe --diagnostic: every canary runs for real; direct attacks are blocked; nothing is proven", opts, () => {
  const r = probe(["--diagnostic", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as ProbeJson;
  assertWellFormed(out);
  assert.equal(out.probe.mechanism.mode, "diagnostic");
  assert.equal(out.probe.mechanism.seccompHelperApplied, false);
  assert.equal(out.probe.control.ok, true, out.probe.control.detail);
  const result = (id: string): string => out.probe.canaries.find((c) => c.id === id)!.result;
  for (const id of ["read-home-secret", "read-state-dir", "read-state-dir-env", "read-journal", "read-proc-root", "read-dotdot", "write-git-config", "write-git-hooks", "write-journal", "write-state-dir", "write-forbidden-path"]) {
    assert.equal(result(id), "blocked", `${id}: ${out.probe.canaries.find((c) => c.id === id)!.detail}`);
  }
  assert.ok(out.verdicts.every((v) => v.level === "not-proven"), "a diagnostic run proves no family");
  assert.ok(out.report.rows.every((row) => row.level !== "prevention"), "and no cell");
  assert.equal(out.broker.proven, false);
  assert.equal(out.broker.stateProtected, true, "the broker's journal, broker.json, policy and exec dir stay out of reach");
  // The proxy canary is meaningful only with its positive control: the allowlisted port is reached.
  assert.equal(out.probe.control.proxy?.ok, true, out.probe.control.proxy?.detail);
  assert.notEqual(result("connect-proxy"), "inconclusive", out.probe.canaries.find((c) => c.id === "connect-proxy")!.detail);
  // Owner decision 2026-11-17 (MSN-0395): the canary lists /proc/self/fd inside the sandbox, with fd 20 planted past
  // the gap 3..19 (PR #379 review); the result follows what the list shows.
  assertInheritedFdConsistent(out);
  // The env canary ran and reports what the pass-through environment exposes (the policy declares no envVars here).
  assert.notEqual(result("read-env-token"), "inconclusive");
});

test("srt credentials.envVars deny withholds a declared variable; an undeclared one passes through", opts, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-srt-env-"));
  try {
    const cfg = path.join(dir, "srt.json");
    const config = { network: { allowedDomains: [], deniedDomains: [], allowAllUnixSockets: true }, filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] }, credentials: { envVars: [{ name: "GH_TOKEN", mode: "deny" }] } };
    fs.writeFileSync(cfg, JSON.stringify(config));
    const srt = (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "srt")).find((p) => fs.existsSync(p))!;
    const r = spawnSync(process.execPath, [fs.realpathSync(srt), "-s", cfg, "-c", 'echo "GH=${GH_TOKEN:-unset} OG=${OGCANARY_GH_TOKEN:-unset}"'], {
      cwd: dir,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: dir, GH_TOKEN: "OGCANARY-declared", OGCANARY_GH_TOKEN: "OGCANARY-undeclared" },
      timeout: 60_000,
    });
    assert.match(r.stdout, /GH=unset OG=OGCANARY-undeclared/, r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
