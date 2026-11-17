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
import { CANARY_SPECS, assertSpecsComplete, judgeCanary, portLiteral, proxyConnectJs, snapshotTargets, type CanaryContext } from "#cage/sandbox-probe/canaries.js";
import type { Fixture } from "#cage/sandbox-probe/fixture.js";
import { strayConnections } from "#cage/sandbox-probe/probe.js";
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
    paths: { ssh: p("ssh"), state: p("state"), stateEnvFile: p("se"), journal: p("j"), env: p("env"), gitConfig, hooks: path.join(repo, ".git", "hooks"), forbidden: p("f"), workflow: p("w") },
    npmTarball: null,
    brokerPolicy: p("policy.json"),
  };
}

function unitCtx(over: Partial<CanaryContext> = {}): CanaryContext {
  return { connections: new Map(), tcpPort: 4242, unixSocket: "/nonexistent", hasPython: false, hasUserBus: false, broker: null, proxyControl: null, credentialEnvVars: [], ...over };
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

test("write-inherited-fd: inconclusive (untested, not blocked) when fd 3 never reached the sandbox", () => {
  const none = judgeById("write-inherited-fd", bareFixture(), unitCtx(), { "write-inherited-fd.fd3": "no\n" });
  assert.equal(none.result, "inconclusive");
  assert.match(none.detail, /srt passes only stdio/);
  assert.match(none.detail, /not blocked/);
  assert.equal(judgeById("write-inherited-fd", bareFixture(), unitCtx()).result, "inconclusive", "no record at all");
  assert.equal(judgeById("write-inherited-fd", bareFixture(), unitCtx(), { "write-inherited-fd.fd3": "yes\n" }).result, "blocked", "fd 3 present, target unchanged");
  const fx = bareFixture();
  const spec = CANARY_SPECS.find((s) => s.id === "write-inherited-fd")!;
  const before = snapshotTargets(spec, fx);
  fs.writeFileSync(path.join(fx.out, "write-inherited-fd.ran"), "ran\n");
  fs.writeFileSync(path.join(fx.out, "write-inherited-fd.fd3"), "yes\n");
  fs.appendFileSync(fx.paths.gitConfig, "[fd]\n");
  assert.equal(judgeCanary(spec, fx, unitCtx(), before).result, "effect");
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
