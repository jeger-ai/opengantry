// DoD 3 (MSN-0252): with a WARM npm cache, `npx -p <packed tarball> gantry-cage --version` exits 0
// in under 1.5 s wall time. Precondition: the first (untimed) run below warms the cache for this tarball.
// The budget applies to the best of three timed warm runs (MSN-0265): one scheduler hiccup on a shared CI
// runner (macOS missed by 116 ms on a single sample) must not decide, while a consistently slow npx still
// fails on every platform. A cold cache (first ever extraction) is explicitly out of budget.
// The suite runs with --test-concurrency=1 (test:cage) so no other test file's npm work competes with the timed run.
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

  const samples = [];
  for (let i = 0; i < 3; i += 1) {
    const t0 = performance.now();
    const timed = npxCage(tarball, ["--version"], { cwd });
    samples.push(Math.round(performance.now() - t0));
    assert.equal(timed.status, 0, timed.stderr);
    assert.equal(timed.stdout.trim(), version);
  }
  const best = Math.min(...samples);
  assert.ok(
    best < NPX_WARM_BUDGET_MS,
    `best warm npx run took ${best} ms (budget ${NPX_WARM_BUDGET_MS} ms; samples ${samples.join(", ")} ms)`,
  );
});
