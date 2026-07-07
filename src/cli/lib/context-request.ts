import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "./cli-io.js";
import { EXECUTOR_LOG_FILENAME } from "./constants.js";
import { gitStagePath } from "./git-staged.js";
import { ensureExecutorLogExists } from "./surgeon.js";

export type ContextRequestStatus = "PENDING" | "ACCEPTED" | "REJECTED";

export interface ContextRequestEntry {
  status: ContextRequestStatus;
  paths: string[];
  reason: string;
  proposed?: string[];
  msnId?: string;
}

export interface AppendContextRequestOptions {
  executorLogPath: string;
  entry: ContextRequestEntry;
}

function formatPathList(paths: readonly string[]): string {
  return paths.map((p) => `\`${p}\``).join(", ");
}

/** Grep-friendly single-line EXECUTOR_LOG scaffold per RULES §4. */
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
  const { executorLogPath, entry } = options;
  ensureExecutorLogExists(executorLogPath);
  const line = formatContextRequestLine(entry);
  const suffix = line.endsWith("\n") ? line : `${line}\n`;
  fs.appendFileSync(executorLogPath, suffix, { encoding: "utf8" });
  return line;
}

export function executorLogRepoRelative(repoRoot: string, executorLogPath: string): string {
  const abs = path.resolve(executorLogPath);
  const rel = toPosixRel(repoRoot, abs);
  if (rel.length > 0 && !rel.startsWith("..")) return rel;
  return EXECUTOR_LOG_FILENAME;
}

export function stageExecutorLogIfRequested(
  repoRoot: string,
  executorLogPath: string,
  stage: boolean,
): { staged: boolean; repoRel: string; stderr: string } {
  const repoRel = executorLogRepoRelative(repoRoot, executorLogPath);
  if (!stage) {
    return { staged: false, repoRel, stderr: "" };
  }
  const r = gitStagePath(repoRoot, repoRel);
  return { staged: r.ok, repoRel, stderr: r.stderr };
}
