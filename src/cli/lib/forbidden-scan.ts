import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { toPosixRel } from "./cli-io.js";

export interface ForbiddenFileState {
  repoRelPath: string;
  exists: boolean;
  size: number;
  mtimeMs: number;
  sha256: string;
}

export interface ForbiddenScanBaseline {
  repoRoot: string;
  files: Record<string, ForbiddenFileState>;
}

export interface ForbiddenViolation {
  kind: "added" | "modified" | "deleted";
  path: string;
}

const MAX_HASH_BYTES = 10 * 1024 * 1024;

function toRepoRelativePosix(repoRoot: string, absolutePath: string): string {
  return toPosixRel(repoRoot, absolutePath);
}

function hashBuffer(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hashFile(absPath: string): string {
  const stat = fs.statSync(absPath);
  if (stat.size > MAX_HASH_BYTES) {
    // Keep the signal deterministic while avoiding very large file reads in v1.
    return `SKIPPED_SIZE_GT_${String(MAX_HASH_BYTES)}`;
  }
  return hashBuffer(fs.readFileSync(absPath));
}

function scanRootRecursive(repoRoot: string, absRoot: string, acc: Record<string, ForbiddenFileState>): void {
  if (!fs.existsSync(absRoot)) return;
  const stat = fs.statSync(absRoot);
  if (stat.isFile()) {
    const rel = toRepoRelativePosix(repoRoot, absRoot);
    acc[rel] = {
      repoRelPath: rel,
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: hashFile(absRoot),
    };
    return;
  }
  if (!stat.isDirectory()) return;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (!entry.isFile()) continue;
      const childStat = fs.statSync(child);
      const rel = toRepoRelativePosix(repoRoot, child);
      acc[rel] = {
        repoRelPath: rel,
        exists: true,
        size: childStat.size,
        mtimeMs: childStat.mtimeMs,
        sha256: hashFile(child),
      };
    }
  };

  walk(absRoot);
}

function snapshotForbiddenFiles(repoRoot: string, forbiddenZones: readonly string[]): Record<string, ForbiddenFileState> {
  const files: Record<string, ForbiddenFileState> = {};
  for (const zone of forbiddenZones) {
    const abs = path.resolve(zone);
    scanRootRecursive(repoRoot, abs, files);
  }
  return files;
}

export function buildForbiddenBaseline(
  repoRoot: string,
  forbiddenZones: readonly string[],
): ForbiddenScanBaseline {
  return {
    repoRoot,
    files: snapshotForbiddenFiles(repoRoot, forbiddenZones),
  };
}

export function detectForbiddenViolations(
  baseline: ForbiddenScanBaseline,
  forbiddenZones: readonly string[],
): ForbiddenViolation[] {
  const current = snapshotForbiddenFiles(baseline.repoRoot, forbiddenZones);
  const violations: ForbiddenViolation[] = [];

  const baseKeys = new Set(Object.keys(baseline.files));
  const currentKeys = new Set(Object.keys(current));

  for (const key of currentKeys) {
    if (!baseKeys.has(key)) {
      violations.push({ kind: "added", path: key });
      continue;
    }
    const a = baseline.files[key]!;
    const b = current[key]!;
    if (a.sha256 !== b.sha256 || a.size !== b.size || a.mtimeMs !== b.mtimeMs) {
      violations.push({ kind: "modified", path: key });
    }
  }

  for (const key of baseKeys) {
    if (!currentKeys.has(key)) {
      violations.push({ kind: "deleted", path: key });
    }
  }

  return violations.sort((x, y) => x.path.localeCompare(y.path));
}
