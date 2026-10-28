import fs from "node:fs";
import path from "node:path";
import { MAX_IO_BUFFER_BYTES } from "./gate.js";

export const REL_GATE_LOGS_DIR = ".gitagent/tmp/gate-logs" as const;

function gateLogRelPath(msnId: string): string {
  const safe = msnId.replace(/[^A-Za-z0-9-]/g, "_");
  return `${REL_GATE_LOGS_DIR}/${safe}.last.log`;
}

export function ensureGateLogPath(root: string, msnId: string): { abs: string; rel: string } {
  const rel = gateLogRelPath(msnId);
  const absDir = path.join(root, REL_GATE_LOGS_DIR);
  fs.mkdirSync(absDir, { recursive: true });
  return { abs: path.join(root, rel), rel: rel.replace(/\\/g, "/") };
}

/** Read an absolute gate log; tail-capped at MAX_IO_BUFFER_BYTES to avoid V8 OOM. */
export function readGateLogAbs(absPath: string): string {
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

/** Read gate log from disk; tail-capped at MAX_IO_BUFFER_BYTES to avoid V8 OOM. */
export function readGateLogText(root: string, gateLogRel: string | undefined): string {
  if (!gateLogRel) return "";
  return readGateLogAbs(path.join(root, gateLogRel));
}
