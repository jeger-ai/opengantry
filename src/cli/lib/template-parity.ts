import fs from "node:fs";
import path from "node:path";
import { allUpgradeEligibleFromCatalog } from "./upgrade-eligible-assets.js";
import { templatePathForAsset } from "./init-asset-catalog.js";

export interface TemplateParityMismatch {
  targetPath: string;
  templatePath: string;
}

export interface TemplateParityResult {
  ok: boolean;
  mismatches: TemplateParityMismatch[];
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

/** Assert managed_strict root assets match templates/ (dogfood parity contract). */
export function assertManagedStrictParity(repoRoot: string, templatesRoot: string): TemplateParityResult {
  const mismatches: TemplateParityMismatch[] = [];

  /** Root may carry dogfood-only deltas for these managed paths. */
  const dogfoodParityExempt = new Set([".cursor/rules/opengantry-gxt-substrate.mdc"]);

  for (const asset of allUpgradeEligibleFromCatalog()) {
    if (dogfoodParityExempt.has(asset.targetPath)) continue;
    const targetAbs = path.join(repoRoot, asset.targetPath.split("/").join(path.sep));
    const templateRel = templatePathForAsset(asset);
    const templateAbs = path.join(templatesRoot, templateRel);

    if (!fs.existsSync(targetAbs)) {
      mismatches.push({ targetPath: asset.targetPath, templatePath: templateRel });
      continue;
    }
    if (!fs.existsSync(templateAbs)) {
      mismatches.push({ targetPath: asset.targetPath, templatePath: templateRel });
      continue;
    }

    const rootContent = normalizeContent(fs.readFileSync(targetAbs, "utf8"));
    const templateContent = normalizeContent(fs.readFileSync(templateAbs, "utf8"));
    if (rootContent !== templateContent) {
      mismatches.push({ targetPath: asset.targetPath, templatePath: templateRel });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}
