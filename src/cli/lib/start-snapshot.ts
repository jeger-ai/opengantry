import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REL_HISTORY_DIR, REL_MANIFEST } from "./constants.js";
import { tmvcRootsForSkill } from "./tmvc-path.js";
import type { Manifest } from "./types.js";

export interface StartStateSnapshot {
  captured_at: string;
  head_sha: string;
  branch: string;
  dirty: boolean;
  manifest_sha256: string;
  tmvc_file_hashes: Record<string, string>;
}

function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function collectRelativeFilePaths(repoRoot: string, relativeRoots: string[]): string[] {
  const paths = new Set<string>();

  for (const relRoot of relativeRoots) {
    const absolute = path.join(repoRoot, relRoot);
    if (!fs.existsSync(absolute)) continue;

    const stat = fs.statSync(absolute);
    if (stat.isFile()) {
      paths.add(path.relative(repoRoot, absolute).replaceAll("\\", "/"));
      continue;
    }

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(child);
        else if (entry.isFile()) paths.add(path.relative(repoRoot, child).replaceAll("\\", "/"));
      }
    };
    walk(absolute);
  }

  return [...paths].sort();
}

function hashFilesByRelativePath(repoRoot: string, relativePaths: string[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const rel of relativePaths) {
    const absolute = path.join(repoRoot, rel);
    try {
      hashes[rel] = sha256(fs.readFileSync(absolute));
    } catch {
      /* unreadable — skip */
    }
  }
  return hashes;
}

function readCurrentBranch(repoRoot: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function isWorkingTreeDirty(repoRoot: string): boolean {
  return execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" }).trim().length > 0;
}

export function captureStartState(
  repoRoot: string,
  manifest: Manifest,
  skillKey: string | null,
): StartStateSnapshot {
  const headSha = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  const manifestPath = path.join(repoRoot, REL_MANIFEST);
  const manifestBytes = fs.readFileSync(manifestPath);
  const roots = tmvcRootsForSkill(manifest, skillKey);
  const trackedFiles = collectRelativeFilePaths(repoRoot, roots);

  return {
    captured_at: new Date().toISOString(),
    head_sha: headSha,
    branch: readCurrentBranch(repoRoot),
    dirty: isWorkingTreeDirty(repoRoot),
    manifest_sha256: sha256(manifestBytes),
    tmvc_file_hashes: hashFilesByRelativePath(repoRoot, trackedFiles),
  };
}

export function writeSnapshot(repoRoot: string, snapshot: StartStateSnapshot, msnId: string): string {
  const historyDir = path.join(repoRoot, REL_HISTORY_DIR);
  fs.mkdirSync(historyDir, { recursive: true });
  const safeName = msnId.replace(/[^\w.-]+/g, "_");
  const outFile = path.join(historyDir, `start-state.${safeName}.json`);
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), "utf8");
  return outFile;
}
