import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { TARGET_ARCHITECTURE_FILENAME } from "./arch/cage/target-architecture.js";
import { canonicalJson } from "./canonical-json.js";
import { REL_MANIFEST } from "./constants.js";
import type { DoctorLine } from "./doctor-types.js";
import { loadGxtConfig, resolveFlightTelemetryBodyMode } from "./gxt-config.js";
import { isDefensiveProfilePresetName } from "./defensive-profile-presets.js";

export const EXPECTED_DIGESTS_SCHEMA_VERSION = "0.1.0" as const;

export interface ExpectedDigestsFile {
  schema_version: typeof EXPECTED_DIGESTS_SCHEMA_VERSION;
  manifest_sha256?: string;
  target_architecture_sha256?: string | null;
  config_sha256?: string | null;
}

function sha256File(absPath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}

function sha256FileOrNull(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  return sha256File(absPath);
}

export function computeWorkingDigests(root: string): {
  manifest_sha256: string | null;
  target_architecture_sha256: string | null;
  config_sha256: string | null;
} {
  return {
    manifest_sha256: sha256FileOrNull(path.join(root, REL_MANIFEST)),
    target_architecture_sha256: sha256FileOrNull(path.join(root, TARGET_ARCHITECTURE_FILENAME)),
    config_sha256: sha256FileOrNull(path.join(root, ".gitagent", "config.json")),
  };
}

export function loadExpectedDigestsFile(policyPath: string): ExpectedDigestsFile {
  const abs = path.resolve(policyPath);
  const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as ExpectedDigestsFile;
  if (parsed.schema_version !== EXPECTED_DIGESTS_SCHEMA_VERSION) {
    throw new Error(
      `expected digests schema_version must be ${EXPECTED_DIGESTS_SCHEMA_VERSION}`,
    );
  }
  return parsed;
}

export function runPolicyDigestDoctorChecks(root: string, policyPath: string): DoctorLine[] {
  const lines: DoctorLine[] = [];
  const expected = loadExpectedDigestsFile(policyPath);
  const actual = computeWorkingDigests(root);

  const compare = (
    label: string,
    expectedValue: string | null | undefined,
    actualValue: string | null,
  ): void => {
    if (expectedValue === undefined) return;
    if (expectedValue === actualValue) {
      lines.push({ level: "ok", message: `policy digest ${label}: match` });
      return;
    }
    lines.push({
      level: "fail",
      message: `policy digest ${label}: drift (expected ${expectedValue ?? "null"}, actual ${actualValue ?? "null"})`,
    });
  };

  compare("manifest_sha256", expected.manifest_sha256, actual.manifest_sha256);
  compare(
    "target_architecture_sha256",
    expected.target_architecture_sha256,
    actual.target_architecture_sha256,
  );
  compare("config_sha256", expected.config_sha256, actual.config_sha256);

  if (lines.length === 0) {
    lines.push({ level: "warn", message: "policy digests file has no comparable fields" });
  }

  return lines;
}

export function runFlightTelemetryDoctorChecks(root: string): DoctorLine[] {
  const lines: DoctorLine[] = [];
  const config = loadGxtConfig(root);
  const mode = resolveFlightTelemetryBodyMode(config);
  const rawMode = config.flight_telemetry?.body_mode;
  if (rawMode && rawMode !== "hash_only" && rawMode !== "full") {
    lines.push({
      level: "fail",
      message: `flight_telemetry.body_mode invalid (${rawMode}); use hash_only or full`,
    });
    return lines;
  }

  lines.push({ level: "ok", message: `flight_telemetry.body_mode: ${mode}` });

  const preset = config.defensive_profile?.preset;
  if (isDefensiveProfilePresetName(preset ?? "") && preset === "strict_enterprise" && mode === "full") {
    lines.push({
      level: "warn",
      message:
        "strict_enterprise preset with flight_telemetry.body_mode=full stores gate stream bodies in EXECUTOR_LOG",
    });
  }

  const receiptTier = config.receipt_signature ?? "off";
  lines.push({ level: "ok", message: `receipt_signature tier: ${receiptTier}` });

  return lines;
}

export function canonicalExpectedDigests(digests: ExpectedDigestsFile): string {
  return canonicalJson(digests);
}
