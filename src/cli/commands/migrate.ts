import fs from "node:fs";
import path from "node:path";
import { EXIT_CODE } from "#core/exit-codes.js";
import { REL_MANIFEST_JSON, REL_MANIFEST_YAML } from "#core/constants.js";
import { parseManifestSource } from "#core/manifest-file.js";
import type { Manifest } from "#core/manifest.js";
import { getRepoRoot } from "#git/git.js";
import { CLI_NAME } from "../lib/constants.js";
import { logError, logInfo, setExitCode, writeStdout } from "../lib/cli-io.js";
import { writeManifestYaml } from "../lib/manifest.js";

export interface MigrateManifestOptions {
  json?: boolean;
  dryRun?: boolean;
}

export interface MigrateManifestResult {
  status: "migrated" | "already_yaml" | "nothing_to_migrate";
  wrote: string | null;
  removed: string | null;
  perimeter_protected_updated: boolean;
}

/** The migrated document: the same manifest, with the YAML path in `perimeter_protected` next to the JSON one. */
export function migratedManifest(manifest: Manifest): { manifest: Manifest; perimeterUpdated: boolean } {
  const protectedPaths = manifest.perimeter_protected ?? [];
  if (!protectedPaths.includes(REL_MANIFEST_JSON) || protectedPaths.includes(REL_MANIFEST_YAML)) {
    return { manifest, perimeterUpdated: false };
  }
  const next = protectedPaths.flatMap((p) => (p === REL_MANIFEST_JSON ? [REL_MANIFEST_YAML, REL_MANIFEST_JSON] : [p]));
  return { manifest: { ...manifest, perimeter_protected: next }, perimeterUpdated: true };
}

/**
 * `gantry migrate manifest`: the deterministic path from the 3.x MANIFEST.json to MANIFEST.yaml (ADR-0047 §4).
 * Reads and validates the JSON form, writes the YAML form, removes the JSON form. Nothing else changes.
 */
export function runMigrateManifest(options: MigrateManifestOptions = {}): MigrateManifestResult {
  const root = getRepoRoot();
  const yamlAbs = path.join(root, ...REL_MANIFEST_YAML.split("/"));
  const jsonAbs = path.join(root, ...REL_MANIFEST_JSON.split("/"));
  let result: MigrateManifestResult;
  if (fs.existsSync(yamlAbs)) {
    result = { status: "already_yaml", wrote: null, removed: null, perimeter_protected_updated: false };
  } else if (!fs.existsSync(jsonAbs)) {
    result = { status: "nothing_to_migrate", wrote: null, removed: null, perimeter_protected_updated: false };
  } else {
    const parsed = parseManifestSource({ rel: REL_MANIFEST_JSON, kind: "json", text: fs.readFileSync(jsonAbs, "utf8") });
    const { manifest, perimeterUpdated } = migratedManifest(parsed);
    if (options.dryRun !== true) {
      writeManifestYaml(root, manifest);
      fs.rmSync(jsonAbs);
    }
    result = { status: "migrated", wrote: REL_MANIFEST_YAML, removed: REL_MANIFEST_JSON, perimeter_protected_updated: perimeterUpdated };
  }
  report(result, options);
  return result;
}

function report(result: MigrateManifestResult, options: MigrateManifestOptions): void {
  if (options.json === true) {
    writeStdout(JSON.stringify({ ...result, dry_run: options.dryRun === true }, null, 2));
    return;
  }
  const verb = options.dryRun === true ? "would write" : "wrote";
  if (result.status === "migrated") {
    logInfo(`${CLI_NAME} migrate manifest: ${verb} ${REL_MANIFEST_YAML} and removed ${REL_MANIFEST_JSON}`);
    if (result.perimeter_protected_updated) logInfo(`  perimeter_protected now lists ${REL_MANIFEST_YAML}`);
    logInfo("  the manifest is perimeter-protected: commit both changes in a Planner [MSN-…] commit");
  } else if (result.status === "already_yaml") {
    logInfo(`${CLI_NAME} migrate manifest: ${REL_MANIFEST_YAML} already exists; nothing to do`);
  } else {
    logError(`migrate manifest: no ${REL_MANIFEST_JSON} to migrate (run gantry init first)`);
    setExitCode(EXIT_CODE.USAGE);
  }
}
