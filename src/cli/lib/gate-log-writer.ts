import fs from "node:fs";
import path from "node:path";

export const REL_GATE_LOGS_DIR = ".gitagent/tmp/gate-logs" as const;

export function gateLogRelPath(msnId: string): string {
  const safe = msnId.replace(/[^A-Za-z0-9-]/g, "_");
  return `${REL_GATE_LOGS_DIR}/${safe}.last.log`;
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
