import fs from "node:fs";
import path from "node:path";
import { EXIT_CODE } from "#core/exit-codes.js";
import { ARCHITECTURE_POINTER_FILES, architecturePointerToYaml } from "#core/architecture-pointer-file.js";
import { GXT_CONFIG_FILES, gxtConfigToYaml } from "#core/config-file.js";
import { parseGxtConfigDocument } from "#core/config.js";
import { REL_MANIFEST_JSON, REL_MANIFEST_YAML } from "#core/constants.js";
import { parseLawFileDocument, type LawFilePair } from "#core/law-file.js";
import { MANIFEST_FILES, manifestToYaml, parseManifestSource } from "#core/manifest-file.js";
import type { Manifest } from "#core/manifest.js";
import { getRepoRoot } from "#git/git.js";
import { CLI_NAME } from "../lib/constants.js";
import { logError, logInfo, setExitCode, writeStdout } from "../lib/cli-io.js";
import { validateArchitecturePointer } from "../lib/arch/external/architecture-pointer.js";

export interface MigrateOptions {
  json?: boolean;
  dryRun?: boolean;
}

export interface MigrateResult {
  status: "migrated" | "already_yaml" | "nothing_to_migrate";
  wrote: string | null;
  removed: string | null;
  perimeter_protected_updated: boolean;
}

/** The migrated manifest: the same document, with the YAML path in `perimeter_protected` next to the JSON one. */
export function migratedManifest(manifest: Manifest): { manifest: Manifest; perimeterUpdated: boolean } {
  const protectedPaths = manifest.perimeter_protected ?? [];
  if (!protectedPaths.includes(REL_MANIFEST_JSON) || protectedPaths.includes(REL_MANIFEST_YAML)) {
    return { manifest, perimeterUpdated: false };
  }
  const next = protectedPaths.flatMap((p) => (p === REL_MANIFEST_JSON ? [REL_MANIFEST_YAML, REL_MANIFEST_JSON] : [p]));
  return { manifest: { ...manifest, perimeter_protected: next }, perimeterUpdated: true };
}

interface LawFileMigration {
  pair: LawFilePair;
  /** The JSON text becomes the YAML text; a note when the document itself changed. */
  convert: (jsonText: string) => { yamlText: string; perimeterUpdated: boolean };
  /** Extra human lines after a migration. */
  notes: (result: MigrateResult) => string[];
}

/**
 * `gantry migrate <file>`: the deterministic path from a 3.x JSON law file to its YAML form (ADR-0047 §4). The JSON
 * form is parsed strictly (a broken file is not migrated), written as YAML and removed. Nothing else changes.
 */
function migrateLawFile(m: LawFileMigration, options: MigrateOptions): MigrateResult {
  const root = getRepoRoot();
  const yamlAbs = path.join(root, ...m.pair.yaml.split("/"));
  const jsonAbs = path.join(root, ...m.pair.json.split("/"));
  let result: MigrateResult;
  if (fs.existsSync(yamlAbs)) {
    result = { status: "already_yaml", wrote: null, removed: null, perimeter_protected_updated: false };
  } else if (!fs.existsSync(jsonAbs)) {
    result = { status: "nothing_to_migrate", wrote: null, removed: null, perimeter_protected_updated: false };
  } else {
    const { yamlText, perimeterUpdated } = m.convert(fs.readFileSync(jsonAbs, "utf8"));
    if (options.dryRun !== true) {
      fs.mkdirSync(path.dirname(yamlAbs), { recursive: true });
      fs.writeFileSync(yamlAbs, yamlText, "utf8");
      fs.rmSync(jsonAbs);
    }
    result = { status: "migrated", wrote: m.pair.yaml, removed: m.pair.json, perimeter_protected_updated: perimeterUpdated };
  }
  if (options.json === true) {
    writeStdout(JSON.stringify({ ...result, dry_run: options.dryRun === true }, null, 2));
    return result;
  }
  const wrote = options.dryRun === true ? "would write" : "wrote";
  if (result.status === "migrated") {
    logInfo(`${CLI_NAME} migrate ${m.pair.migrate}: ${wrote} ${m.pair.yaml} and removed ${m.pair.json}`);
    for (const line of m.notes(result)) logInfo(`  ${line}`);
  } else if (result.status === "already_yaml") {
    logInfo(`${CLI_NAME} migrate ${m.pair.migrate}: ${m.pair.yaml} already exists; nothing to do`);
  } else {
    logError(`migrate ${m.pair.migrate}: no ${m.pair.json} to migrate`);
    setExitCode(EXIT_CODE.USAGE);
  }
  return result;
}

export function runMigrateManifest(options: MigrateOptions = {}): MigrateResult {
  return migrateLawFile(
    {
      pair: MANIFEST_FILES,
      convert: (jsonText) => {
        const parsed = parseManifestSource({ rel: REL_MANIFEST_JSON, kind: "json", text: jsonText });
        const { manifest, perimeterUpdated } = migratedManifest(parsed);
        return { yamlText: manifestToYaml(manifest), perimeterUpdated };
      },
      notes: (result) => [
        ...(result.perimeter_protected_updated ? [`perimeter_protected now lists ${REL_MANIFEST_YAML}`] : []),
        "the manifest is perimeter-protected: commit both changes in a Planner [MSN-…] commit",
      ],
    },
    options,
  );
}

export function runMigrateConfig(options: MigrateOptions = {}): MigrateResult {
  return migrateLawFile(
    {
      pair: GXT_CONFIG_FILES,
      convert: (jsonText) => ({
        yamlText: gxtConfigToYaml(parseGxtConfigDocument(parseLawFileDocument({ rel: GXT_CONFIG_FILES.json, kind: "json", text: jsonText }))),
        perimeterUpdated: false,
      }),
      notes: () => [],
    },
    options,
  );
}

export function runMigrateArchitecturePointer(options: MigrateOptions = {}): MigrateResult {
  return migrateLawFile(
    {
      pair: ARCHITECTURE_POINTER_FILES,
      convert: (jsonText) => ({
        yamlText: architecturePointerToYaml(
          validateArchitecturePointer(parseLawFileDocument({ rel: ARCHITECTURE_POINTER_FILES.json, kind: "json", text: jsonText })),
        ),
        perimeterUpdated: false,
      }),
      notes: () => [],
    },
    options,
  );
}
