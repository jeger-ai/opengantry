import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { brokerRepo, openBroker, spawnMessage, writePolicy } from "./fixtures.js";

for (const trigger of ["revoke", "shutdown", "timeout"] as const) {
  test(`${trigger} empties the delegated cgroup containing a running parent and child`, async () => {
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
  });
}
