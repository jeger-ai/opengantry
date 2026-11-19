import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { brokerRepo, openBroker, spawnMessage, writePolicy } from "./fixtures.js";

const triggers = ["revoke", "shutdown", "timeout"] as const;
type Trigger = (typeof triggers)[number];

async function exerciseCancellation(trigger: Trigger): Promise<void> {
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
if (workerTrigger) {
  await exerciseCancellation(workerTrigger);
} else {
  for (const trigger of triggers) {
    test(`${trigger} empties the delegated cgroup containing a running parent and child`, async () => {
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
