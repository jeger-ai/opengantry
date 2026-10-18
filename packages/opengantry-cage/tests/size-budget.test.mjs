// DoD 2 (MSN-0252): the unpacked package, build output included, stays at or under 2 MiB.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { npm, pkgDir, SIZE_CAP_BYTES } from "./helpers.mjs";

function dirBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.endsWith(".tgz")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirBytes(p);
    else if (entry.isFile()) total += fs.statSync(p).size;
  }
  return total;
}

test("packages/opengantry-cage/ including dist/ is at most 2,097,152 bytes", () => {
  const bundle = path.join(pkgDir, "dist", "packages", "cage", "src", "opengantry-cage.js");
  assert.ok(fs.existsSync(bundle), "build output present (run npm run build first)");
  const total = dirBytes(pkgDir);
  assert.ok(total <= SIZE_CAP_BYTES, `unpacked package dir is ${total} bytes, cap ${SIZE_CAP_BYTES}`);
  assert.ok(fs.statSync(bundle).size > 50_000, "bundle is not an empty stub");
});

test("npm pack unpackedSize is at most 2,097,152 bytes", () => {
  const dry = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json"], { cwd: pkgDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0];
  assert.ok(dry.unpackedSize <= SIZE_CAP_BYTES, `unpackedSize ${dry.unpackedSize} bytes, cap ${SIZE_CAP_BYTES}`);
});
