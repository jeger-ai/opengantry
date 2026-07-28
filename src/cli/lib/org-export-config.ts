import fs from "node:fs";
import path from "node:path";

import { GantryUserError } from "./errors.js";

export const REL_ORG_EXPORT_LOCAL = ".gitagent/foreman/ORG.export.local" as const;

export interface OrgExportConfig {
  org_id: string;
  pepper: string;
  pepper_version: number;
}

interface OrgExportLocalFile {
  org_id?: string;
  pepper?: string;
  pepper_b64?: string;
  pepper_version?: number;
}

function parsePepperVersion(raw: string | undefined): number {
  if (!raw?.trim()) return 1;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new GantryUserError(
      "ORG_EXPORT_INVALID",
      "pepper_version must be a positive integer",
      undefined,
      2,
    );
  }
  return n;
}

function loadOrgExportLocal(root: string): Partial<OrgExportConfig> {
  const abs = path.join(root, REL_ORG_EXPORT_LOCAL);
  if (!fs.existsSync(abs)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as OrgExportLocalFile;
    const pepper =
      parsed.pepper?.trim() ||
      (parsed.pepper_b64?.trim()
        ? Buffer.from(parsed.pepper_b64.trim(), "base64").toString("utf8")
        : undefined);
    return {
      org_id: parsed.org_id?.trim() || undefined,
      pepper,
      pepper_version: parsed.pepper_version,
    };
  } catch {
    return {};
  }
}

/** Resolve org export config from env (preferred) or gitignored local file. */
export function resolveOrgExportConfig(root: string): OrgExportConfig {
  const local = loadOrgExportLocal(root);
  const org_id = process.env.GANTRY_ORG_ID?.trim() || local.org_id;
  const pepper = process.env.GANTRY_ORG_PEPPER?.trim() || local.pepper;
  const pepper_version = parsePepperVersion(
    process.env.GANTRY_ORG_PEPPER_VERSION ?? String(local.pepper_version ?? 1),
  );

  if (!org_id || !pepper) {
    throw new GantryUserError(
      "ORG_EXPORT_CONFIG_MISSING",
      "attestation receipt v0.2.0 requires org export config (GANTRY_ORG_ID + GANTRY_ORG_PEPPER or ORG.export.local)",
      `create ${REL_ORG_EXPORT_LOCAL} or set env vars (see ADR-0036)`,
      2,
    );
  }

  return { org_id, pepper, pepper_version };
}
