import { NPM_PACKAGE_NAME } from "./constants.js";
import { loadIntegrationCompat } from "./integration-compat.js";
import {
  compareSemver,
  legacyVersionWarning,
  readInstalledSubstrateVersion,
} from "./substrate-version.js";
import type { DoctorLine, SubstrateDriftDoctorResult } from "./doctor-types.js";

export function runSubstrateDriftDoctorChecks(
  repoRoot: string,
  templatesRoot: string,
): SubstrateDriftDoctorResult {
  const installed = readInstalledSubstrateVersion(repoRoot);
  const bundled = loadIntegrationCompat(templatesRoot).opengantry_version;
  const lines: DoctorLine[] = [];
  let nextStep: string | null = null;

  const legacyWarn = legacyVersionWarning(installed.source);
  if (legacyWarn) {
    lines.push({ level: "warn", message: legacyWarn });
  }

  const cmp = compareSemver(installed.version, bundled);
  if (cmp === 0) {
    lines.push({
      level: "ok",
      message: `substrate version: ${installed.version} (matches bundled gantry)`,
    });
  } else if (cmp < 0) {
    lines.push({
      level: "warn",
      message: `substrate version ${installed.version} is behind bundled gantry ${bundled} — run gantry upgrade after updating ${NPM_PACKAGE_NAME}`,
    });
    nextStep = "gantry upgrade";
  } else {
    lines.push({
      level: "warn",
      message: `substrate version ${installed.version} is ahead of bundled gantry ${bundled} — update ${NPM_PACKAGE_NAME} (e.g. npm install ${NPM_PACKAGE_NAME}@latest), then re-run gantry doctor`,
    });
  }

  return { lines, nextStep };
}
