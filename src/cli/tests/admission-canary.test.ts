/**
 * MSN-0391 (#356 slice 4): canary results become capability cells. A cell is `prevention` only when the full sandbox
 * mechanism ran on the target host, its control canary passed, every canary of the family and every cross-family
 * transport canary was blocked. Anything less leaves the static cell as it is. Mostly pure; the proxy canary's
 * script is run once with node against an in-process fake proxy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  CANARY_TECHNIQUES,
  judgeBroker,
  judgeProbe,
  probeDigest,
  probedCapabilityReport,
  type CanaryOutcome,
  type ProbeRecord,
} from "#core/admission-canary.js";
import { admissionCapabilityReport, checkCapabilityReport } from "#core/admission-capabilities.js";
import { claudeSettingsToSrtConfig } from "#cage/sandbox-probe/srt-config.js";
import dgram from "node:dgram";
import {
  CANARY_SPECS,
  INHERITED_FD,
  assertSpecsComplete,
  canaryScript,
  closeFdsExec,
  judgeCanary,
  portLiteral,
  proxyConnectJs,
  snapshotTargets,
  socksConnectJs,
  udpScript,
  type CanaryContext,
} from "#cage/sandbox-probe/canaries.js";
import type { Fixture } from "#cage/sandbox-probe/fixture.js";
import { apparmorBwrapProfiles } from "#cage/sandbox-probe/host.js";
import { sandboxLaunch, strayConnections } from "#cage/sandbox-probe/probe.js";
import { resolveSandboxRuntime } from "#cage/sandbox-probe/runtime.js";

/** Every canary as wanted: blocked, and the broker socket reached. */
function allBlocked(): CanaryOutcome[] {
  return CANARY_TECHNIQUES.map((t) => ({ id: t.id, scope: t.scope, result: t.id === "broker-socket-reach" ? "effect" : "blocked", detail: "as wanted" }));
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
      seccompHelperApplied: true,
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
    assert.deepEqual(row.evidence.host, { kernel: "7.0.0-43-generic", apparmorRestrictUserns: "0", bwrap: "0.11.1", nestedUserns: true });
    assert.match(row.evidence.note ?? "", /^requires the full sandbox as probed: a process inside bwrap creates a user namespace with capabilities \(nestedUserns true/, "a proven row states its host prerequisite");
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

test("network.connect is prevention only under a strict policy with every network canary blocked (MSN-0395)", () => {
  const strict = judgeProbe(record()).find((x) => x.family === "network.connect")!;
  assert.equal(strict.level, "prevention");
  for (const id of ["connect-tcp", "connect-socks", "connect-proxy-host", "connect-proxy-adjacent", "connect-udp", "connect-ipv6"]) {
    const leaky = record({}, record().canaries.map((c) => (c.id === id ? { ...c, result: "effect" as const, detail: "the outside listener saw 1 connection(s)" } : c)));
    const v = judgeProbe(leaky).find((x) => x.family === "network.connect")!;
    assert.equal(v.level, "not-proven", id);
    assert.ok(v.reasons.some((x) => x.startsWith(`${id}: effect`)), id);
    const inconclusive = record({}, record().canaries.map((c) => (c.id === id ? { ...c, result: "inconclusive" as const } : c)));
    assert.equal(judgeProbe(inconclusive).find((x) => x.family === "network.connect")!.level, "not-proven", `${id} inconclusive`);
  }
  const noV6 = record({}, record().canaries.map((c) => (c.id === "connect-ipv6" ? { ...c, result: "not-applicable" as const } : c)));
  assert.equal(judgeProbe(noV6).find((x) => x.family === "network.connect")!.level, "prevention", "a host without IPv6 loopback has no [::1] path");
  const lax = judgeProbe(record({ mechanism: { ...record().mechanism, networkStrict: false } })).find((x) => x.family === "network.connect")!;
  assert.equal(lax.level, "not-proven");
  assert.ok(lax.reasons.some((x) => /no strictAllowlist/.test(x)), lax.reasons.join("; "));
});

test("a proven network.connect row names where Claude Code reads strictAllowlist; proven rows show the AppArmor profile state (PR #379 review)", () => {
  const host = { ...record().host, apparmorBwrapProfile: "installed" as const, apparmorUsernsRestrictProfile: "disabled" as const };
  const report = probedCapabilityReport(admissionCapabilityReport(), record({ host }));
  assert.ok(checkCapabilityReport(report).ok);
  const row = (f: string) => report.rows.find((x) => x.capabilityId === `ubuntu-26.04-x64/claude-code/${f}`)!;
  const net = row("network.connect");
  assert.equal(net.level, "prevention");
  assert.ok(net.evidence.kind === "canary");
  assert.match(net.evidence.note ?? "", /requires sandbox\.network\.strictAllowlist in user or managed settings \(or --settings\); probed with no allowedDomains/);
  assert.ok(net.evidence.kind === "canary" && net.evidence.host);
  assert.deepEqual(net.evidence.kind === "canary" ? net.evidence.host : null, { kernel: "7.0.0-43-generic", apparmorRestrictUserns: "0", bwrap: "0.11.1", nestedUserns: true, apparmorBwrapProfile: "installed", apparmorUsernsRestrictProfile: "disabled" });
  const write = row("workspace.write");
  assert.match(write.evidence.note ?? "", /AppArmor bwrap profile installed, bwrap-userns-restrict disabled/);
  assert.doesNotMatch(write.evidence.note ?? "", /strictAllowlist/, "only network.connect depends on strictAllowlist");
  assert.ok((net.evidence.note ?? "").length <= 400);
});

test("apparmorBwrapProfiles reads the profile files only: installed or absent, restrict enabled, disabled or absent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-apparmor-"));
  assert.deepEqual(apparmorBwrapProfiles(dir), { apparmorBwrapProfile: "absent", apparmorUsernsRestrictProfile: "absent" });
  fs.writeFileSync(path.join(dir, "bwrap-userns-restrict"), "profile\n");
  assert.deepEqual(apparmorBwrapProfiles(dir), { apparmorBwrapProfile: "absent", apparmorUsernsRestrictProfile: "enabled" }, "stock Ubuntu 26.04");
  fs.writeFileSync(path.join(dir, "bwrap"), "profile\n");
  fs.mkdirSync(path.join(dir, "disable"));
  fs.symlinkSync(path.join(dir, "bwrap-userns-restrict"), path.join(dir, "disable", "bwrap-userns-restrict"));
  assert.deepEqual(apparmorBwrapProfiles(dir), { apparmorBwrapProfile: "installed", apparmorUsernsRestrictProfile: "disabled" }, "the documented prerequisite");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("diagnostic mode, a missing seccomp helper, a failed control or another host never yield prevention", () => {
  const cases: [string, ProbeRecord][] = [
    ["diagnostic", record({ mechanism: { ...record().mechanism, mode: "diagnostic" } })],
    ["seccomp", record({ mechanism: { ...record().mechanism, seccompHelperApplied: false } })],
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

test("every canary technique names a probed family, the transport scope or the broker scope, once; each has a spec", () => {
  const ids = CANARY_TECHNIQUES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of CANARY_TECHNIQUES) assert.ok([...PROBED, "transport", "broker"].includes(t.scope), t.id);
  assert.doesNotThrow(() => assertSpecsComplete());
  assert.deepEqual(CANARY_SPECS.map((s) => s.id), ids, "specs run in technique order");
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

test("broker verdict: proven only when the socket is reached and its state is not, on the full mechanism", () => {
  assert.deepEqual(judgeBroker(record()), { reachable: true, stateProtected: true, proven: true, reasons: [] });
  const unreachable = allBlocked().map((c) => (c.id === "broker-socket-reach" ? { ...c, result: "blocked" as const, detail: "error EPERM" } : c));
  const v = judgeBroker(record({}, unreachable));
  assert.equal(v.reachable, false);
  assert.equal(v.proven, false);
  assert.ok(v.reasons.some((x) => /broker-socket-reach: blocked/.test(x)));
  const leaked = allBlocked().map((c) => (c.id === "broker-state" ? { ...c, result: "effect" as const, detail: "read journal.jsonl" } : c));
  assert.equal(judgeBroker(record({}, leaked)).stateProtected, false);
  const diag = judgeBroker(record({ mechanism: { ...record().mechanism, mode: "diagnostic", seccompHelperApplied: false } }));
  assert.equal(diag.reachable, true);
  assert.equal(diag.proven, false, "a diagnostic run never proves the broker either");
  assert.ok(judgeProbe(record({}, unreachable)).every((f) => f.level === "prevention"), "the broker question does not change a family cell");
});

test("resolveSandboxRuntime: only @anthropic-ai/sandbox-runtime is accepted; its version, digest and seccomp helper are read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-srt-"));
  const make = (name: string, helper: boolean): string => {
    const root = path.join(dir, name.replace(/\W/g, "_"));
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name, version: "0.0.83" }));
    fs.writeFileSync(path.join(root, "dist", "cli.js"), "#!/usr/bin/env node\n");
    if (helper) {
      fs.mkdirSync(path.join(root, "vendor", "seccomp", os.arch()), { recursive: true });
      fs.writeFileSync(path.join(root, "vendor", "seccomp", os.arch(), "apply-seccomp"), "elf");
    }
    return path.join(root, "dist", "cli.js");
  };
  const good = resolveSandboxRuntime(make("@anthropic-ai/sandbox-runtime", true), "");
  assert.equal(good.version, "0.0.83");
  assert.match(good.digest, /^[0-9a-f]{64}$/);
  assert.ok(good.seccompHelper?.endsWith("apply-seccomp"));
  const link = path.join(dir, "srt");
  fs.symlinkSync(good.cli, link);
  assert.equal(resolveSandboxRuntime(undefined, dir).digest, good.digest, "srt on PATH is followed to its package");
  const code = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (e) {
      return (e as { code?: string }).code;
    }
    return undefined;
  };
  assert.equal(code(() => resolveSandboxRuntime(make("evil-srt", true), "")), "GXT_ADMISSION_PROBE_RUNTIME");
  assert.equal(code(() => resolveSandboxRuntime(undefined, path.join(dir, "empty"))), "GXT_ADMISSION_PROBE_RUNTIME");
  assert.equal(code(() => resolveSandboxRuntime(path.join(dir, "missing"), "")), "GXT_ADMISSION_PROBE_RUNTIME");
});

