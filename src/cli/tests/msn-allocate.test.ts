import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  WORK_MSN_BAND_MAX,
  UPGRADE_MSN_BAND_MIN,
  allocateMsn,
  collectUsedMsnIds,
} from "../lib/msn-allocate.js";

test("allocateMsn work band: max+1 from mission files", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-msn-work-"));
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent/missions/MSN-0010.foo.yaml"),
    "msn_id: MSN-0010\nskill_key: ui\ngate_command: echo OK\ntrace_rows: []\n",
    "utf8",
  );
  assert.equal(allocateMsn(dest, { band: "work" }), "MSN-0011");
});

test("allocateMsn work band: throws at exhaustion boundary", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-msn-work-max-"));
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent/missions/MSN-8999.max.yaml"),
    `msn_id: MSN-${WORK_MSN_BAND_MAX}\nskill_key: ui\ngate_command: echo OK\ntrace_rows: []\n`,
    "utf8",
  );
  assert.throws(() => allocateMsn(dest, { band: "work" }), /no MSN available in work band/);
});

test("allocateMsn upgrade band: first free slot", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-msn-up-"));
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent/missions/MSN-9000.taken.yaml"),
    `msn_id: MSN-${UPGRADE_MSN_BAND_MIN}\nskill_key: ui\ngate_command: echo OK\ntrace_rows: []\n`,
    "utf8",
  );
  assert.equal(allocateMsn(dest, { band: "upgrade" }), "MSN-9001");
});

test("collectUsedMsnIds: content-aware MSN from mission body", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-msn-content-"));
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent/missions/custom-name.yaml"),
    "msn_id: MSN-0042\nskill_key: ui\ngate_command: echo OK\ntrace_rows: []\n",
    "utf8",
  );
  const used = collectUsedMsnIds(dest, { band: "work", includeGitHistory: false });
  assert.ok(used.has("MSN-0042"));
});

test("collectUsedMsnIds: git history for work band", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-msn-git-"));
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config user.email "t@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "T"', { cwd: dest, stdio: "pipe" });
  fs.writeFileSync(path.join(dest, "README"), "x\n", "utf8");
  execSync("git add README", { cwd: dest, stdio: "pipe" });
  execSync('git commit -m "[MSN-0055] seed"', { cwd: dest, stdio: "pipe" });
  const used = collectUsedMsnIds(dest, { band: "work" });
  assert.ok(used.has("MSN-0055"));
});
