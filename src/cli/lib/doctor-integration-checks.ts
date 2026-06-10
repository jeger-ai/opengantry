import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "./cli-io.js";
import { spawnSync } from "node:child_process";
import {
  INTEGRATION_IDE_KEYS,
  loadIntegrationCompat,
  integrationWizardLabel,
  type IntegrationCompatManifest,
} from "./integration-compat.js";
import type { DoctorLine } from "./doctor-checks.js";

function pathExists(repoRoot: string, rel: string): boolean {
  const normalized = rel.endsWith("/") ? rel.slice(0, -1) : rel;
  return fs.existsSync(path.join(repoRoot, normalized));
}

function readCursorHooksVersion(repoRoot: string): number | null {
  const p = path.join(repoRoot, ".cursor/hooks.json");
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as { version?: number };
    return typeof j.version === "number" ? j.version : null;
  } catch {
    return null;
  }
}

function probeCliVersion(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 5000 });
  if (r.status !== 0) return null;
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return out.length > 0 ? out.split("\n")[0]!.trim() : null;
}

function detectIntegrationPresent(repoRoot: string, key: string, entry: IntegrationCompatManifest["integrations"][typeof INTEGRATION_IDE_KEYS[number]]): boolean {
  if (key === "codex-cli") {
    // AGENTS.md is core GXT scaffold — only .codex/config.toml signals Codex CLI wiring.
    return pathExists(repoRoot, ".codex/config.toml");
  }
  return entry.canonical_paths.some((p) => pathExists(repoRoot, p));
}

export function runIntegrationDoctorChecks(
  repoRoot: string,
  templatesRoot: string,
): DoctorLine[] {
  const lines: DoctorLine[] = [];
  let compat: IntegrationCompatManifest;
  try {
    compat = loadIntegrationCompat(templatesRoot);
  } catch (e) {
    lines.push({
      level: "warn",
      message: `integration compat manifest unavailable: ${errorMessage(e)}`,
    });
    return lines;
  }

  const detected: string[] = [];

  for (const key of INTEGRATION_IDE_KEYS) {
    const entry = compat.integrations[key];
    for (const dep of entry.deprecated_paths) {
      if (pathExists(repoRoot, dep)) {
        const canonical = entry.canonical_paths[0] ?? "(see .gitagent/ARCHITECTURE.pointer.json)";
        lines.push({
          level: "warn",
          message: `deprecated path ${dep} — migrate to ${canonical} (${entry.display_name})`,
        });
      }
    }

    if (!detectIntegrationPresent(repoRoot, key, entry)) continue;

    let label: string = key;
    if (entry.cli_probe && entry.cli_probe.length >= 2) {
      const ver = probeCliVersion(entry.cli_probe[0]!, entry.cli_probe.slice(1));
      if (ver) label = `${key} (${ver})`;
    }
    detected.push(label);

    if (key === "cursor" && entry.hooks_schema_version != null) {
      const hv = readCursorHooksVersion(repoRoot);
      if (hv != null && hv !== entry.hooks_schema_version) {
        lines.push({
          level: "warn",
          message: `.cursor/hooks.json version ${hv} — expected ${entry.hooks_schema_version} per integration compat`,
        });
      }
    }
  }

  if (detected.length > 0) {
    lines.push({ level: "ok", message: `detected agent wiring: ${detected.join(", ")}` });
  } else {
    lines.push({ level: "warn", message: "no agent integration files detected — run gapman init" });
  }

  return lines;
}

export { integrationWizardLabel, INTEGRATION_IDE_KEYS, loadIntegrationCompat };
