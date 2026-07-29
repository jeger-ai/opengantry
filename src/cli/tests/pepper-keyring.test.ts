import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GantryUserError } from "../lib/errors.js";
import {
  filterEpochs,
  getPeppersForOrg,
  listOrgIds,
  loadPepperKeyring,
  type PepperKeyringEntry,
} from "../lib/pepper-keyring.js";

function writeKeyring(dir: string, entries: PepperKeyringEntry[]): string {
  const file = path.join(dir, "pepper-keyring.json");
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  return file;
}

const sampleEntries: PepperKeyringEntry[] = [
  {
    org_id: "org-a",
    pepper_version: 1,
    pepper: "pepper-v1",
    active_to: "2025-01-01T00:00:00.000Z",
  },
  {
    org_id: "org-a",
    pepper_version: 2,
    pepper: "pepper-v2",
    active_from: "2025-01-01T00:00:00.000Z",
  },
  { org_id: "org-b", pepper_version: 1, pepper: "pepper-b1" },
];

test("pepper-keyring: getPeppersForOrg sorts by pepper_version", () => {
  const peppers = getPeppersForOrg(sampleEntries, "org-a");
  assert.deepEqual(
    peppers.map((p) => p.pepper_version),
    [1, 2],
  );
});

test("pepper-keyring: listOrgIds returns sorted unique org ids", () => {
  assert.deepEqual(listOrgIds(sampleEntries), ["org-a", "org-b"]);
});

test("pepper-keyring: filterEpochs all and explicit list", () => {
  const orgA = getPeppersForOrg(sampleEntries, "org-a");
  assert.equal(filterEpochs(orgA, "all").length, 2);
  assert.deepEqual(
    filterEpochs(orgA, "1,2").map((p) => p.pepper_version),
    [1, 2],
  );
  assert.deepEqual(
    filterEpochs(orgA, "2").map((p) => p.pepper_version),
    [2],
  );
});

test("pepper-keyring: filterEpochs current prefers active epoch", () => {
  const orgA = getPeppersForOrg(sampleEntries, "org-a");
  const current = filterEpochs(orgA, "current", new Date("2025-06-01T00:00:00.000Z"));
  assert.deepEqual(
    current.map((p) => p.pepper_version),
    [2],
  );
});

test("pepper-keyring: filterEpochs current falls back to max version without dates", () => {
  const undated: PepperKeyringEntry[] = [
    { org_id: "org-x", pepper_version: 1, pepper: "a" },
    { org_id: "org-x", pepper_version: 3, pepper: "c" },
    { org_id: "org-x", pepper_version: 2, pepper: "b" },
  ];
  const current = filterEpochs(undated, "current");
  assert.deepEqual(
    current.map((p) => p.pepper_version),
    [3],
  );
});

test("pepper-keyring: enforces 0600 permissions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-keyring-"));
  const file = path.join(dir, "pepper-keyring.json");
  fs.writeFileSync(file, "[]\n", { mode: 0o644 });
  assert.throws(
    () => loadPepperKeyring(file),
    (err: unknown) => err instanceof GantryUserError && err.code === "PEPPER_KEYRING_PERMISSIONS",
  );
});

test("pepper-keyring: loads valid keyring file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-keyring-"));
  const file = writeKeyring(dir, sampleEntries);
  const loaded = loadPepperKeyring(file);
  assert.equal(loaded.length, 3);
});
