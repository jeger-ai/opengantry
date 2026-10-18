import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * MSN-0273: `npm run build` prunes compiled files whose TypeScript source is gone (scripts/prune-dist.mjs), without
 * ever emptying dist/. Compiled to dist/cli/tests/, so the repo root is three levels up. Imports no CLI library code.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = path.join(REPO_ROOT, "scripts", "prune-dist.mjs");
const OUTPUTS = [".js", ".js.map", ".d.ts", ".d.ts.map"];

function write(root: string, rel: string, body = ""): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

function prune(root: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function exists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

/** Every file under dist/ that tsc emits but whose src/<path>.ts is missing. */
function orphansIn(root: string): string[] {
  const dist = path.join(root, "dist");
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        const rel = path.relative(dist, abs);
        const suffix = [".d.ts.map", ".js.map", ".d.ts", ".js"].find((s) => rel.endsWith(s));
        if (!suffix) continue;
        const stem = rel.slice(0, -suffix.length);
        // dist/packages/<name>/src/x.js comes from packages/<name>/src/x.ts (ADR-0052 step 2), the rest from src/.
        const source = stem.startsWith(`packages${path.sep}`) ? path.join(root, `${stem}.ts`) : path.join(root, "src", `${stem}.ts`);
        if (!fs.existsSync(source)) out.push(rel);
      }
    }
  };
  walk(dist);
  return out.sort();
}

test("prune-dist: removes outputs without a source and the directories it empties, keeps everything else (MSN-0273 DoD 1, DoD 5)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-prune-dist-"));
  write(root, "src/a.ts");
  write(root, "src/sub/b.ts");
  for (const ext of OUTPUTS) {
    write(root, `dist/a${ext}`, "kept");
    write(root, `dist/gone${ext}`, "orphan");
  }
  write(root, "dist/sub/b.js", "kept");
  write(root, "dist/sub/stale.js", "orphan");
  write(root, "dist/old/deep/x.js", "orphan");
  write(root, "dist/notes.txt", "not a tsc output");

  const first = prune(root);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /removed 6 orphaned file\(s\) and 2 empty directories from dist\//);
  for (const ext of OUTPUTS) {
    assert.ok(exists(root, `dist/a${ext}`), `dist/a${ext} has a source and stays`);
    assert.ok(!exists(root, `dist/gone${ext}`), `dist/gone${ext} has no source and goes`);
  }
  assert.ok(exists(root, "dist/sub/b.js"));
  assert.ok(!exists(root, "dist/sub/stale.js"));
  assert.ok(!exists(root, "dist/old"), "directories emptied by the prune are removed");
  assert.ok(exists(root, "dist/sub"), "a directory that still holds files stays");
  assert.ok(exists(root, "dist/notes.txt"), "files tsc does not emit are left alone");
  assert.ok(exists(root, "dist"), "dist/ itself is never removed");

  const again = prune(root);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /removed 0 orphaned file\(s\) and 0 empty directories/);
});

test("prune-dist: a root without dist/ is fine; --root needs a value (MSN-0273 DoD 1)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-prune-dist-empty-"));
  const r = prune(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no dist\/ to prune/);
  const bad = spawnSync(process.execPath, [SCRIPT, "--root"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});

test("prune-dist: npm run build prunes after tsc, and this repo's dist has no orphan (MSN-0273 DoD 2, DoD 5)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  const steps = pkg.scripts.build!.split("&&").map((s) => s.trim());
  const tsc = steps.findIndex((s) => s === "tsc" || s === "tsc -b");
  assert.ok(tsc >= 0, "build runs tsc (tsc -b with project references since ADR-0052 step 2)");
  assert.equal(steps[tsc + 1], "node scripts/prune-dist.mjs", "the prune runs right after tsc");
  assert.ok(!/rm -rf dist|rmSync\(.dist/.test(pkg.scripts.build!), "the build never wipes dist/");
  assert.deepEqual(orphansIn(REPO_ROOT), [], "npm test builds first, so the prune has already run");
});
