import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { loadManifest } from "../lib/manifest.js";
import { checkSkillManifestSync } from "../lib/skill-sync.js";
import { runInit } from "../commands/init.js";

test("skill sync: manifest keys match skills/*.md", () => {
  const root = getRepoRoot();
  const m = loadManifest(root);
  const s = checkSkillManifestSync(root, m);
  assert.equal(s.ok, true, s.errors.join("\n"));
});


test("init: preserves mutable files and fails on managed conflicts", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-init-conflict-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), '{"schema_version":"custom"}\n', "utf8");
  fs.writeFileSync(path.join(dest, "scripts", "validate-gxt.sh"), "#!/usr/bin/env bash\necho custom\n", "utf8");

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    await runInit();
    assert.equal(process.exitCode, 2);
    assert.match(
      fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8"),
      /custom/,
    );
    assert.match(
      fs.readFileSync(path.join(dest, "scripts", "validate-gxt.sh"), "utf8"),
      /custom/,
    );
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});

test("init --force: overwrites only managed files", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-init-force-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), '{"schema_version":"custom"}\n', "utf8");
  fs.writeFileSync(path.join(dest, "scripts", "validate-gxt.sh"), "#!/usr/bin/env bash\necho custom\n", "utf8");
  fs.writeFileSync(path.join(dest, "scripts", "neighbor.sh"), "#!/usr/bin/env bash\necho keep\n", "utf8");

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    await runInit({ force: true });
    assert.equal(process.exitCode, undefined);
    assert.match(
      fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8"),
      /custom/,
    );
    assert.match(
      fs.readFileSync(path.join(dest, "scripts", "validate-gxt.sh"), "utf8"),
      /OpenGantry local \+ CI validation/,
    );
    assert.match(fs.readFileSync(path.join(dest, "scripts", "neighbor.sh"), "utf8"), /keep/);
    assert.equal(fs.existsSync(path.join(dest, ".gitagent", "missions", "README.md")), true);
    assert.equal(fs.existsSync(path.join(dest, ".gitagent", "foreman", "SUBSTRATE.version.json")), true);
    const prettierignore = fs.readFileSync(path.join(dest, ".prettierignore"), "utf8");
    assert.match(prettierignore, /^WORKER_LOG\.md$/m);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});

test("distribution: packed gapman init works outside workspace", () => {
  const ogRoot = getRepoRoot();
  const pack = spawnSync("npm", ["pack", "--json"], { cwd: ogRoot, encoding: "utf8" });
  assert.equal(pack.status, 0, (pack.stderr || "") + (pack.stdout || ""));

  const out = JSON.parse(pack.stdout || "[]") as Array<{ filename?: string }>;
  const tarName = out[0]?.filename;
  assert.ok(tarName, "npm pack did not return a tar filename");
  const tarAbs = path.join(ogRoot, tarName!);

  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "og-pack-extract-"));
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), "og-pack-target-"));
  try {
    const untar = spawnSync("tar", ["-xzf", tarAbs, "-C", extractDir], { encoding: "utf8" });
    assert.equal(untar.status, 0, (untar.stderr || "") + (untar.stdout || ""));
    execSync("git init", { cwd: targetRepo, stdio: "pipe" });

    const pkgDir = path.join(extractDir, "package");
    const pkgNodeModules = path.join(pkgDir, "node_modules");
    fs.mkdirSync(pkgNodeModules, { recursive: true });
    fs.cpSync(path.join(ogRoot, "node_modules", "commander"), path.join(pkgNodeModules, "commander"), {
      recursive: true,
    });
    fs.cpSync(path.join(ogRoot, "node_modules", "yaml"), path.join(pkgNodeModules, "yaml"), {
      recursive: true,
    });

    const cli = path.join(pkgDir, "dist", "cli", "index.js");
    const run = spawnSync(process.execPath, [cli, "init"], { cwd: targetRepo, encoding: "utf8" });
    assert.equal(run.status, 0, (run.stderr || "") + (run.stdout || ""));
    assert.equal(fs.existsSync(path.join(targetRepo, ".gitagent", "foreman", "MANIFEST.json")), true);
    assert.equal(fs.existsSync(path.join(targetRepo, ".gitagent", "ARCHITECTURE.pointer.json")), true);
    const pointer = JSON.parse(
      fs.readFileSync(path.join(targetRepo, ".gitagent", "ARCHITECTURE.pointer.json"), "utf8"),
    ) as { kind?: string };
    assert.equal(pointer.kind, "unset");
    assert.equal(fs.existsSync(path.join(targetRepo, ".gitagent", "missions", "README.md")), true);
    assert.equal(fs.existsSync(path.join(targetRepo, ".github", "workflows", "gxt-validate.yml")), true);
    assert.equal(fs.existsSync(path.join(targetRepo, "scripts", "validate-gxt.sh")), true);
    assert.equal(fs.existsSync(path.join(targetRepo, "scripts", "verify-pr-missions.sh")), true);
  } finally {
    if (fs.existsSync(tarAbs)) fs.rmSync(tarAbs, { force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.rmSync(targetRepo, { recursive: true, force: true });
  }
});
