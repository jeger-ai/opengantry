import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";

test("gen-asset-catalog: runs and produces valid catalog without repo-only scripts", () => {
  const repoRoot = getRepoRoot();
  execFileSync("node", ["scripts/gen-asset-catalog.mjs"], { cwd: repoRoot, stdio: "pipe" });
  const catalogPath = path.join(repoRoot, "templates/integrations/asset-catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as {
    schema_version: string;
    assets: { targetPath: string; tags: string[] }[];
  };
  assert.equal(catalog.schema_version, "1");
  assert.ok(catalog.assets.length > 0);
  const targets = catalog.assets.map((a) => a.targetPath);
  const unique = new Set(targets);
  assert.equal(unique.size, targets.length, "catalog must not contain duplicate targetPath values");
  assert.ok(unique.has("AGENTS.md"));
  assert.equal(unique.has("scripts/gen-asset-catalog.mjs"), false);
  assert.equal(unique.has("scripts/check-import-layers.mjs"), false);
});
