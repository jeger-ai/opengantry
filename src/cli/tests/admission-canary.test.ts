/**
 * MSN-0391 (#356 slice 4): canary results become capability cells. A cell is `prevention` only when the full sandbox
 * mechanism ran on the target host, its control canary passed, every canary of the family and every cross-family
 * transport canary was blocked. Anything less leaves the static cell as it is. Pure tests: no process is spawned.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CANARY_TECHNIQUES,
  judgeProbe,
  probeDigest,
  probedCapabilityReport,
  type CanaryOutcome,
  type ProbeRecord,
} from "#core/admission-canary.js";
import { admissionCapabilityReport, checkCapabilityReport } from "#core/admission-capabilities.js";
import { claudeSettingsToSrtConfig } from "#cage/sandbox-probe/srt-config.js";

function allBlocked(): CanaryOutcome[] {
  return CANARY_TECHNIQUES.map((t) => ({ id: t.id, scope: t.scope, result: "blocked", detail: "effect absent" }));
}

function record(over: Partial<ProbeRecord> = {}, canaries: CanaryOutcome[] = allBlocked()): ProbeRecord {
  return {
    schema: "opengantry.admission-probe.v1",
    host: {
      platform: "ubuntu-26.04-x64",
      osRelease: "Ubuntu 26.04.1 LTS",
      kernel: "7.0.0-43-generic",
      arch: "x64",
      apparmorRestrictUserns: "0",
      bwrap: "0.11.1",
      socat: "1.8.1.1",
      nestedUserns: true,
    },
    mechanism: {
      harness: "claude-code",
      runtime: "sandbox-runtime",
      runtimeVersion: "0.0.83",
      runtimeDigest: "a".repeat(64),
      seccompHelper: true,
      mode: "policy",
      policyDigest: "b".repeat(64),
      srtConfigDigest: "c".repeat(64),
      networkStrict: true,
    },
    control: { ok: true, detail: "control wrote and read inside the workspace" },
    canaries,
    ...over,
  };
}

const PROBED = ["artifact.read", "workspace.write", "process.spawn", "dependency.materialize", "network.connect"];

test("all canaries blocked on the full mechanism: the probed claude-code cells on Ubuntu become prevention with canary evidence", () => {
  const r = record();
  const verdicts = judgeProbe(r);
  assert.deepEqual(
    verdicts.map((v) => [v.family, v.level]),
    PROBED.map((f) => [f, "prevention"]),
  );
  const report = probedCapabilityReport(admissionCapabilityReport(), r);
  assert.ok(checkCapabilityReport(report).ok, "the probed report is valid and complete");
  const prevention = report.rows.filter((row) => row.level === "prevention");
  assert.deepEqual(prevention.map((row) => row.capabilityId).sort(), PROBED.map((f) => `ubuntu-26.04-x64/claude-code/${f}`).sort());
  for (const row of prevention) {
    assert.equal(row.evidence.kind, "canary");
    if (row.evidence.kind !== "canary") continue;
    assert.equal(row.evidence.probeDigest, probeDigest(r));
    assert.equal(row.evidence.harnessVersion, "sandbox-runtime-0.0.83");
    assert.deepEqual(row.evidence.host, { kernel: "7.0.0-43-generic", apparmorRestrictUserns: "0", bwrap: "0.11.1" });
  }
  const base = admissionCapabilityReport();
  const others = report.rows.filter((row) => !row.capabilityId.startsWith("ubuntu-26.04-x64/claude-code/"));
  assert.deepEqual(others, base.rows.filter((row) => !row.capabilityId.startsWith("ubuntu-26.04-x64/claude-code/")), "no other cell changes");
  const gitPublish = report.rows.find((row) => row.capabilityId === "ubuntu-26.04-x64/claude-code/git.publish");
  assert.equal(gitPublish?.level, "unproven", "an unprobed family keeps its static level");
});

test("a simulated canary failure yields no prevention for that family; the others still pass", () => {
  const canaries = allBlocked().map((c) => (c.id === "write-symlink-swap" ? { ...c, result: "effect" as const, detail: ".git/config changed" } : c));
  const verdicts = judgeProbe(record({}, canaries));
  const write = verdicts.find((v) => v.family === "workspace.write")!;
  assert.equal(write.level, "not-proven");
  assert.ok(write.reasons.some((x) => /write-symlink-swap: effect/.test(x)), write.reasons.join("; "));
  assert.equal(verdicts.find((v) => v.family === "artifact.read")!.level, "prevention");
  const report = probedCapabilityReport(admissionCapabilityReport(), record({}, canaries));
  const row = report.rows.find((x) => x.capabilityId === "ubuntu-26.04-x64/claude-code/workspace.write")!;
  assert.notEqual(row.level, "prevention");
});

test("an inconclusive canary is not a pass", () => {
  const canaries = allBlocked().map((c) => (c.id === "read-home-secret" ? { ...c, result: "inconclusive" as const } : c));
  assert.equal(judgeProbe(record({}, canaries)).find((v) => v.family === "artifact.read")!.level, "not-proven");
});

test("a failed transport canary (an escape through a unix socket) leaves every family unproven", () => {
  const canaries = allBlocked().map((c) => (c.id === "transport-user-bus" ? { ...c, result: "effect" as const, detail: "systemd-run wrote outside" } : c));
  const verdicts = judgeProbe(record({}, canaries));
  assert.ok(verdicts.every((v) => v.level === "not-proven"));
  assert.ok(verdicts.every((v) => v.reasons.some((x) => /transport-user-bus: effect/.test(x))));
});

test("a missing required canary is not a pass; an optional one may be not-applicable", () => {
  const without = allBlocked().filter((c) => c.id !== "read-proc-root");
  const verdict = judgeProbe(record({}, without)).find((v) => v.family === "artifact.read")!;
  assert.equal(verdict.level, "not-proven");
  assert.ok(verdict.reasons.some((x) => /read-proc-root: missing/.test(x)));
  const optional = allBlocked().map((c) => (c.id === "read-python" || c.id === "transport-user-bus" ? { ...c, result: "not-applicable" as const } : c));
  assert.ok(judgeProbe(record({}, optional)).every((v) => v.level === "prevention"));
  const required = allBlocked().map((c) => (c.id === "read-home-secret" ? { ...c, result: "not-applicable" as const } : c));
  assert.equal(judgeProbe(record({}, required)).find((v) => v.family === "artifact.read")!.level, "not-proven");
});

test("diagnostic mode, a missing seccomp helper, a failed control or another host never yield prevention", () => {
  const cases: [string, ProbeRecord][] = [
    ["diagnostic", record({ mechanism: { ...record().mechanism, mode: "diagnostic" } })],
    ["seccomp", record({ mechanism: { ...record().mechanism, seccompHelper: false } })],
    ["control", record({ control: { ok: false, detail: "sandbox did not start" } })],
    ["platform", record({ host: { ...record().host, platform: null } })],
  ];
  for (const [name, r] of cases) {
    const verdicts = judgeProbe(r);
    assert.ok(verdicts.every((v) => v.level === "not-proven"), name);
    const report = probedCapabilityReport(admissionCapabilityReport(), r);
    assert.ok(report.rows.every((row) => row.level !== "prevention"), name);
    assert.ok(checkCapabilityReport(report).ok, name);
  }
});

test("network.connect needs a strict allowlist: with Claude Code's prompt for a new domain it stays unproven", () => {
  const r = record({ mechanism: { ...record().mechanism, networkStrict: false } });
  const v = judgeProbe(r);
  assert.equal(v.find((x) => x.family === "network.connect")!.level, "not-proven");
  assert.ok(v.find((x) => x.family === "network.connect")!.reasons.some((x) => /prompt/.test(x)));
  assert.equal(v.find((x) => x.family === "workspace.write")!.level, "prevention");
});

test("a not-proven family on an unproven static cell carries the probe as canary evidence, its level unchanged", () => {
  const r = record({ control: { ok: false, detail: "sandbox did not start" } });
  const report = probedCapabilityReport(admissionCapabilityReport(), r);
  const read = report.rows.find((x) => x.capabilityId === "ubuntu-26.04-x64/claude-code/artifact.read")!;
  assert.equal(read.level, "unproven");
  assert.equal(read.evidence.kind, "canary");
  if (read.evidence.kind === "canary") assert.match(read.evidence.note ?? "", /control canary failed/);
  const network = report.rows.find((x) => x.capabilityId === "ubuntu-26.04-x64/claude-code/network.connect")!;
  assert.equal(network.level, "unsupported", "a static unsupported cell is not touched");
  assert.equal(network.evidence.kind, "inventory");
});

test("probeDigest is stable and binds every field", () => {
  assert.equal(probeDigest(record()), probeDigest(record()));
  assert.notEqual(probeDigest(record()), probeDigest(record({ host: { ...record().host, kernel: "7.0.0-44-generic" } })));
  assert.match(probeDigest(record()), /^[0-9a-f]{64}$/);
});

test("every canary technique names a probed family or the cross-family transport scope, once", () => {
  const ids = CANARY_TECHNIQUES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of CANARY_TECHNIQUES) assert.ok([...PROBED, "transport"].includes(t.scope), t.id);
  for (const f of PROBED) assert.ok(CANARY_TECHNIQUES.some((t) => t.scope === f && !t.optional), `${f} has a required canary`);
});

test("srt config: Claude Code's merge of sandbox paths and Read/Edit deny rules, with its path prefixes", () => {
  const settings = {
    permissions: { deny: ["Edit(/.git/hooks)", "Edit(/.git/hooks/**)", "Edit(~/.opengantry)", "Edit(//abs/zone)", "Read(**/.git/config)", "Read(**/.git/config/**)", "Read(~/.ssh)", "Bash(rm:*)"] },
    sandbox: {
      enabled: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
      filesystem: { denyWrite: ["./.git/hooks", "~/.opengantry"], denyRead: ["~/.ssh", "./**/.env"] },
      credentials: { files: [{ path: "~/.ssh", mode: "deny" }] },
    },
  };
  const cfg = claudeSettingsToSrtConfig(settings, { tmpDir: "/t/tmp", diagnostic: false });
  assert.deepEqual(cfg.filesystem.denyWrite, ["./.git/hooks", "/abs/zone", "~/.opengantry"]);
  assert.deepEqual(cfg.filesystem.denyRead, ["./**/.env", "./**/.git/config", "~/.ssh"]);
  assert.deepEqual(cfg.filesystem.allowWrite, [".", "/t/tmp"]);
  assert.deepEqual(cfg.network, { allowedDomains: [], deniedDomains: [] });
  assert.deepEqual(cfg.credentials, { files: [{ path: "~/.ssh", mode: "deny" }] });
  const diag = claudeSettingsToSrtConfig(settings, { tmpDir: "/t/tmp", diagnostic: true });
  assert.equal(diag.network.allowAllUnixSockets, true, "diagnostic: no seccomp helper, as Claude Code runs without a global srt");
  assert.throws(() => claudeSettingsToSrtConfig({ sandbox: { enabled: false } }, { tmpDir: "/t", diagnostic: false }), /sandbox\.enabled/);
});
