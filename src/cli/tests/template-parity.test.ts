import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import { allUpgradeEligibleFromCatalog } from "../lib/upgrade-eligible-assets.js";
import { templatePathForAsset } from "../lib/init-asset-catalog.js";

const DOGFOOD_PARITY_EXEMPT = new Set([".cursor/rules/opengantry-gxt-substrate.mdc"]);

test("template parity: managed_strict root assets match templates/", () => {
  const repoRoot = getRepoRoot();
  const templatesRoot = path.join(repoRoot, "templates");
  const mismatches: string[] = [];

  for (const asset of allUpgradeEligibleFromCatalog()) {
    if (DOGFOOD_PARITY_EXEMPT.has(asset.targetPath)) continue;
    const targetAbs = path.join(repoRoot, asset.targetPath.split("/").join(path.sep));
    const templateRel = templatePathForAsset(asset);
    const templateAbs = path.join(templatesRoot, templateRel);
    if (!fs.existsSync(targetAbs) || !fs.existsSync(templateAbs)) {
      mismatches.push(`${asset.targetPath} vs templates/${templateRel}`);
      continue;
    }
    const norm = (s: string) => s.replace(/\r\n/g, "\n");
    if (norm(fs.readFileSync(targetAbs, "utf8")) !== norm(fs.readFileSync(templateAbs, "utf8"))) {
      mismatches.push(`${asset.targetPath} vs templates/${templateRel}`);
    }
  }

  if (mismatches.length > 0) {
    assert.fail(`template parity mismatches (${mismatches.length}): ${mismatches.slice(0, 5).join(", ")}`);
  }
});
