/** Commits whose subject starts with `[MSN-NNNN]` (ADR-0052 step 5c-ii). */
import { MSN_ID_PATTERN } from "#core/constants.js";
import { gitRun } from "./git.js";

export const ENV_MSN_SCAN_DEPTH = "GANTRY_MSN_SCAN_DEPTH" as const;
export const DEFAULT_MSN_SCAN_DEPTH = 200;

/** Resolve git-proof scan depth: explicit option, then env, then default. */
export function resolveMsnScanDepth(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const envRaw = process.env[ENV_MSN_SCAN_DEPTH];
  if (envRaw !== undefined && envRaw.trim() !== "") {
    const envParsed = Number.parseInt(envRaw.trim(), 10);
    if (Number.isFinite(envParsed) && envParsed > 0) {
      return envParsed;
    }
  }
  return DEFAULT_MSN_SCAN_DEPTH;
}

export interface MsnCommitRow {
  hash: string;
  subject: string;
  authorEmail: string;
}

/**
 * True iff the commit **subject line** (`git log` %s) begins with `[msnId]` as legislation.
 * Does not inspect the commit body — avoids matching `[MSN-…]` that appears only in the body.
 */
export function commitSubjectHasMsnPrefix(subject: string, msnId: string): boolean {
  if (!MSN_ID_PATTERN.test(msnId)) return false;
  const prefix = `[${msnId}]`;
  const s = subject.trimStart();
  return s.startsWith(prefix);
}

/**
 * Newest-first commits among the last `scanDepth` history entries whose **subject** (%s) starts
 * with `[msnId]`. Uses plain `git log` (no `--grep`) so matches cannot come from the body alone.
 */
export function listMsnSubjectCommits(
  root: string,
  msnId: string,
  scanDepth?: number,
): MsnCommitRow[] {
  const depth = resolveMsnScanDepth(scanDepth);
  const { ok, stdout, stderr } = gitRun(root, [
    "log",
    "-z",
    "--format=%H%x1f%s%x1f%aE",
    "-n",
    String(depth),
  ]);
  if (!ok) {
    throw new Error(
      `git log failed: ${stderr.trim() || stdout.trim() || "unknown"}`,
    );
  }
  if (!stdout.trim()) return [];
  const chunks = stdout.split("\0").filter((c) => c.length > 0);
  const rows: MsnCommitRow[] = [];
  for (const chunk of chunks) {
    const parts = chunk.split("\x1f");
    if (parts.length < 3) continue;
    const [hash, subject, authorEmail] = parts;
    if (!hash || !subject || !authorEmail) continue;
    if (!commitSubjectHasMsnPrefix(subject, msnId)) continue;
    rows.push({ hash, subject, authorEmail });
  }
  return rows;
}

