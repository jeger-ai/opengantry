import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readEnvWithLegacy } from "./config-namespace.js";
import { GantryUserError } from "./errors.js";

export interface PepperKeyringEntry {
  org_id: string;
  pepper_version: number;
  pepper: string;
  active_from?: string;
  active_to?: string;
  pepper_ref?: string;
}

export const DEFAULT_PEPPER_KEYRING_REL = ".config/gantry/pepper-keyring.json" as const;

function expandHome(value: string): string {
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function defaultPepperKeyringPath(): string {
  return path.join(os.homedir(), DEFAULT_PEPPER_KEYRING_REL);
}

/** Resolve keyring path from explicit flag, GANTRY_PEPPER_KEYRING, or the default user config path. */
export function resolvePepperKeyringPath(explicit?: string): string {
  if (explicit?.trim()) return expandHome(explicit.trim());
  const env = readEnvWithLegacy("PEPPER_KEYRING");
  if (env) return expandHome(env);
  return defaultPepperKeyringPath();
}

function assertKeyringPermissions(absPath: string): void {
  const stat = fs.statSync(absPath);
  if ((stat.mode & 0o777) !== 0o600) {
    throw new GantryUserError(
      "PEPPER_KEYRING_PERMISSIONS",
      `pepper keyring must have mode 0600: ${absPath}`,
      `chmod 600 ${absPath}`,
      2,
    );
  }
}

function parsePepperVersion(raw: unknown, index: number): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new GantryUserError(
      "PEPPER_KEYRING_INVALID",
      `pepper keyring entry ${index}: pepper_version must be a positive integer`,
      undefined,
      2,
    );
  }
  return n;
}

function parseKeyringEntries(raw: unknown): PepperKeyringEntry[] {
  const list = Array.isArray(raw) ? raw : (raw as { entries?: unknown })?.entries;
  if (!Array.isArray(list)) {
    throw new GantryUserError(
      "PEPPER_KEYRING_INVALID",
      "pepper keyring must be a JSON array of entries",
      undefined,
      2,
    );
  }

  return list.map((item, index) => {
    const row = item as Record<string, unknown>;
    const org_id = typeof row.org_id === "string" ? row.org_id.trim() : "";
    const pepper = typeof row.pepper === "string" ? row.pepper : "";
    if (!org_id || !pepper) {
      throw new GantryUserError(
        "PEPPER_KEYRING_INVALID",
        `pepper keyring entry ${index}: org_id and pepper are required`,
        undefined,
        2,
      );
    }
    const entry: PepperKeyringEntry = {
      org_id,
      pepper_version: parsePepperVersion(row.pepper_version, index),
      pepper,
    };
    if (typeof row.active_from === "string" && row.active_from.trim()) {
      entry.active_from = row.active_from.trim();
    }
    if (typeof row.active_to === "string" && row.active_to.trim()) {
      entry.active_to = row.active_to.trim();
    }
    if (typeof row.pepper_ref === "string" && row.pepper_ref.trim()) {
      entry.pepper_ref = row.pepper_ref.trim();
    }
    return entry;
  });
}

export function loadPepperKeyring(keyringPath?: string): PepperKeyringEntry[] {
  const abs = resolvePepperKeyringPath(keyringPath);
  if (!fs.existsSync(abs)) {
    throw new GantryUserError(
      "PEPPER_KEYRING_MISSING",
      `pepper keyring not found: ${abs}`,
      "create the keyring or set GANTRY_PEPPER_KEYRING",
      2,
    );
  }
  assertKeyringPermissions(abs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    throw new GantryUserError(
      "PEPPER_KEYRING_INVALID",
      `pepper keyring is not valid JSON: ${abs}`,
      undefined,
      2,
    );
  }
  return parseKeyringEntries(parsed);
}

export function listOrgIds(entries: PepperKeyringEntry[]): string[] {
  return [...new Set(entries.map((e) => e.org_id))].sort();
}

export function getPeppersForOrg(entries: PepperKeyringEntry[], orgId: string): PepperKeyringEntry[] {
  return entries
    .filter((e) => e.org_id === orgId)
    .sort((a, b) => a.pepper_version - b.pepper_version);
}

export function isPepperActive(entry: PepperKeyringEntry, now = new Date()): boolean {
  if (entry.active_from) {
    const from = new Date(entry.active_from);
    if (Number.isNaN(from.getTime()) || now < from) return false;
  }
  if (entry.active_to) {
    const to = new Date(entry.active_to);
    if (Number.isNaN(to.getTime()) || now >= to) return false;
  }
  return true;
}

export function filterEpochs(
  peppers: PepperKeyringEntry[],
  epochsSpec: string,
  now = new Date(),
): PepperKeyringEntry[] {
  const spec = epochsSpec.trim().toLowerCase();
  if (spec === "all") return peppers;

  if (spec === "current") {
    const hasEpochMetadata = peppers.some((p) => p.active_from || p.active_to);
    if (hasEpochMetadata) {
      const active = peppers.filter((p) => isPepperActive(p, now));
      if (active.length > 0) return active;
    }
    if (peppers.length === 0) return peppers;
    const maxVersion = Math.max(...peppers.map((p) => p.pepper_version));
    return peppers.filter((p) => p.pepper_version === maxVersion);
  }

  const versions = new Set(
    spec
      .split(",")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 1),
  );
  if (versions.size === 0) {
    throw new GantryUserError(
      "PEPPER_EPOCHS_INVALID",
      `invalid --epochs value: ${epochsSpec}`,
      "use current, all, or a comma-separated list like 1,3",
      2,
    );
  }
  return peppers.filter((p) => versions.has(p.pepper_version));
}
