import fs from "node:fs";
import path from "node:path";

import type { DoctorLine } from "./doctor-types.js";
import { computeWorkingDigests } from "./working-digests.js";

export const EXPECTED_DIGESTS_SCHEMA_VERSION = "0.1.0" as const;

export interface ExpectedDigestsFile {
  schema_version: typeof EXPECTED_DIGESTS_SCHEMA_VERSION;
  manifest_sha256?: string;
  target_architecture_sha256?: string | null;
  config_sha256?: string | null;
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
