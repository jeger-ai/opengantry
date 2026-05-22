import type { InitAssetSpec } from "./init-asset-catalog.js";
import { INIT_ASSET_CATALOG } from "./init-asset-catalog.js";

/** managed_strict substrate assets eligible for gapman upgrade (excludes user law / missions). */
export function upgradeEligibleAssets(assets: InitAssetSpec[]): InitAssetSpec[] {
  return assets.filter((a) => a.mode === "managed_strict");
}

export function allUpgradeEligibleFromCatalog(): InitAssetSpec[] {
  return upgradeEligibleAssets([...INIT_ASSET_CATALOG]);
}
