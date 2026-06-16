import crypto from "node:crypto";
import fs from "node:fs";
import { toPosixRel } from "./cli-io.js";
import type { PlannedWrite } from "./init-plan.js";

export interface UpgradeFileChange {
  path: string;
  action: "add" | "update";
  bytes_before: number | null;
  bytes_after: number;
  sha256_before: string | null;
  sha256_after: string;
}

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function fileState(absPath: string): { bytes: number; sha256: string } | null {
  if (!fs.existsSync(absPath)) return null;
  const buf = fs.readFileSync(absPath);
  return { bytes: buf.length, sha256: sha256Buffer(buf) };
}

/** Summarize planned upgrade writes for dry-run / changelog preview. */
export function buildUpgradeFileChanges(
  repoRoot: string,
  writes: PlannedWrite[],
): UpgradeFileChange[] {
  return writes.map((w) => {
    const rel = toPosixRel(repoRoot, w.absoluteTarget);
    const before = fileState(w.absoluteTarget);
    const afterBuf = Buffer.from(w.body, "utf8");
    return {
      path: rel,
      action: before === null ? "add" : "update",
      bytes_before: before?.bytes ?? null,
      bytes_after: afterBuf.length,
      sha256_before: before?.sha256 ?? null,
      sha256_after: sha256Buffer(afterBuf),
    };
  });
}

export function groupUpgradeChangesByCategory(
  changes: UpgradeFileChange[],
): Record<string, UpgradeFileChange[]> {
  const groups: Record<string, UpgradeFileChange[]> = {
    workflows: [],
    scripts: [],
    hooks: [],
    substrate: [],
    other: [],
  };
  for (const c of changes) {
    if (c.path.startsWith(".github/workflows/")) groups.workflows!.push(c);
    else if (c.path.startsWith("scripts/")) groups.scripts!.push(c);
    else if (c.path.startsWith(".githooks/") || c.path.startsWith(".cursor/hooks")) groups.hooks!.push(c);
    else if (c.path.startsWith(".gitagent/")) groups.substrate!.push(c);
    else groups.other!.push(c);
  }
  return groups;
}