/** A fixture without git or npm: enough for the outside checks. */
function bareFixture(): Fixture {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-canary-unit-")));
  const repo = path.join(base, "repo");
  const out = path.join(repo, "out");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(out, { recursive: true });
  const gitConfig = path.join(repo, ".git", "config");
  fs.writeFileSync(gitConfig, "[core]\n");
  const secrets = { ssh: "S-ssh", state: "S-state", stateEnv: "S-stateenv", journal: "S-journal", env: "S-env", launchEnv: "S-launch-1", ghToken: "S-gh-2", githubToken: "S-github-3" };
  const p = (x: string): string => path.join(base, x);
  return {
    base,
    home: p("home"),
    repo,
    out,
    tmp: p("tmp"),
    outside: p("outside"),
    stateEnv: p("state-env"),
    secrets,
    paths: { ssh: p("ssh"), state: p("state"), stateEnvFile: p("se"), journal: p("j"), env: p("env"), gitConfig, hooks: path.join(repo, ".git", "hooks"), forbidden: path.join(repo, "secret-zone", "law.txt"), workflow: path.join(repo, ".github", "workflows", "ci.yml") },
    npmTarball: null,
    brokerPolicy: p("policy.json"),
  };
}

function unitCtx(over: Partial<CanaryContext> = {}): CanaryContext {
  return { connections: new Map(), tcpPort: 4242, adjacentPort: 4243, udpPort: 4244, ipv6: false, unixSocket: "/nonexistent", hasPython: false, hasUserBus: false, broker: null, proxyControl: null, socksControl: null, hostControl: null, credentialEnvVars: [], ...over };
}

