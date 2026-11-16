import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getRepoRoot } from "#git/git.js";

// The packages promise `engines.node`; a runtime dependency that needs a later Node breaks that promise for every
// install on an earlier supported version (EBADENGINE warnings, or a failed install under engine-strict). MSN-0352:
// sigstore 5 needed ^24.15.0, so 4.x stayed on sigstore 4. MSN-0377: the next major raises the floor to
// `^24.15.0 || >=26`, so the lowest version of every range in it (24.15.0 and 26.0.0) must be accepted.
const require = createRequire(import.meta.url);
const semver = require("semver") as { minVersion(range: string): { version: string } | null; satisfies(version: string, range: string): boolean };

const FLOOR = "^24.15.0 || >=26";

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function lowestOfEachRange(range: string): string[] {
  return range.split("||").map((part) => {
    const lowest = semver.minVersion(part.trim())?.version;
    assert.ok(lowest, `cannot read the lowest Node in ${part.trim()}`);
    return lowest;
  });
}

test("the root package and both slim packages promise the same Node floor (MSN-0377)", () => {
  const root = getRepoRoot();
  for (const rel of ["package.json", "packages/opengantry-verify/package.json", "packages/opengantry-cage/package.json"]) {
    const pkg = readJson<{ engines: { node: string } }>(path.join(root, rel));
    assert.equal(pkg.engines.node, FLOOR, `${rel} engines.node`);
  }
});

test("every runtime dependency in the lockfile accepts the lowest Node of every range the packages promise (MSN-0352, MSN-0377)", () => {
  const root = getRepoRoot();
  const pkg = readJson<{ engines: { node: string } }>(path.join(root, "package.json"));
  const lowest = lowestOfEachRange(pkg.engines.node);
  const lock = readJson<{ packages: Record<string, { dev?: boolean; engines?: { node?: string } }> }>(path.join(root, "package-lock.json"));
  const refusing = Object.entries(lock.packages)
    .filter(([key, entry]) => key.includes("node_modules/") && !entry.dev && typeof entry.engines?.node === "string")
    .flatMap(([key, entry]) =>
      lowest.filter((version) => !semver.satisfies(version, entry.engines!.node!)).map((version) => `${key} needs node ${entry.engines!.node!} (refuses ${version})`),
    );
  assert.deepEqual(refusing, [], `Node ${lowest.join(", ")} (from engines ${pkg.engines.node}) is refused by runtime dependencies`);
});
