import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { ENV_BYPASS_SECRET, isBypassSecretAuthorized } from "../lib/break-glass.js";
import { writeBypassAnchor } from "./test-fixtures.js";

test("isBypassSecretAuthorized: requires env and matching anchor", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-bypass-auth-"));
  const secret = "test-break-glass-secret-value";
  writeBypassAnchor(dest, secret);
  const prev = process.env[ENV_BYPASS_SECRET];
  delete process.env[ENV_BYPASS_SECRET];
  assert.equal(isBypassSecretAuthorized(dest), false);
  process.env[ENV_BYPASS_SECRET] = "wrong";
  assert.equal(isBypassSecretAuthorized(dest), false);
  process.env[ENV_BYPASS_SECRET] = secret;
  assert.equal(isBypassSecretAuthorized(dest), true);
  if (prev === undefined) delete process.env[ENV_BYPASS_SECRET];
  else process.env[ENV_BYPASS_SECRET] = prev;
});

