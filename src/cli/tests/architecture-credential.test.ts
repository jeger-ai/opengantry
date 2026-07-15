import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  listArchitectureCredentialSlots,
  loadArchitectureCredential,
  parseCredentialValuesFromStdin,
  removeArchitectureCredential,
  validateCredentialSlot,
  writeArchitectureCredential,
} from "../lib/arch/external/architecture-credential.js";

test("validateCredentialSlot: accepts architecture/confluence", () => {
  assert.equal(validateCredentialSlot("architecture/confluence"), "architecture/confluence");
});

test("validateCredentialSlot: rejects invalid slot", () => {
  assert.throws(() => validateCredentialSlot("../evil"), /slot must match/);
});

test("writeArchitectureCredential: stores and lists without exposing secret in status path", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-cred-"));
  writeArchitectureCredential(dest, "architecture/wiki", "bearer", { token: "secret-value" });
  const slots = listArchitectureCredentialSlots(dest);
  assert.deepEqual(slots, ["architecture/wiki"]);
  const record = loadArchitectureCredential(dest, "architecture/wiki");
  assert.equal(record?.values.token, "secret-value");
  assert.equal(removeArchitectureCredential(dest, "architecture/wiki"), true);
  assert.deepEqual(listArchitectureCredentialSlots(dest), []);
});

test("parseCredentialValuesFromStdin: bearer uses whole stdin as token", () => {
  assert.deepEqual(parseCredentialValuesFromStdin("bearer", "tok123\n"), { token: "tok123" });
});

test("parseCredentialValuesFromStdin: basic parses JSON", () => {
  assert.deepEqual(parseCredentialValuesFromStdin("basic", '{"username":"a","password":"b"}'), {
    username: "a",
    password: "b",
  });
});
