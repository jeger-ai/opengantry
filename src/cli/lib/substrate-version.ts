import fs from "node:fs";
import path from "node:path";
import { loadIntegrationCompat } from "./integration-compat.js";

export const REL_SUBSTRATE_VERSION = ".gitagent/foreman/SUBSTRATE.version.json" as const;

export type SubstrateVersionSource = "substrate_file" | "legacy_compat" | "legacy_default";

export interface InstalledSubstrateVersion {
  version: string;
  source: SubstrateVersionSource;
}

export interface SubstrateVersionFile {
  schema_version: string;
  opengantry_version: string;
  installed_at: string;
  installed_by: string;
}

function parseSemverParts(version: string): [number, number, number] {
  const core = version.trim().split("-")[0] ?? "0.0.0";
  const parts = core.split(".").map((p) => Number.parseInt(p, 10));
  return [
    Number.isFinite(parts[0]) ? parts[0]! : 0,
    Number.isFinite(parts[1]) ? parts[1]! : 0,
    Number.isFinite(parts[2]) ? parts[2]! : 0,
  ];
}

/** Compare semver core (major.minor.patch). Returns negative if a < b, 0 if equal, positive if a > b. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! < pb[i]!) return -1;
    if (pa[i]! > pb[i]!) return 1;
  }
  return 0;
}

export function readRepoCompatVersion(repoRoot: string): string | null {
  const compatPath = path.join(repoRoot, "integrations/compatibility.json");
  if (!fs.existsSync(compatPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(compatPath, "utf8")) as { opengantry_version?: string };
    return typeof raw.opengantry_version === "string" && raw.opengantry_version.length > 0
      ? raw.opengantry_version
      : null;
  } catch {
    return null;
  }
}

export function readInstalledSubstrateVersion(repoRoot: string): InstalledSubstrateVersion {
  const substratePath = path.join(repoRoot, REL_SUBSTRATE_VERSION.split("/").join(path.sep));
  if (fs.existsSync(substratePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(substratePath, "utf8")) as SubstrateVersionFile;
      if (typeof raw.opengantry_version === "string" && raw.opengantry_version.length > 0) {
        return { version: raw.opengantry_version, source: "substrate_file" };
      }
    } catch {
      // fall through to legacy
    }
  }

  const compatVersion = readRepoCompatVersion(repoRoot);
  if (compatVersion) {
    return { version: compatVersion, source: "legacy_compat" };
  }

  return { version: "0.0.0", source: "legacy_default" };
}

export function serializeSubstrateVersionFile(
  version: string,
  installedBy: string,
): string {
  const doc: SubstrateVersionFile = {
    schema_version: "0.1.0",
    opengantry_version: version,
    installed_at: new Date().toISOString(),
    installed_by: installedBy,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function writeSubstrateVersionFile(
  repoRoot: string,
  version: string,
  installedBy: string,
): void {
  const abs = path.join(repoRoot, REL_SUBSTRATE_VERSION.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializeSubstrateVersionFile(version, installedBy), "utf8");
}

export function alreadyCurrentMessage(installed: string, bundled: string): string {
  return [
    `Substrate is up to date (installed ${installed}, bundled ${bundled}).`,
    "To upgrade to a newer OpenGantry release, first update the package manager dependency",
    "(e.g. npm install gapman@latest) and re-run: gapman upgrade",
  ].join("\n");
}

export function ensureSubstrateVersionOnInit(repoRoot: string, templatesRoot: string): void {
  const substrateAbs = path.join(repoRoot, REL_SUBSTRATE_VERSION.split("/").join(path.sep));
  if (fs.existsSync(substrateAbs)) return;
  const version = loadIntegrationCompat(templatesRoot).opengantry_version;
  writeSubstrateVersionFile(repoRoot, version, "gapman init");
}

export function legacyVersionWarning(source: SubstrateVersionSource): string | null {
  if (source === "legacy_default") {
    return "Legacy repo detected (no SUBSTRATE.version.json); first apply will pin substrate version.";
  }
  if (source === "legacy_compat") {
    return "Inferred substrate version from integrations/compatibility.json; first apply will write SUBSTRATE.version.json.";
  }
  return null;
}
