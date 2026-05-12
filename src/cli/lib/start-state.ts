import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Manifest } from "./types.js";

export interface StartStateSnapshot {
  captured_at: string;
  head_sha: string;
  branch: string;
  dirty: boolean;
  manifest_sha256: string;
  tmvc_file_hashes: Record<string, string>;
}

function sha256(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function listFilesUnder(root: string, relRoots: string[]): string[] {
  const out = new Set<string>();
  for (const r of relRoots) {
    const base = path.join(root, r);
    if (!fs.existsSync(base)) continue;
    const st = fs.statSync(base);
    if (st.isFile()) {
      out.add(path.relative(root, base).replaceAll("\\", "/"));
      continue;
    }
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile()) out.add(path.relative(root, p).replaceAll("\\", "/"));
      }
    };
    walk(base);
  }
  return [...out].sort();
}

export function captureStartState(root: string, manifest: Manifest, skillKey: string | null): StartStateSnapshot {
  const head_sha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
  let branch = "unknown";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: root, encoding: "utf8" }).trim();
  } catch {
    /* detached */
  }
  const dirty =
    execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim().length > 0;
  const manifestPath = path.join(root, ".gitagent/foreman/MANIFEST.json");
  const manifestBuf = fs.readFileSync(manifestPath);
  const tmvcRoots =
    skillKey && manifest.skills[skillKey]
      ? manifest.skills[skillKey]!.tmvc_roots
      : ([] as string[]);
  const files = listFilesUnder(root, tmvcRoots);
  const tmvc_file_hashes: Record<string, string> = {};
  for (const rel of files) {
    const fp = path.join(root, rel);
    try {
      tmvc_file_hashes[rel] = sha256(fs.readFileSync(fp));
    } catch {
      /* skip unreadable */
    }
  }
  return {
    captured_at: new Date().toISOString(),
    head_sha,
    branch,
    dirty,
    manifest_sha256: sha256(manifestBuf),
    tmvc_file_hashes,
  };
}

export function writeSnapshot(root: string, snapshot: StartStateSnapshot, msnId: string): string {
  const hist = path.join(root, ".gitagent/history");
  fs.mkdirSync(hist, { recursive: true });
  const safe = msnId.replace(/[^\w.-]+/g, "_");
  const out = path.join(hist, `start-state.${safe}.json`);
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 2), "utf8");
  return out;
}
