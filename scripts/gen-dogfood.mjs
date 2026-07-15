#!/usr/bin/env node
/**
 * Sync dogfood copies from templates/ to repo root (single source of truth: templates/).
 * - templates/scripts/* → scripts/ (managed template scripts only; repo-only scripts untouched)
 * - templates/.github/workflows/gxt-validate.yml → .github/workflows/gxt-validate.yml
 *
 * Run via: npm run gen:dogfood (also wired into npm run build).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function copyFileSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  const mode = fs.statSync(src).mode & 0o777;
  if (mode & 0o111) {
    fs.chmodSync(dest, mode);
  }
}

const templateScripts = path.join(REPO_ROOT, "templates", "scripts");

function copyTreeSync(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, name);
    const dest = path.join(destDir, name);
    if (fs.statSync(src).isDirectory()) {
      copyTreeSync(src, dest);
    } else {
      copyFileSync(src, dest);
    }
  }
}

copyTreeSync(templateScripts, path.join(REPO_ROOT, "scripts"));

const workflowSrc = path.join(REPO_ROOT, "templates", ".github", "workflows", "gxt-validate.yml");
const workflowDest = path.join(REPO_ROOT, ".github", "workflows", "gxt-validate.yml");
copyFileSync(workflowSrc, workflowDest);

console.log("gen-dogfood: synced templates/scripts → scripts/ and gxt-validate workflow");
