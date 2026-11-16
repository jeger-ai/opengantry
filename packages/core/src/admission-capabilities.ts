import {
  ADMISSION_FAMILIES,
  ADMISSION_HARNESSES,
  ADMISSION_LEVELS,
  ADMISSION_PLATFORMS,
  ADMISSION_SCHEMA_IDS,
  admissionCapabilityReportSchema,
  type AdmissionCapabilityReport,
  type AdmissionCapabilityRow,
  type AdmissionFamily,
  type AdmissionHarness,
  type AdmissionLevel,
  type AdmissionPlatform,
} from "./schemas/admission-schema.js";
import { formatSchemaIssues } from "./schemas/issues.js";

/**
 * The initial capability matrix (ADR-0063 decision 1, ADM05, ADM-T06 groundwork): every platform × harness × family
 * cell, transcribed from the inventory `docs/concepts/operation-admission-coverage.md` at `be464fe9`. No cell is
 * `prevention`: no canary exists yet. A cell the inventory lists with two levels ("unproven / detection") carries the
 * first, the pre-effect one. On macOS and Windows, owner decision Q8 keeps every cell `unsupported` or `unproven` until
 * a canary proves it, so a `detection` or `audit-only` there is capped to `unproven`; the inventory level stays in the
 * evidence. `unproven` meets no requirement, so the cap only ever refuses more.
 */

const INVENTORY_REF = "docs/concepts/operation-admission-coverage.md";
const INVENTORY_COMMIT = "be464fe9";

type Cells = Record<AdmissionHarness, readonly [string, string, string]>;
const all = (level: string): readonly [string, string, string] => [level, level, level];
const none: Cells = {
  "claude-code": all("unsupported"),
  cursor: all("unsupported"),
  "codex-cli": all("unsupported"),
  headless: all("unsupported"),
  repository: all("unsupported"),
};

/** Inventory text per family, harness and platform (Ubuntu 26.04, macOS 26.2+, Windows 11). */
const INVENTORY: Record<AdmissionFamily, Cells> = {
  "artifact.read": { ...none, "claude-code": all("unproven") },
  "workspace.write": {
    "claude-code": ["unproven / detection", "unproven / detection", "unproven"],
    cursor: all("unproven / detection"),
    "codex-cli": all("detection"),
    headless: ["detection", "detection", "unsupported / unproven"],
    repository: ["detection", "detection", "unproven"],
  },
  "process.spawn": {
    ...none,
    "claude-code": ["unproven", "unproven", "unsupported"],
    cursor: all("unproven / audit-only"),
    headless: ["audit-only / detection", "audit-only / detection", "audit-only"],
  },
  "dependency.materialize": { ...none, headless: ["detection", "detection", "unsupported"], repository: ["detection", "detection", "unproven"] },
  "network.connect": none,
  "git.publish": {
    "claude-code": ["unproven", "unproven", "unsupported"],
    cursor: all("audit-only"),
    "codex-cli": all("audit-only"),
    headless: ["unproven", "unproven", "unsupported"],
    repository: all("detection"),
  },
  "delivery.mutate": none,
};

const Q8_NOTE = "capped to unproven by ADR-0063 owner decision Q8 until a canary proves the cell";

function row(platform: AdmissionPlatform, harness: AdmissionHarness, family: AdmissionFamily, inventoryLevel: string): AdmissionCapabilityRow {
  const first = inventoryLevel.split(" / ")[0] as AdmissionLevel;
  const capped = platform !== "ubuntu-26.04-x64" && (first === "detection" || first === "audit-only");
  return {
    capabilityId: `${platform}/${harness}/${family}`,
    platform,
    harness,
    family,
    level: capped ? "unproven" : first,
    evidence: { kind: "inventory", ref: INVENTORY_REF, inventoryLevel, ...(capped ? { note: Q8_NOTE } : {}) },
  };
}

/** The committed capability report: 3 platforms × 5 harnesses × 7 families, ordered as the vocabularies are. */
export function admissionCapabilityReport(): AdmissionCapabilityReport {
  const rows: AdmissionCapabilityRow[] = [];
  ADMISSION_PLATFORMS.forEach((platform, col) => {
    for (const harness of ADMISSION_HARNESSES) {
      for (const family of ADMISSION_FAMILIES) rows.push(row(platform, harness, family, INVENTORY[family][harness][col]));
    }
  });
  return admissionCapabilityReportSchema.parse({ schema: ADMISSION_SCHEMA_IDS.capabilities, inventoryCommit: INVENTORY_COMMIT, rows });
}

type CapabilityReportCheck = { ok: true; report: AdmissionCapabilityReport } | { ok: false; problems: string[] };

/**
 * A report is usable only when it is valid and complete: every target cell exactly once, so no platform, harness or
 * family is silently missing (ADM-T06). A `prevention` cell without canary evidence is refused by the schema.
 */
export function checkCapabilityReport(value: unknown): CapabilityReportCheck {
  const parsed = admissionCapabilityReportSchema.safeParse(value);
  if (!parsed.success) return { ok: false, problems: [formatSchemaIssues(parsed.error)] };
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of parsed.data.rows) {
    if (seen.has(r.capabilityId)) problems.push(`duplicate cell ${r.capabilityId}`);
    seen.add(r.capabilityId);
  }
  for (const p of ADMISSION_PLATFORMS) {
    for (const h of ADMISSION_HARNESSES) {
      for (const f of ADMISSION_FAMILIES) if (!seen.has(`${p}/${h}/${f}`)) problems.push(`missing cell ${p}/${h}/${f}`);
    }
  }
  return problems.length === 0 ? { ok: true, report: parsed.data } : { ok: false, problems };
}

/** Count of cells per level, for the capability command's summary. */
export function capabilityLevelCounts(report: AdmissionCapabilityReport): Record<AdmissionLevel, number> {
  const counts = Object.fromEntries(ADMISSION_LEVELS.map((l) => [l, 0])) as Record<AdmissionLevel, number>;
  for (const r of report.rows) counts[r.level] += 1;
  return counts;
}
