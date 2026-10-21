import fs from "node:fs";
import { EXIT_CODE } from "#core/exit-codes.js";
import { REL_MANIFEST_JSON, REL_MANIFEST_YAML, CLI_NAME } from "#core/constants.js";
import { LAW_FILES, parseLawFileDocument, type LawFileId } from "#core/law-file.js";
import { validateManifestShape, type Manifest } from "#core/manifest.js";
import { getRepoRoot } from "#git/git.js";
import { readLawFileAt, repoAbs, writeLawFileYaml } from "#git/repo-text.js";
import { parsePolicyPointerDocument } from "#plane/policy-resolve.js";
import { logError, logInfo, setExitCode, writeStdout } from "../output/cli-io.js";
import { validateArchitecturePointer } from "#missions/arch/external/architecture-pointer.js";

export interface MigrateOptions {
  json?: boolean;
  dryRun?: boolean;
}

export interface MigrateResult {
  status: "migrated" | "already_yaml" | "nothing_to_migrate";
  wrote: string | null;
  removed: string | null;
  /** What the migration changed in the document itself, beyond its format. */
  changes: string[];
}

interface Migrated {
  doc: unknown;
  changes: string[];
}

/** The migrated manifest: the same document, with the YAML path in `perimeter_protected` next to the JSON one. */
export function migratedManifest(manifest: Manifest): { doc: Manifest; changes: string[] } {
  const protectedPaths = manifest.perimeter_protected ?? [];
  if (!protectedPaths.includes(REL_MANIFEST_JSON) || protectedPaths.includes(REL_MANIFEST_YAML)) return { doc: manifest, changes: [] };
  const next = protectedPaths.flatMap((p) => (p === REL_MANIFEST_JSON ? [REL_MANIFEST_YAML, REL_MANIFEST_JSON] : [p]));
  return { doc: { ...manifest, perimeter_protected: next }, changes: [`perimeter_protected now lists ${REL_MANIFEST_YAML}`] };
}

/** Each file's JSON document is validated the way its reader validates it before it is written as YAML. */
const PREPARE: Readonly<Record<LawFileId, (doc: unknown) => Migrated>> = {
  manifest: (doc) => {
    validateManifestShape(doc);
    return migratedManifest(doc);
  },
  config: (doc) => {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${LAW_FILES.config.json} must be an object`);
    return { doc, changes: [] };
  },
  "architecture-pointer": (doc) => ({ doc: validateArchitecturePointer(doc), changes: [] }),
  "policy-pointer": (doc) => ({ doc: parsePolicyPointerDocument(LAW_FILES["policy-pointer"].json, doc), changes: [] }),
};

/**
 * `gantry migrate <file>`: the deterministic path from a 3.x JSON law file to its YAML form (ADR-0047 §4). The file
 * is read as every reader reads it (the YAML form wins; both present and different fail closed); a JSON form is
 * parsed strictly (a broken file is not migrated), written as YAML and removed. Nothing else changes.
 */
export function runMigrate(id: LawFileId, options: MigrateOptions = {}): MigrateResult {
  const file = LAW_FILES[id];
  const root = getRepoRoot();
  const source = readLawFileAt(root, id);
  let result: MigrateResult;
  if (!source) {
    result = { status: "nothing_to_migrate", wrote: null, removed: null, changes: [] };
  } else if (source.kind === "yaml") {
    result = { status: "already_yaml", wrote: null, removed: null, changes: [] };
  } else {
    const { doc, changes } = PREPARE[id](parseLawFileDocument(source));
    if (options.dryRun !== true) {
      writeLawFileYaml(root, id, doc);
      fs.rmSync(repoAbs(root, source.rel));
    }
    result = { status: "migrated", wrote: file.yaml, removed: file.json, changes };
  }
  report(id, result, options);
  return result;
}

function report(id: LawFileId, result: MigrateResult, options: MigrateOptions): void {
  const file = LAW_FILES[id];
  if (options.json === true) {
    writeStdout(JSON.stringify({ ...result, dry_run: options.dryRun === true }, null, 2));
    return;
  }
  if (result.status === "migrated") {
    logInfo(`${CLI_NAME} migrate ${id}: ${options.dryRun === true ? "would write" : "wrote"} ${file.yaml} and removed ${file.json}`);
    for (const change of result.changes) logInfo(`  ${change}`);
    logInfo("  law files are Planner-owned: commit the change in a Planner [MSN-…] commit");
  } else if (result.status === "already_yaml") {
    logInfo(`${CLI_NAME} migrate ${id}: ${file.yaml} already exists; nothing to do`);
  } else {
    logError(`migrate ${id}: no ${file.json} to migrate`);
    setExitCode(EXIT_CODE.USAGE);
  }
}
