import fs from "node:fs";
import path from "node:path";
import { MAX_IO_BUFFER_BYTES } from "./gate.js";

export const REL_GATE_LOGS_DIR = ".gitagent/tmp/gate-logs" as const;

export function gateLogRelPath(msnId: string): string {
  const safe = msnId.replace(/[^A-Za-z0-9-]/g, "_");
  return `${REL_GATE_LOGS_DIR}/${safe}.last.log`;
}

export function resolveGateLogPaths(
  root: string,
  msnId: string,
): { abs: string; rel: string } {
  const rel = gateLogRelPath(msnId);
  const absDir = path.join(root, REL_GATE_LOGS_DIR);
  fs.mkdirSync(absDir, { recursive: true });
  return { abs: path.join(root, rel), rel: rel.replace(/\\/g, "/") };
}

/** Read gate log from disk; tail-capped at MAX_IO_BUFFER_BYTES to avoid V8 OOM. */
export function readGateLogText(root: string, gateLogRel: string | undefined): string {
  if (!gateLogRel) return "";
  const absPath = path.join(root, gateLogRel);
  try {
    const stat = fs.statSync(absPath);
    if (stat.size <= MAX_IO_BUFFER_BYTES) {
      return fs.readFileSync(absPath, "utf8");
    }
    const fd = fs.openSync(absPath, "r");
    try {
      const buffer = Buffer.alloc(MAX_IO_BUFFER_BYTES);
      const start = stat.size - MAX_IO_BUFFER_BYTES;
      const bytesRead = fs.readSync(fd, buffer, 0, MAX_IO_BUFFER_BYTES, start);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

/** Write combined gate stdout/stderr; returns repo-relative POSIX path. */
export function writeGateLog(
  root: string,
  msnId: string | undefined,
  stdout: string | undefined,
  stderr: string | undefined,
): string | undefined {
  if (!msnId?.trim()) return undefined;
  if (stdout === undefined && stderr === undefined) return undefined;

  const rel = gateLogRelPath(msnId.trim());
  const absDir = path.join(root, REL_GATE_LOGS_DIR);
  fs.mkdirSync(absDir, { recursive: true });
  const absPath = path.join(root, rel);
  const parts: string[] = [];
  if (stdout !== undefined && stdout.length > 0) {
    parts.push("=== stdout ===", stdout);
  }
  if (stderr !== undefined && stderr.length > 0) {
    parts.push("=== stderr ===", stderr);
  }
  const body = parts.length > 0 ? `${parts.join("\n")}\n` : "";
  fs.writeFileSync(absPath, body, "utf8");
  return rel.replace(/\\/g, "/");
}

/** Prefer streamed gate log; only write legacy format when no existing path. */
export function resolveRemediationGateLog(
  root: string,
  msnId: string | undefined,
  existingRel: string | undefined,
  stdout: string | undefined,
  stderr: string | undefined,
): string | undefined {
  if (existingRel?.trim()) return existingRel.replace(/\\/g, "/");
  return writeGateLog(root, msnId, stdout, stderr);
}
