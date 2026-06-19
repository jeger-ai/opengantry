import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REL_NEXT_REMEDIATION } from "./constants.js";

export const REMEDIATION_SCHEMA_VERSION = 1 as const;

export interface RemediationSnapshot {
  schema_version: typeof REMEDIATION_SCHEMA_VERSION;
  written_at: string;
  source: "gapman verify";
  cleared?: true;
  phase: string;
  error_code: string;
  message: string;
  mission_file_path?: string;
  msn_id?: string;
  fix_hints: string[];
  next_actions: string[];
  failures?: string[];
  gate?: { stdout?: string; stderr?: string; exit_code?: number };
  kpi?: {
    metric?: string;
    op?: string;
    expected?: number;
    actual?: number | boolean;
    report_path?: string;
  };
}

const TMP_PREFIX = "NEXT_REMEDIATION.json.tmp.";

function remediationDir(repoRoot: string): string {
  return path.join(repoRoot, path.dirname(REL_NEXT_REMEDIATION));
}

function remediationPath(repoRoot: string): string {
  return path.join(repoRoot, REL_NEXT_REMEDIATION);
}

function tempRemediationPath(repoRoot: string): string {
  const nonce = crypto.randomBytes(4).toString("hex");
  return path.join(remediationDir(repoRoot), `${TMP_PREFIX}${process.pid}.${Date.now()}.${nonce}`);
}

function ensureRemediationDir(repoRoot: string): void {
  fs.mkdirSync(remediationDir(repoRoot), { recursive: true });
}

/** Remove abandoned temp files older than maxAgeMs (optional scavenger — not on hot write path). */
export function scavengerStaleRemediationTemps(repoRoot: string, maxAgeMs = 300_000): void {
  const dir = remediationDir(repoRoot);
  if (!fs.existsSync(dir)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.startsWith(TMP_PREFIX)) continue;
    const full = path.join(dir, entry);
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(full);
      }
    } catch {
      // ignore per-file errors
    }
  }
}

/** Atomic replace: write temp file in same directory, then rename onto target. */
export function writeRemediationSnapshot(repoRoot: string, snapshot: RemediationSnapshot): void {
  ensureRemediationDir(repoRoot);
  const target = remediationPath(repoRoot);
  const temp = tempRemediationPath(repoRoot);
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  try {
    fs.writeFileSync(temp, body, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temp, target);
  } catch (e) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // ignore cleanup failure
    }
    throw e;
  }
}

function readFileWithRetry(absPath: string, attempts = 3): string | null {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return fs.readFileSync(absPath, "utf8");
    } catch (e) {
      const errno = typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;
      if (errno === "ENOENT") return null;
      if (errno === "EBUSY" || errno === "EPERM") {
        if (i + 1 < attempts) continue;
        return null;
      }
      throw e;
    }
  }
  return null;
}

export function readRemediationSnapshot(repoRoot: string): RemediationSnapshot | null {
  const raw = readFileWithRetry(remediationPath(repoRoot));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as RemediationSnapshot;
    if (parsed.schema_version !== REMEDIATION_SCHEMA_VERSION) return null;
    if (parsed.cleared === true) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Race-safe clear: tombstone via atomic swap (never unlink-only). */
export function clearRemediationSnapshot(repoRoot: string): void {
  const tombstone: RemediationSnapshot = {
    schema_version: REMEDIATION_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    source: "gapman verify",
    cleared: true,
    phase: "cleared",
    error_code: "GXT_REMEDIATION_CLEARED",
    message: "Remediation feed cleared",
    fix_hints: [],
    next_actions: [],
  };
  writeRemediationSnapshot(repoRoot, tombstone);
}
