import crypto from "node:crypto";
import { canonicalJson } from "../canonical-json.js";
import { CONTRACT_ARRAY_KEYS, CONTRACT_BOOLEAN_KEYS, type MissionContract } from "./contract-types.js";

/**
 * POSIX separators, no leading `./`, collapsed slashes. Directory-like segments get a single
 * trailing `/` so `src/ui` and `src/ui/` hash alike; last-segment file names (contain `.`) do not.
 */
export function normalizeContractPath(raw: string): string {
  let p = raw.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  if (p.length > 1) p = p.replace(/\/+$/, "");
  if (p.length === 0) return p;
  const last = p.split("/").pop() ?? p;
  const looksLikeFile = last.includes(".") && last !== "." && last !== "..";
  return looksLikeFile || p.endsWith("/") ? p : `${p}/`;
}

function normalizeSpecifier(raw: string): string {
  return raw.trim();
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))].sort();
}

/**
 * Canonical contract form: path lists normalized + sorted + deduped, import lists trimmed +
 * sorted + deduped, empty lists and false booleans omitted. This is the only form written to
 * mission YAML and the only form hashed, so key or array order can never produce a false
 * GXT_CONTRACT_TAMPERED.
 */
export function normalizeContract(contract: MissionContract): MissionContract {
  const out: MissionContract = {};
  for (const key of CONTRACT_ARRAY_KEYS) {
    const raw = contract[key];
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const isPathList = key === "tmvc_roots" || key === "forbidden_zones";
    const values = sortedUnique(raw.map((v) => (isPathList ? normalizeContractPath(v) : normalizeSpecifier(v))));
    if (values.length > 0) out[key] = values;
  }
  for (const key of CONTRACT_BOOLEAN_KEYS) {
    if (contract[key] === true) out[key] = true;
  }
  return out;
}

export function contractSha256(contract: MissionContract): string {
  return crypto.createHash("sha256").update(canonicalJson(normalizeContract(contract)), "utf8").digest("hex");
}

/** True when the contract has no effective constraint at all. */
export function isEmptyContract(contract: MissionContract): boolean {
  return Object.keys(normalizeContract(contract)).length === 0;
}
