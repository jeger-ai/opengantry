import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  computeWorkingDigests,
  runFlightTelemetryDoctorChecks,
  runPolicyDigestDoctorChecks,
} from "../lib/policy-digest-doctor.js";
import { getRepoRoot } from "../lib/git.js";
import { writeRuntimeExecRepo } from "./test-fixtures.js";

test("flight telemetry doctor: defaults to hash_only", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-flight-"));
  writeRuntimeExecRepo(dest, ogRoot, []);
  const lines = runFlightTelemetryDoctorChecks(dest);
  assert.ok(lines.some((line) => line.message.includes("flight_telemetry.body_mode: hash_only")));
});

test("policy digest doctor: reports drift", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-policy-"));
  writeRuntimeExecRepo(dest, ogRoot, []);
  const actual = computeWorkingDigests(dest);
  const policyPath = path.join(dest, "expected-digests.json");
  fs.writeFileSync(
    policyPath,
    JSON.stringify(
      {
        schema_version: "0.1.0",
        manifest_sha256: "deadbeef".repeat(8),
        target_architecture_sha256: actual.target_architecture_sha256,
        config_sha256: actual.config_sha256,
      },
      null,
      2,
    ),
    "utf8",
  );
  const lines = runPolicyDigestDoctorChecks(dest, policyPath);
  assert.ok(lines.some((line) => line.level === "fail" && line.message.includes("manifest_sha256")));
  assert.ok(lines.some((line) => line.level === "ok" && line.message.includes("config_sha256")));
});
