// DoD 3 (MSN-0252): with a WARM npm cache, `npx -p <packed tarball> opengantry-cage --version` exits 0
// in under 1.5 s wall time. Precondition: the first (untimed) run below warms the cache for this tarball;
// only the second run is measured. A cold cache (first ever extraction) is explicitly out of budget.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { NPX_WARM_BUDGET_MS, npxCage, packOnce, pkgDir, tmpDir } from "./helpers.mjs";

test("warm npx run of the packed tarball prints the version in under 1.5 s", { timeout: 120_000 }, () => {
  const tarball = packOnce();
  const version = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
  const cwd = tmpDir("opengantry-cage-npx-");

  const warm = npxCage(tarball, ["--version"], { cwd });
  assert.equal(warm.status, 0, `warm-up run failed: ${warm.stderr}`);

  const t0 = performance.now();
  const timed = npxCage(tarball, ["--version"], { cwd });
  const elapsed = performance.now() - t0;
  assert.equal(timed.status, 0, timed.stderr);
  assert.equal(timed.stdout.trim(), version);
  assert.ok(elapsed < NPX_WARM_BUDGET_MS, `warm npx took ${Math.round(elapsed)} ms (budget ${NPX_WARM_BUDGET_MS} ms)`);
});
