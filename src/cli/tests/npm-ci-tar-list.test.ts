import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { inspectNpmTarball } from "#core/dependency-tarball.js";
import { makeCert, makeRepo, npmTarball, startRegistry, tarballPath } from "./npm-ci-fixtures.js";

const pkg = { name: "tar-list-fixture", version: "1.0.0" };
const archive = npmTarball(pkg, { "README.md": "ordinary package content\n" });

test("strict byte limits run before list mode and incomplete listings refuse", () => {
  let calls = 0;
  const emptyList = () => { calls++; return { end() {} }; };
  const limits = { maxCompressedBytes: 1, maxUnpackedBytes: 1 << 20, maxEntries: 20, maxManifestBytes: 1024 };
  assert.equal(inspectNpmTarball(archive, limits, emptyList).ok, false);
  assert.equal(calls, 0);
  assert.equal(inspectNpmTarball(archive, undefined, emptyList).ok, false);
  assert.equal(calls, 1);
});

test("gantry npm ci inspects and installs a script-free tarball from a local registry", { timeout: 90_000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-list-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const cert = makeCert(tmp);
  const registry = await startRegistry(cert);
  t.after(() => registry.close());
  const artifact = { ...pkg, location: "node_modules/tar-list-fixture", tarball: archive };
  registry.serve(tarballPath(artifact), archive);
  const { dir, base } = makeRepo(tmp, { registry: registry.url, deps: { [pkg.name]: pkg.version }, pkgs: [artifact] });
  const cli = fileURLToPath(new URL("../index.js", import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [cli, "npm", "ci", "--base", base, "--json"], {
    cwd: dir, timeout: 60_000, env: { HOME: tmp, PATH: process.env.PATH, NODE_EXTRA_CA_CERTS: cert.certFile },
  });
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.outcome, "installed");
  assert.equal(receipt.packages[0].outcome, "materialized");
  assert.deepEqual(receipt.scripts, []);
  assert.equal(fs.readFileSync(path.join(dir, artifact.location, "README.md"), "utf8"), "ordinary package content\n");
});