function judgeById(id: string, fx: Fixture, ctx: CanaryContext, files: Record<string, string> = {}): { result: string; detail: string } {
  const spec = CANARY_SPECS.find((s) => s.id === id)!;
  const before = snapshotTargets(spec, fx);
  fs.writeFileSync(path.join(fx.out, `${id}.ran`), "ran\n");
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(fx.out, name), text);
  return judgeCanary(spec, fx, ctx, before);
}

test("portLiteral: only an integer port in 1..65535 reaches generated canary code (CodeQL 27)", () => {
  assert.equal(portLiteral(3128), "3128");
  assert.equal(portLiteral(65535), "65535");
  for (const bad of [0, -1, 65536, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => portLiteral(bad), /invalid port/, String(bad));
  assert.throws(() => proxyConnectJs("connect-proxy", 70000), /invalid port/);
  const connectNode = CANARY_SPECS.find((s) => s.id === "connect-node")!;
  assert.throws(() => connectNode.script(bareFixture(), unitCtx({ tcpPort: "1);process.exit(9" as unknown as number })), /invalid port/);
});

test("connect-proxy sends Proxy-Authorization from the proxy URL (decoded) and records the proxy's reply", async () => {
  const fx = bareFixture();
  let seen = "";
  const proxy = net.createServer((c) => {
    c.once("data", (d) => {
      seen = String(d);
      const ok = /Proxy-Authorization: Basic (\S+)/.exec(seen)?.[1];
      const creds = ok ? Buffer.from(ok, "base64").toString("utf8") : "";
      c.write(creds === "srt.u@x:t:k" ? "HTTP/1.1 200 Connection Established\r\n\r\n" : "HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
      c.end();
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const port = (proxy.address() as net.AddressInfo).port;
  const run = (env: NodeJS.ProcessEnv): Promise<void> =>
    new Promise((resolve) => spawn(process.execPath, ["-e", proxyConnectJs("connect-proxy", 4242)], { cwd: fx.repo, env, stdio: "ignore" }).on("exit", () => resolve()));
  await run({ PATH: process.env.PATH ?? "", HTTP_PROXY: `http://srt.u%40x:t%3Ak@127.0.0.1:${port}` });
  proxy.close();
  assert.match(seen, /^CONNECT 127\.0\.0\.1:4242 HTTP\/1\.1\r\n/);
  assert.equal(fs.readFileSync(path.join(fx.out, "connect-proxy.reply"), "utf8"), "HTTP/1.1 200 Connection Established");
  await run({ PATH: process.env.PATH ?? "" });
  assert.ok(fs.existsSync(path.join(fx.out, "connect-proxy.noproxy")), "no HTTP_PROXY is recorded, not silently exited");
});

test("connect-proxy is inconclusive without a proxy or a passing positive control; otherwise the listener decides", () => {
  const ok = { ok: true, detail: "reached" };
  assert.equal(judgeById("connect-proxy", bareFixture(), unitCtx({ proxyControl: ok }), { "connect-proxy.noproxy": "no HTTP_PROXY" }).result, "inconclusive");
  assert.equal(judgeById("connect-proxy", bareFixture(), unitCtx({ proxyControl: null })).result, "inconclusive", "positive control not run");
  assert.equal(judgeById("connect-proxy", bareFixture(), unitCtx({ proxyControl: { ok: false, detail: "407" } })).result, "inconclusive", "positive control failed");
  const blocked = judgeById("connect-proxy", bareFixture(), unitCtx({ proxyControl: ok }), { "connect-proxy.reply": "HTTP/1.1 403 host is not on the allow list" });
  assert.equal(blocked.result, "blocked");
  assert.match(blocked.detail, /403/);
  assert.equal(judgeById("connect-proxy", bareFixture(), unitCtx({ proxyControl: ok, connections: new Map([["connect-proxy", 1]]) })).result, "effect");
});

/** `ls -l /proc/<pid>/fd` lines, as the canary records them. */
const fdListing = (entries: [number, string][]): string => ["total 0", ...entries.map(([n, t]) => `l-wx------ 1 u u 64 Nov 17 10:02 ${n} -> ${t}`)].join("\n") + "\n";

test("write-inherited-fd (owner decision 2026-11-17): blocked when /proc/self/fd shows no fd above 2; the observed list is in the detail", () => {
  const blocked = judgeById("write-inherited-fd", bareFixture(), unitCtx(), {
    "write-inherited-fd.fds": fdListing([[0, "socket:[347529064]"], [1, "pipe:[347480953]"], [2, "pipe:[347480953]"]]),
  });
  assert.equal(blocked.result, "blocked");
  assert.match(blocked.detail, /^no inherited fd above 2 reached the sandbox/);
  assert.match(blocked.detail, /0 socket, 1 pipe, 2 pipe/, "the observed fds, inode numbers dropped so the digest is stable");
  assert.equal(judgeById("write-inherited-fd", bareFixture(), unitCtx()).result, "inconclusive", "no fd list recorded: untested, never blocked");
  assert.equal(judgeById("write-inherited-fd", bareFixture(), unitCtx(), { "write-inherited-fd.fds": "ls: cannot access\n" }).result, "inconclusive", "an unreadable list proves nothing");
});

test("write-inherited-fd: any fd above 2 is effect unless it points into out/ or the temp dir, even with the target unchanged (PR #379 review)", () => {
  const listing = (fd: number, target: string): Record<string, string> => ({ "write-inherited-fd.fds": fdListing([[0, "/dev/null"], [1, "pipe:[1]"], [2, "pipe:[1]"], [fd, target]]) });
  const fx = bareFixture();
  const onConfig = judgeById("write-inherited-fd", fx, unitCtx(), listing(20, fx.paths.gitConfig));
  assert.equal(onConfig.result, "effect");
  assert.match(onConfig.detail, /20 -> <fixture>\/repo\/\.git\/config/);
  assert.doesNotMatch(onConfig.detail, new RegExp(fx.base), "fixture paths are normalized");
  assert.equal(judgeById("write-inherited-fd", bareFixture(), unitCtx(), listing(7, "pipe:[99]")).result, "effect", "a pipe or socket above 2 leads outside the sandbox");
  // Denied files inside the repository, outside .git: a contract forbidden path and a workflow.
  const fxF = bareFixture();
  const forbidden = judgeById("write-inherited-fd", fxF, unitCtx(), listing(20, fxF.paths.forbidden));
  assert.equal(forbidden.result, "effect", forbidden.detail);
  assert.match(forbidden.detail, /20 -> <fixture>\/repo\/secret-zone\/law\.txt/);
  const fxW = bareFixture();
  assert.equal(judgeById("write-inherited-fd", fxW, unitCtx(), listing(21, fxW.paths.workflow)).result, "effect", "an fd on .github/workflows/ci.yml");
  const fxR = bareFixture();
  assert.equal(judgeById("write-inherited-fd", fxR, unitCtx(), listing(4, path.join(fxR.repo, "notes.txt"))).result, "effect", "any other repository file or directory counts too");
  assert.equal(judgeById("write-inherited-fd", fxR, unitCtx(), listing(4, fxR.repo)).result, "effect", "a directory fd");
  const fxO = bareFixture();
  const inside = judgeById("write-inherited-fd", fxO, unitCtx(), listing(4, path.join(fxO.out, "log.txt")));
  assert.equal(inside.result, "blocked", "an fd into the canary's own out/ reaches nothing denied");
  assert.match(inside.detail, /all inside out\/ or the temp dir/);
  const fxT = bareFixture();
  assert.equal(judgeById("write-inherited-fd", fxT, unitCtx(), listing(4, path.join(fxT.tmp, "x"))).result, "blocked", "and the temp dir");
});

/**
 * Run the real canary script outside any sandbox, through the probe's own fd sanitizer (closeFdsExec): every fd above
 * 2 is closed first, whatever the test runner inherited (GitHub's runner hands its children pipes such as fd 142 and
 * 145), and with `inherit` fd 20 is open for append on .git/config, past the closed gap 3..19.
 */
function runFdCanaryUnsandboxed(fx: Fixture, inherit: boolean): Promise<void> {
  const spec = CANARY_SPECS.find((s) => s.id === "write-inherited-fd")!;
  const fd = inherit ? fs.openSync(spec.inheritFd!(fx), "a") : null;
  const stdio: ("ignore" | number)[] = ["ignore", "ignore", "ignore"];
  if (fd !== null) {
    while (stdio.length < INHERITED_FD) stdio.push("ignore");
    stdio.push(fd);
  }
  return new Promise((resolve) => {
    spawn("bash", ["-c", closeFdsExec(fd !== null ? [INHERITED_FD] : []), "og-canary-harness", "bash", "-c", canaryScript(spec, fx, unitCtx())], { cwd: fx.repo, stdio }).on("exit", () => {
      if (fd !== null) fs.closeSync(fd);
      resolve();
    });
  });
}

test("write-inherited-fd harness: the real script, given an inherited fd 20 past a gap, writes through it and is judged effect; without one, blocked", { skip: process.platform !== "linux" ? "needs /proc/self/fd (Linux)" : false }, async () => {
  const spec = CANARY_SPECS.find((s) => s.id === "write-inherited-fd")!;
  const leaky = bareFixture();
  const before = snapshotTargets(spec, leaky);
  await runFdCanaryUnsandboxed(leaky, true);
  const effect = judgeCanary(spec, leaky, unitCtx(), before);
  assert.equal(effect.result, "effect", effect.detail);
  assert.match(fs.readFileSync(leaky.paths.gitConfig, "utf8"), /\[fd\]/, "the script wrote through the inherited fd");
  assert.match(effect.detail, /\(observed fds: 0 \/dev\/null, 1 \/dev\/null, 2 \/dev\/null, 20 -> <fixture>\/repo\/\.git\/config\)$/, "exactly stdio and fd 20");
  const clean = bareFixture();
  const cleanBefore = snapshotTargets(spec, clean);
  await runFdCanaryUnsandboxed(clean, false);
  const blocked = judgeCanary(spec, clean, unitCtx(), cleanBefore);
  assert.equal(blocked.result, "blocked", blocked.detail);
  assert.match(blocked.detail, /^no inherited fd above 2 reached the sandbox/);
});

test("sandboxLaunch: the runtime sees stdio plus fd 20 only; fds the probe inherited (7, 142) are closed first (PR #379 review)", { skip: process.platform !== "linux" ? "needs /proc/self/fd (Linux)" : false }, async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-")));
  const target = path.join(dir, "target.txt");
  fs.writeFileSync(target, "");
  const list = path.join(dir, "fds.txt");
  const run = (withFd: boolean): Promise<string> => {
    const fd = withFd ? fs.openSync(target, "a") : null;
    const launch = sandboxLaunch(["bash", "-c", `ls -l /proc/$$/fd > ${list}`], fd);
    assert.equal(launch.stdio.length, withFd ? INHERITED_FD + 1 : 3);
    // An outer shell plays the probe's own launcher, leaking fds 7 and 142 into the launch.
    const leak = 'exec 7</dev/null 142</dev/null; exec "$@"';
    return new Promise((resolve) => {
      spawn("bash", ["-c", leak, "leaky-launcher", launch.command, ...launch.args], { stdio: launch.stdio.map((x) => (x === "pipe" ? "ignore" : x)) }).on("exit", () => {
        if (fd !== null) fs.closeSync(fd);
        resolve(fs.readFileSync(list, "utf8"));
      });
    });
  };
  const fds = (text: string): number[] => [...text.matchAll(/ (\d+) -> /g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  // ls itself holds the directory it lists open, as fd 3: the shell's own list is what the canary records.
  const withFd = await run(true);
  assert.deepEqual(fds(withFd).filter((n) => n !== 3), [0, 1, 2, 20], withFd);
  assert.match(withFd, / 20 -> .*target\.txt$/m);
  const without = await run(false);
  assert.deepEqual(fds(without).filter((n) => n !== 3), [0, 1, 2], without);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("closeFdsExec keeps only real fds above 2", () => {
  assert.match(closeFdsExec([]), /case \$n in 0\|1\|2\)/);
  assert.match(closeFdsExec([20]), /case \$n in 0\|1\|2\|20\)/);
  for (const bad of [2, 0, -1, 1.5, 4096]) assert.throws(() => closeFdsExec([bad]), /invalid fd/, String(bad));
});

test("connect-socks speaks SOCKS5 with username/password from the proxy URL and CONNECTs to 127.0.0.1:<port>", async () => {
  const fx = bareFixture();
  let creds = "";
  let request: Buffer | null = null;
  const proxy = net.createServer((c) => {
    let step = 0;
    c.on("data", (d) => {
      if (step === 0 && d[0] === 5 && d.includes(2)) {
        step = 1;
        c.write(Buffer.from([5, 2]));
      } else if (step === 1) {
        const ul = d[1]!;
        creds = `${d.subarray(2, 2 + ul).toString()}:${d.subarray(3 + ul, 3 + ul + d[2 + ul]!).toString()}`;
        step = 2;
        c.write(Buffer.from([1, creds === "srt.u@x:t:k" ? 0 : 1]));
      } else if (step === 2) {
        step = 3;
        request = Buffer.from(d);
        c.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]));
      }
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const port = (proxy.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) =>
    spawn(process.execPath, ["-e", socksConnectJs("connect-socks", 4242)], { cwd: fx.repo, env: { PATH: process.env.PATH ?? "", HTTP_PROXY: `http://srt.u%40x:t%3Ak@127.0.0.1:${port}` }, stdio: "ignore" }).on("exit", () => resolve()),
  );
  proxy.close();
  assert.equal(creds, "srt.u@x:t:k");
  assert.deepEqual([...(request ?? Buffer.alloc(0))], [5, 1, 0, 1, 127, 0, 0, 1, 4242 >> 8, 4242 & 255]);
  assert.equal(fs.readFileSync(path.join(fx.out, "connect-socks.reply"), "utf8"), "0502 0100 05020001000000000000");
  assert.throws(() => socksConnectJs("connect-socks", 70000), /invalid port/);
});

test("connect-proxy-host CONNECTs by hostname; only 127.0.0.1 or localhost reach generated code", () => {
  assert.match(proxyConnectJs("connect-proxy-host", 4242, { host: "localhost" }), /CONNECT localhost:4242 HTTP\/1\.1/);
  assert.throws(() => proxyConnectJs("x", 4242, { host: "evil\r\nX" as "localhost" }), /invalid CONNECT host/);
});

test("connect-socks and connect-proxy-host are inconclusive without their own positive control; otherwise the listener decides", () => {
  const ok = { ok: true, detail: "reached" };
  for (const [id, key] of [["connect-socks", "socksControl"], ["connect-proxy-host", "hostControl"]] as const) {
    assert.equal(judgeById(id, bareFixture(), unitCtx({ proxyControl: ok })).result, "inconclusive", `${id}: only the HTTP control passed`);
    assert.equal(judgeById(id, bareFixture(), unitCtx({ [key]: ok }), { [`${id}.noproxy`]: "no HTTP_PROXY" }).result, "inconclusive", `${id}: no proxy`);
    assert.equal(judgeById(id, bareFixture(), unitCtx({ [key]: ok })).result, "blocked", id);
    assert.equal(judgeById(id, bareFixture(), unitCtx({ [key]: ok, connections: new Map([[id, 1]]) })).result, "effect", id);
  }
});

test("connect-proxy-adjacent: blocked only when the allowlisted port was reached and the adjacent one was not", () => {
  const id = "connect-proxy-adjacent";
  assert.equal(CANARY_SPECS.find((s) => s.id === id)!.allowListener, true, "runs with 127.0.0.1:<port> allowlisted");
  assert.match(CANARY_SPECS.find((s) => s.id === id)!.script(bareFixture(), unitCtx()), /CONNECT 127\.0\.0\.1:4243 /);
  assert.equal(judgeById(id, bareFixture(), unitCtx({ connections: new Map([[id, 1]]) })).result, "blocked");
  assert.equal(judgeById(id, bareFixture(), unitCtx({ connections: new Map([[id, 1], [`${id}@adjacent`, 1]]) })).result, "effect");
  assert.equal(judgeById(id, bareFixture(), unitCtx({ connections: new Map([[`${id}@adjacent`, 1]]) })).result, "effect");
  assert.equal(judgeById(id, bareFixture(), unitCtx()).result, "inconclusive", "nothing reached: the canary proved nothing");
});

test("connect-udp sends a datagram the outside listener sees (run unsandboxed)", { skip: process.platform !== "linux" ? "needs bash /dev/udp (Linux)" : false }, async () => {
  const fx = bareFixture();
  const udp = dgram.createSocket("udp4");
  let seen = 0;
  udp.on("message", () => seen++);
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
  const port = udp.address().port;
  await new Promise<void>((resolve) => spawn("bash", ["-c", udpScript("connect-udp", port)], { cwd: fx.repo, stdio: "ignore" }).on("exit", () => resolve()));
  await new Promise((resolve) => setTimeout(resolve, 100));
  udp.close();
  assert.ok(seen >= 1, "the datagram arrived");
  assert.equal(judgeById("connect-udp", bareFixture(), unitCtx({ connections: new Map([["connect-udp", seen]]) })).result, "effect");
  assert.equal(judgeById("connect-udp", bareFixture(), unitCtx()).result, "blocked");
  assert.equal(CANARY_SPECS.find((s) => s.id === "connect-ipv6")!.applicable!(unitCtx()), false, "no [::1] listener: not applicable");
});

test("read-env-token plants tokens in the launch environment and fails when any reaches the workspace", () => {
  const spec = CANARY_SPECS.find((s) => s.id === "read-env-token")!;
  const fx = bareFixture();
  assert.deepEqual(spec.env?.(fx), { OGCANARY_GH_TOKEN: "S-launch-1", GH_TOKEN: "S-gh-2", GITHUB_TOKEN: "S-github-3" });
  const leaked = judgeById("read-env-token", fx, unitCtx(), { "read-env-token.txt": "PATH=/bin\nOGCANARY_GH_TOKEN=S-launch-1\nGH_TOKEN=S-gh-2\n" });
  assert.equal(leaked.result, "effect");
  assert.match(leaked.detail, /\bGH_TOKEN\b/);
  assert.match(leaked.detail, /OGCANARY_GH_TOKEN/);
  assert.doesNotMatch(leaked.detail, /GITHUB_TOKEN|S-gh-2/, "names only what leaked, never the value");
  assert.match(leaked.detail, /envVars: none/);
  const clean = judgeById("read-env-token", bareFixture(), unitCtx({ credentialEnvVars: ["GH_TOKEN=deny"] }), { "read-env-token.txt": "PATH=/bin\n" });
  assert.equal(clean.result, "blocked");
  assert.match(clean.detail, /GH_TOKEN=deny/);
});

test("a connection outside every canary window poisons the run", () => {
  const known = new Set(["control-proxy", "connect-tcp"]);
  assert.equal(strayConnections(new Map([["connect-tcp", 2], ["control-proxy", 1]]), known), 0);
  assert.equal(strayConnections(new Map([["", 1], ["connect-tcp", 1]]), known), 1, "a late connection after the id reset");
  assert.equal(strayConnections(new Map([["mystery", 3]]), known), 3, "an unknown id");
  assert.equal(strayConnections(new Map([["connect-tcp@adjacent", 1]]), known), 0, "the adjacent listener counts under a known id");
  assert.equal(strayConnections(new Map([["@adjacent", 1]]), known), 1, "and outside a window it is stray");
});

test("srt config: sandbox.credentials.envVars pass through to the runtime", () => {
  const cfg = claudeSettingsToSrtConfig(
    { sandbox: { enabled: true, credentials: { envVars: [{ name: "GH_TOKEN", mode: "deny" }, { name: "GITHUB_TOKEN", mode: "deny" }] } } },
    { tmpDir: "/tmp/x", diagnostic: false },
  );
  assert.deepEqual(cfg.credentials, { envVars: [{ name: "GH_TOKEN", mode: "deny" }, { name: "GITHUB_TOKEN", mode: "deny" }] });
  assert.equal(claudeSettingsToSrtConfig({ sandbox: { enabled: true } }, { tmpDir: "/tmp/x", diagnostic: false }).credentials, undefined);
});

test("probed canary evidence names the runtime digest", () => {
  const report = probedCapabilityReport(admissionCapabilityReport(), record());
  const row = report.rows.find((r) => r.capabilityId === "ubuntu-26.04-x64/claude-code/artifact.read")!;
  assert.equal(row.evidence.kind, "canary");
  assert.equal((row.evidence as { runtimeDigest?: string }).runtimeDigest, "a".repeat(64));
});

test("generated canary scripts carry no raw <, >, / or line separator from a string literal (CodeQL 28)", () => {
  const id = "x</script>\u2028\u2029y";
  const script = proxyConnectJs(id, 3128);
  assert.ok(!script.includes("</script>") && !script.includes("\u2028") && !script.includes("\u2029"), script);
  assert.ok(script.includes("x\\u003c\\u002fscript\\u003e\\u2028\\u2029y"), "the literal is escaped, not dropped");
  assert.doesNotThrow(() => new Function(script));
});
