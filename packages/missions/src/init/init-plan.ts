import fs from "node:fs";
import path from "node:path";
import { SILENT, type Diagnostics } from "../diagnostics.js";
import type { InitAsset } from "./init-asset-catalog.js";
import { templatePathForAsset, type InitAssetSpec } from "./init-asset-catalog.js";

export interface PlannedWrite {
  absoluteTarget: string;
  body: string;
  executable: boolean;
}

export interface InitPlanResult {
  ok: boolean;
  writes: PlannedWrite[];
  skippedUserMutable: string[];
  unchanged: string[];
  conflicts: string[];
}

/** Caller-supplied template post-processing (e.g. profile-specific config merges). */
export type InitBodyTransform = (body: string, targetPath: string) => string;

export function planInitAssets(
  assets: (InitAsset | InitAssetSpec)[],
  templatesRoot: string,
  repoRoot: string,
  force: boolean,
  transformBody?: InitBodyTransform,
  log: Diagnostics = SILENT,
): InitPlanResult {
  const writes: PlannedWrite[] = [];
  const conflicts: string[] = [];
  const skippedUserMutable: string[] = [];
  const unchanged: string[] = [];

  for (const asset of assets) {
    const spec = asset as InitAssetSpec;
    const templateRel = "templatePath" in spec && spec.templatePath
      ? spec.templatePath
      : templatePathForAsset(spec);
    const templateAbs = path.join(templatesRoot, templateRel.split("/").join(path.sep));
    const targetAbs = path.join(repoRoot, asset.targetPath.split("/").join(path.sep));
    if (!fs.existsSync(templateAbs)) {
      log.error(`init: missing template for ${asset.targetPath} at ${templateAbs}`);
      return { ok: false, writes, skippedUserMutable, unchanged, conflicts };
    }
    const bodyRaw = fs.readFileSync(templateAbs, "utf8");
    const body = transformBody ? transformBody(bodyRaw, asset.targetPath) : bodyRaw;
    const existing = fs.existsSync(targetAbs) ? fs.readFileSync(targetAbs, "utf8") : null;

    if (existing === null) {
      writes.push({ absoluteTarget: targetAbs, body, executable: asset.executable === true });
      continue;
    }
    if (existing === body) {
      unchanged.push(asset.targetPath);
      continue;
    }
    if (asset.mode === "scaffold_only") {
      skippedUserMutable.push(asset.targetPath);
      continue;
    }
    if (force) {
      writes.push({ absoluteTarget: targetAbs, body, executable: asset.executable === true });
      continue;
    }
    conflicts.push(asset.targetPath);
  }

  return { ok: true, writes, skippedUserMutable, unchanged, conflicts };
}

export function applyInitWrites(writes: PlannedWrite[]): void {
  for (const w of writes) {
    fs.mkdirSync(path.dirname(w.absoluteTarget), { recursive: true });
    fs.writeFileSync(w.absoluteTarget, w.body, "utf8");
    if (w.executable) fs.chmodSync(w.absoluteTarget, 0o755);
  }
}
