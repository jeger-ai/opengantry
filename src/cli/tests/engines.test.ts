import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getRepoRoot } from "#git/git.js";

// The packages promise `engines.node` (>=24); a runtime dependency that needs a later Node breaks that promise for
// every install on an earlier 24.x (EBADENGINE warnings, or a failed install under engine-strict). MSN-0352: sigstore 5
// needed ^24.15.0.
const require = createRequire(import.meta.url);
const semver = require("semver") as { minVersion(range: string): { version: string } | null; satisfies(version: string, range: string): boolean };

test("every runtime dependency in the lockfile accepts the lowest Node the packages promise (MSN-0352)", () => {
  const root = getRepoRoot();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { engines: { node: string } };
  const lowest = semver.minVersion(pkg.engines.node)?.version;
  assert.ok(lowest, `cannot read the lowest Node in ${pkg.engines.node}`);
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")) as { packages: Record<string, { dev?: boolean; engines?: { node?: string } }> };
  const refusing = Object.entries(lock.packages)
    .filter(([key, entry]) => key.includes("node_modules/") && !entry.dev && typeof entry.engines?.node === "string")
    .filter(([, entry]) => !semver.satisfies(lowest, entry.engines!.node!))
    .map(([key, entry]) => `${key} needs node ${entry.engines!.node!}`);
  assert.deepEqual(refusing, [], `Node ${lowest} (from engines ${pkg.engines.node}) is refused by runtime dependencies`);
});
