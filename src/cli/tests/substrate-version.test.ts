import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  alreadyCurrentMessage,
  compareSemver,
  readInstalledSubstrateVersion,
  writeSubstrateVersionFile,
  REL_SUBSTRATE_VERSION,
} from "../lib/substrate-version.js";

test("compareSemver: orders major.minor.patch", () => {
  assert.ok(compareSemver("0.8.1", "0.8.0") > 0);
  assert.ok(compareSemver("0.7.9", "0.8.1") < 0);
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
});

test("readInstalledSubstrateVersion: reads SUBSTRATE.version.json", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-subv-"));
  writeSubstrateVersionFile(dest, "0.8.1", "test");
  const r = readInstalledSubstrateVersion(dest);
  assert.equal(r.version, "0.8.1");
  assert.equal(r.source, "substrate_file");
});

test("readInstalledSubstrateVersion: legacy compat fallback", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-subv-"));
  fs.mkdirSync(path.join(dest, "integrations"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, "integrations/compatibility.json"),
    JSON.stringify({ opengantry_version: "0.7.0" }),
    "utf8",
  );
  const r = readInstalledSubstrateVersion(dest);
  assert.equal(r.version, "0.7.0");
  assert.equal(r.source, "legacy_compat");
});

test("readInstalledSubstrateVersion: legacy default 0.0.0", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-subv-"));
  const r = readInstalledSubstrateVersion(dest);
  assert.equal(r.version, "0.0.0");
  assert.equal(r.source, "legacy_default");
});

test("alreadyCurrentMessage: includes npm install guidance", () => {
  const msg = alreadyCurrentMessage("0.8.1", "0.8.1");
  assert.match(msg, /npm install @jeger-ai\/opengantry@latest/);
  assert.match(msg, /gantry upgrade/);
});

test("writeSubstrateVersionFile: creates foreman path", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-subv-"));
  writeSubstrateVersionFile(dest, "0.8.1", "gantry upgrade --apply");
  const abs = path.join(dest, REL_SUBSTRATE_VERSION.split("/").join(path.sep));
  assert.ok(fs.existsSync(abs));
  const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as { opengantry_version: string };
  assert.equal(raw.opengantry_version, "0.8.1");
});
