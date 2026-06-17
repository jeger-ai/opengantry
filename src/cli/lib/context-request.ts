import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "./cli-io.js";
import { WORKER_LOG_FILENAME } from "./constants.js";
import { gitStagePath } from "./git-staged.js";
import { ensureWorkerLogExists } from "./surgeon.js";

export type ContextRequestStatus = "PENDING" | "ACCEPTED" | "REJECTED";

export interface ContextRequestEntry {
  status: ContextRequestStatus;
  paths: string[];
  reason: string;
  proposed?: string[];
  msnId?: string;
}

export interface AppendContextRequestOptions {
  workerLogPath: string;
  entry: ContextRequestEntry;
}

function formatPathList(paths: readonly string[]): string {
  return paths.map((p) => `\`${p}\``).join(", ");
}

/** Grep-friendly single-line WORKER_LOG scaffold per RULES §4. */
export function formatContextRequestLine(entry: ContextRequestEntry): string {
  const pathsPart = formatPathList(entry.paths);
  let line = `- Context Request ${entry.status}: ${pathsPart} — ${entry.reason.trim()}`;
  if (entry.proposed && entry.proposed.length > 0) {
    line += ` | proposed: ${formatPathList(entry.proposed)}`;
  }
  if (entry.msnId?.trim()) {
    line += ` | msn=${entry.msnId.trim()}`;
  }
  return line;
}

export function appendContextRequest(options: AppendContextRequestOptions): string {
  const { workerLogPath, entry } = options;
  ensureWorkerLogExists(workerLogPath);
  const line = formatContextRequestLine(entry);
  const suffix = line.endsWith("\n") ? line : `${line}\n`;
  fs.appendFileSync(workerLogPath, suffix, { encoding: "utf8" });
  return line;
}

export function workerLogRepoRelative(repoRoot: string, workerLogPath: string): string {
  const abs = path.resolve(workerLogPath);
  const rel = toPosixRel(repoRoot, abs);
  if (rel.length > 0 && !rel.startsWith("..")) return rel;
  return WORKER_LOG_FILENAME;
}

export function stageWorkerLogIfRequested(
  repoRoot: string,
  workerLogPath: string,
  stage: boolean,
): { staged: boolean; repoRel: string; stderr: string } {
  const repoRel = workerLogRepoRelative(repoRoot, workerLogPath);
  if (!stage) {
    return { staged: false, repoRel, stderr: "" };
  }
  const r = gitStagePath(repoRoot, repoRel);
  return { staged: r.ok, repoRel, stderr: r.stderr };
}
