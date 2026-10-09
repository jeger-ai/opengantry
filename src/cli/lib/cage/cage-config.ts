import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { GantryUserError } from "../errors.js";

/** Per-project cage config at the cage root. Additive only: it can protect more, never less. */
export const CAGE_CONFIG_FILE = ".cage.yaml";

export type CageConfigMode = "revert" | "report";

/** One `protect:` entry: a root-relative path (file or directory tree) or a glob over root-relative paths. */
export interface CageProtectEntry {
  kind: "path" | "glob";
  /** Normalized POSIX value: no leading `./`, no trailing `/`. */
  value: string;
  mode: CageConfigMode;
}

export interface CageConfig {
  present: boolean;
  entries: CageProtectEntry[];
}

/** Keys that would loosen protection. Named in the error so authors know relaxation is a runtime flag. */
const SUBTRACTIVE_KEYS: ReadonlySet<string> = new Set([
  "relax",
  "exclude",
  "excludes",
  "allow",
  "allow_override",
  "allow_overrides",
  "ignore",
  "unprotect",
  "override",
  "overrides",
  "disable",
  "skip",
]);

const ENTRY_KEYS: ReadonlySet<string> = new Set(["path", "glob", "mode"]);

function configError(message: string): GantryUserError {
  return new GantryUserError(
    "CAGE_CONFIG_INVALID",
    `cage: ${CAGE_CONFIG_FILE}: ${message}`,
    `${CAGE_CONFIG_FILE} is additive only (protect: entries). Relax a rule for one run with --allow-override <path>.`,
    2,
  );
}

function unknownKey(key: string, where: string): GantryUserError {
  if (SUBTRACTIVE_KEYS.has(key)) {
    return configError(`${where}: "${key}" would remove protection; subtractive keys are not allowed`);
  }
  return configError(`${where}: unknown key "${key}"`);
}

/** Root-relative POSIX path or glob; rejects absolute, `..`, and empty values. */
export function normalizeCageRelPath(raw: string): string | null {
  const norm = raw.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (!norm || norm === "." || norm.startsWith("/") || /^[A-Za-z]:/.test(norm)) return null;
  if (norm.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) return null;
  return norm;
}

function parseEntry(raw: unknown, index: number): CageProtectEntry {
  const where = `protect[${String(index)}]`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw configError(`${where}: expected a mapping with path: or glob:`);
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ENTRY_KEYS.has(key)) throw unknownKey(key, where);
  }
  const hasPath = "path" in obj;
  if (hasPath === "glob" in obj) throw configError(`${where}: set exactly one of path: or glob:`);
  const kind = hasPath ? "path" : "glob";
  const rawValue = obj[kind];
  const value = typeof rawValue === "string" ? normalizeCageRelPath(rawValue) : null;
  if (!value) throw configError(`${where}: ${kind} must be a root-relative path without ".." or a leading "/"`);
  const mode = obj.mode ?? "revert";
  if (mode !== "revert" && mode !== "report") throw configError(`${where}: mode must be revert or report`);
  return { kind, value, mode };
}

function parseConfigText(text: string): CageConfig {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) throw configError(`invalid YAML: ${doc.errors[0]!.message.split("\n")[0]!}`);
  let data: unknown;
  try {
    // No aliases: a protect list has no use for them, and they are the YAML expansion-bomb vector.
    data = doc.toJS({ maxAliasCount: 0 });
  } catch (err) {
    throw configError(`invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (data === null || data === undefined) return { present: true, entries: [] };
  if (typeof data !== "object" || Array.isArray(data)) throw configError("expected a mapping with a protect: list");
  const obj = data as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "protect") throw unknownKey(key, "top level");
  }
  const protect = obj.protect ?? [];
  if (!Array.isArray(protect)) throw configError("protect: must be a list");
  return { present: true, entries: protect.map((e, i) => parseEntry(e, i)) };
}

/**
 * Read `.cage.yaml` at the cage root. A missing file is the zero-config default; anything unreadable,
 * malformed or subtractive throws so cage fails closed before the wrapped command runs.
 */
export function loadCageConfig(root: string): CageConfig {
  const file = path.join(root, CAGE_CONFIG_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { present: false, entries: [] };
    throw configError(`unreadable (${(err as NodeJS.ErrnoException).code ?? "ERROR"})`);
  }
  return parseConfigText(text);
}

/** `*` and `?` stay inside one path segment; `**` spans any depth (`**\/x` also matches top-level `x`). */
export function cageGlobToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    if (ch === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (ch === "*") {
      re += "[^/]*";
    } else if (ch === "?") {
      re += "[^/]";
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}
