export type InitAssetMode = "scaffold_only" | "managed_strict";

export interface InitAsset {
  targetPath: string;
  mode: InitAssetMode;
  executable?: boolean;
}

/** @deprecated Use INIT_ASSET_CATALOG via resolveAssetsFromProfile — types only retained for catalog specs. */
