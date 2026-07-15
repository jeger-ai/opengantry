import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  checkArchBoundariesForFiles,
  loadTargetArchitecture,
  walkPerimeterFiles,
} from "../lib/arch/cage/target-architecture.js";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../examples/content-governance",
);

test("content-governance fixture: perimeter check fails with seeded violations", () => {
  const spec = loadTargetArchitecture(fixtureRoot);
  const files = walkPerimeterFiles(fixtureRoot, spec);
  const result = checkArchBoundariesForFiles(spec, fixtureRoot, files);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.rule_id === "forbid-cure-claim"));
  assert.ok(result.violations.some((v) => v.rule_id === "require-fda-disclaimer"));
  assert.ok(result.violations.some((v) => v.rule_id === "forbid-wrong-brand-hex"));
});

test("content-governance fixture: clean copy passes perimeter check", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-content-clean-"));
  const contentDir = path.join(tmp, "content");
  fs.mkdirSync(contentDir, { recursive: true });
  fs.copyFileSync(
    path.join(fixtureRoot, "TARGET_ARCHITECTURE.yaml"),
    path.join(tmp, "TARGET_ARCHITECTURE.yaml"),
  );
  fs.writeFileSync(
    path.join(contentDir, "only-good.md"),
    fs.readFileSync(path.join(fixtureRoot, "content", "ad-good.md"), "utf8"),
    "utf8",
  );
  const spec = loadTargetArchitecture(tmp);
  const files = walkPerimeterFiles(tmp, spec);
  const result = checkArchBoundariesForFiles(spec, tmp, files);
  assert.equal(result.ok, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});
