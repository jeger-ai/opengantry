import assert from "node:assert/strict";
import childProcess, { ChildProcess, execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { mock } from "node:test";
import { once } from "node:events";
import { startBroker } from "#missions/admission/serve.js";
import { admissionJournalPath } from "#missions/admission/journal-file.js";
import { CONTRACT_DIGEST, journalTrail, brokerRepo, digestOf, openBroker, spawnMessage, writePolicy } from "./fixtures.js";

const triggers = ["revoke", "shutdown", "timeout", "signal-error", "exec-status", "broker-crash"] as const;
type Trigger = (typeof triggers)[number];

async function exerciseExecStatus(requireScope: boolean): Promise<void> {
  const { root, outside } = brokerRepo();
  const { broker } = openBroker(root, writePolicy(path.join(outside, "policy.json")));
  try {
    const script = path.join(outside, "missing-interpreter");
    fs.writeFileSync(script, "#!/nonexistent/gantry-fixture-interpreter\n", { mode: 0o700 });
    const missing = await broker.handle(spawnMessage(broker, root, [script]));
    assert.equal(missing.state, "failed");
    assert.match(missing.detail ?? "", /ENOENT/);
    const message = spawnMessage(broker, root, ["/bin/sh", "-c", 'test "$0" = fixture-name && exit 127; exit 1']);
    message.args.argv[0] = "fixture-name";
    message.request.argsDigest = digestOf(message.args);
    const ran = await broker.handle(message);
    assert.equal(ran.state, "confirmed");
    assert.equal(ran.result?.exitCode, 127);
    if (requireScope) assert.equal(ran.result?.descendantCleanup, "confirmed-scope-empty");
    const value = "\u0001".repeat(8192);
    const env = { HOME: value, LANG: value, LC_ALL: value };
    const envResult = await broker.handle(spawnMessage(broker, root, ["/bin/sh", "-c",
      'test "${#HOME}" = 8192 && test "$HOME" = "$LANG" && test "$LANG" = "$LC_ALL"'], env));
    assert.equal(envResult.state, "confirmed", String(envResult.detail));
    assert.equal(envResult.result?.exitCode, 0);
    if (requireScope) {
      const message = spawnMessage(broker, root, ["/bin/true"]);
      let leaf = "";
      let fd = -1;
      const launch = mock.method(childProcess, "spawn", (_file: string, _args: string[], options: { stdio: number[] }) => {
        fd = options.stdio[5]!;
        leaf = path.dirname(fs.readlinkSync(`/proc/self/fd/${fd}`));
        throw Object.assign(new Error("fixture launch failure"), { code: "E2BIG" });
      });
      try {
        syncBuiltinESMExports();
        const failure = await broker.handle(message);
        assert.equal(failure.state, "failed");
        assert.match(failure.detail ?? "", /E2BIG/);
        assert.match(path.basename(leaf), /^gantry-spawn-/);
        assert.equal(fs.existsSync(leaf), false);
        assert.throws(() => fs.fstatSync(fd), { code: "EBADF" });
      } finally {
        launch.mock.restore();
        syncBuiltinESMExports();
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

function crashOptions(root: string, outside: string) {
  return { root, harness: "claude-code", contractDigest: CONTRACT_DIGEST, policy: path.join(outside, "policy.json"),
    socket: path.join(outside, "b.sock"), assumePlatform: "ubuntu-26.04-x64", env: { ...process.env, GANTRY_STATE_DIR: path.join(outside, "state") } };
}

async function exerciseCrash(): Promise<void> {
  const { root, outside } = brokerRepo();
  const opts = crashOptions(root, outside);
  writePolicy(opts.policy);
  const child = childProcess.spawn(process.execPath, [fileURLToPath(import.meta.url), "--crash-worker", root, outside], { stdio: "inherit" });
  const exited = once(child, "exit");
  try {
    const ready = path.join(root, "ready");
    for (let i = 0; i < 300 && !fs.existsSync(ready); i++) await new Promise(resolve => setTimeout(resolve, 10));
    const pid = fs.readFileSync(ready, "utf8").trim();
    const group = fs.readFileSync(`/proc/${pid}/cgroup`, "utf8").trim().slice(3);
    assert.match(group, /\/gantry-spawn-[a-zA-Z0-9]{6}$/);
    child.kill("SIGKILL");
    await exited;
    const leaf = path.join("/sys/fs/cgroup", group);
    assert.match(fs.readFileSync(path.join(leaf, "cgroup.events"), "utf8"), /^populated 1$/m);
    const [instance] = fs.readdirSync(path.join(outside, "state", "admission"));
    fs.unlinkSync(path.join(outside, "state", "admission", instance!, "broker.lock"));
    fs.unlinkSync(path.join(root, ".git", "opengantry-admission.lock"));
    fs.unlinkSync(opts.socket);
    const unrelated = fs.mkdtempSync(path.join(path.dirname(leaf), "gantry-spawn-"));
    try {
      const restarted = await startBroker(opts);
      try {
        assert.equal(fs.existsSync(leaf), false);
        assert.ok(fs.existsSync(unrelated), "recovery preserves another broker's leaf");
        assert.deepEqual(journalTrail(admissionJournalPath(root)!), ["decision:allow", "effect:dispatch-intent", "effect:unknown"]);
      } finally { await restarted.close(); }
    } finally { fs.rmdirSync(unrelated); }
  } finally {
    child.kill("SIGKILL");
    await exited;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

async function exerciseCancellation(trigger: Trigger): Promise<void> {
  if (trigger === "broker-crash") return exerciseCrash();
  if (trigger === "exec-status") return exerciseExecStatus(true);
  const { root, outside } = brokerRepo();
  const { broker } = openBroker(root, writePolicy(path.join(outside, "policy.json")), { spawnTimeoutMs: trigger === "timeout" ? 1500 : 15000 });
  const ready = path.join(root, "ready");
  const message = spawnMessage(broker, root, ["/bin/sh", "-c", 'sleep 12 & echo "$$ $!" > ready; wait']);
  const running = broker.handle(message);
  try {
    for (let i = 0; i < 200 && !fs.existsSync(ready); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const [parent, child] = fs.readFileSync(ready, "utf8").trim().split(" ");
    const membership = (pid: string) => fs.readFileSync(`/proc/${pid}/cgroup`, "utf8").trim();
    const group = membership(parent!);
    assert.match(group, /^0::.*\/gantry-spawn-[a-zA-Z0-9]{6}$/);
    assert.equal(membership(child!), group);
    if (trigger === "signal-error") {
      const signal = mock.method(ChildProcess.prototype, "kill", function (this: ChildProcess) {
        this.emit("error", Object.assign(new Error("simulated signal failure"), { code: "EPERM" }));
        return false;
      });
      try {
        broker.revoke();
        assert.equal(signal.mock.callCount(), 1);
      } finally {
        signal.mock.restore();
      }
    }
    if (trigger === "revoke") broker.revoke();
    if (trigger === "shutdown") broker.beginShutdown();
    const result = await running;
    assert.equal(result.state, "unknown");
    assert.equal(result.result?.descendantCleanup, "confirmed-scope-empty");
    assert.equal(fs.existsSync(path.join("/sys/fs/cgroup", group.slice(3))), false);
  } finally {
    broker.revoke();
    await running;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

const workerTrigger = triggers.find((trigger) => process.argv[2] === `--exercise=${trigger}`);
if (process.argv[2] === "--crash-worker") {
  const root = process.argv[3]!;
  const { broker } = await startBroker(crashOptions(root, process.argv[4]!));
  await broker.handle(spawnMessage(broker, root, ["/bin/sh", "-c", "echo $$ > ready; exec sleep 15"]));
} else if (workerTrigger) {
  await exerciseCancellation(workerTrigger);
} else {
  test("Linux broker distinguishes exec failure from workload exit 127", { skip: process.platform !== "linux" }, () => exerciseExecStatus(false));
  for (const trigger of triggers) {
    test(`live delegated spawn: ${trigger}`, { skip: process.env.GANTRY_REQUIRE_DELEGATED_TESTS !== "1" && "requires explicit live delegation gate" }, async () => {
      const hostedLinux = process.platform === "linux" && process.env.GITHUB_ACTIONS === "true" &&
        (process.env.RUNNER_ENVIRONMENT === "github-hosted" ||
          fs.readFileSync("/proc/self/cgroup", "utf8").includes("/system.slice/hosted-compute-agent.service"));
      if (!hostedLinux) {
        await exerciseCancellation(trigger);
        return;
      }
      // Only the service manager creates a delegated unit. The fixture runs as the runner user.
      const uid = process.getuid?.();
      const gid = process.getgid?.();
      assert.ok(uid && gid, "expected an unprivileged hosted Linux runner");
      execFileSync("/usr/bin/sudo", ["-n", "--", "/usr/bin/systemd-run", "--quiet", "--wait", "--pipe", "--collect",
        "--property=Delegate=yes", "--property=NoNewPrivileges=yes", "--property=RuntimeMaxSec=45",
        `--uid=${uid}`, `--gid=${gid}`, `--working-directory=${process.cwd()}`,
        process.execPath, fileURLToPath(import.meta.url), `--exercise=${trigger}`], { stdio: "inherit", timeout: 60000 });
    });
  }
}
