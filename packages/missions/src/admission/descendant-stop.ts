import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Each dispatch owns a fresh leaf beneath the broker's delegated cgroup v2 directory. */
export function openDescendantScope() {
  let leaf: string | undefined;
  try {
    const entry = fs.readFileSync("/proc/self/cgroup", "utf8").split("\n").find((line) => line.startsWith("0::/"));
    if (!entry) return null;
    const parent = path.join("/sys/fs/cgroup", entry.slice(3));
    if (fs.statfsSync(parent).type !== 0x63677270) return null;
    const candidate = path.join(parent, `gantry-spawn-${crypto.randomUUID()}`);
    fs.mkdirSync(candidate);
    leaf = candidate;
    fs.accessSync(path.join(leaf, "cgroup.kill"), fs.constants.W_OK);
    const membership = fs.openSync(path.join(leaf, "cgroup.procs"), "w");
    return { leaf, membership };
  } catch {
    if (leaf) fs.rmdirSync(leaf);
    return null;
  }
}

type DescendantScope = NonNullable<ReturnType<typeof openDescendantScope>>;

/** Removing the empty leaf completes cleanup and prevents any later entry into it. */
export async function stopDescendantScope(scope: DescendantScope): Promise<boolean> {
  try {
    fs.writeFileSync(path.join(scope.leaf, "cgroup.kill"), "1");
    for (let attempt = 0; attempt < 100; attempt++) {
      if (/^populated 0$/m.test(fs.readFileSync(path.join(scope.leaf, "cgroup.events"), "utf8"))) {
        fs.rmdirSync(scope.leaf);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } catch {
    // Missing delegation, unreadable evidence and concurrent removal cannot attest cleanup.
  }
  return false;
}
