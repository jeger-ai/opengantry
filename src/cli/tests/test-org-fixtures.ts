import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REL_POLICY_CACHE, REL_POLICY_POINTER } from "../lib/constants.js";
import { hmacSha256Hex, canonicalizeRepositoryIdentifier } from "../lib/receipt-attribution.js";
import { appendLedgerEntry } from "../lib/ledger/ledger-append.js";
import type { LedgerEntry, LedgerEntryKind } from "../lib/ledger/ledger-entry.js";
import { depsRefForRepo } from "../lib/deps/deps-slug.js";
import { gitRun } from "../lib/git.js";
import type { OrgPolicyBundle } from "../lib/policy/policy-types.js";
import { gitInitCommit, writeOrgExportConfig } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

export const ORG_FIXTURE_PEPPER = "test-pepper-secret";
export const ORG_FIXTURE_ORG_ID = "org-test-fixture";
export const PRODUCER_REPO_ID = "github.com/jeger-ai/producer";

export function sampleOrgPolicyYaml(overrides?: Partial<OrgPolicyBundle>): string {
  const bundle = {
    schema_version: "1.0.0",
    org_id: overrides?.org_id ?? ORG_FIXTURE_ORG_ID,
    policy_id: overrides?.policy_id ?? "og-floor",
    version: overrides?.version ?? "1.0.0",
    signers: overrides?.signers ?? [],
    mandatory_gates: overrides?.mandatory_gates ?? [],
    banned_imports: overrides?.banned_imports ?? [{ specifier: "lodash", scope: "changed" }],
    producers: overrides?.producers ?? { security_vulnerabilities: "npm audit --json" },
    kpi_thresholds: overrides?.kpi_thresholds ?? [
      { metric: "security_vulnerabilities", op: "<=", value: 0 },
    ],
    config_floor: overrides?.config_floor ?? {
      planner_signature: "warn",
      receipt_signature: "warn",
      ledger_signature: "warn",
      ledger_mode: "local",
      flight_telemetry: { body_mode: "hash_only" },
      break_glass: { require_ledger_entry: true },
    },
  };
  return [
    `schema_version: "${bundle.schema_version}"`,
    `org_id: "${bundle.org_id}"`,
    `policy_id: "${bundle.policy_id}"`,
    `version: "${bundle.version}"`,
    "signers: []",
    "mandatory_gates: []",
    "banned_imports:",
    "  - specifier: lodash",
    "    scope: changed",
    "producers:",
    "  security_vulnerabilities: npm audit --json",
    "kpi_thresholds:",
    "  - metric: security_vulnerabilities",
    "    op: <=",
    "    value: 0",
    "config_floor:",
    "  planner_signature: warn",
    "  receipt_signature: warn",
    "  ledger_signature: warn",
    "  ledger_mode: local",
    "  flight_telemetry:",
    "    body_mode: hash_only",
    "  break_glass:",
    "    require_ledger_entry: true",
    "",
  ].join("\n");
}

export function writeLedgerEnabledConfig(dest: string, mode: "off" | "local" = "local"): void {
  const dir = path.join(dest, ".gitagent");
  fs.mkdirSync(dir, { recursive: true });
  const existing = path.join(dir, "config.json");
  const prev = fs.existsSync(existing) ? (JSON.parse(fs.readFileSync(existing, "utf8")) as Record<string, unknown>) : {};
  fs.writeFileSync(existing, `${JSON.stringify({ ...prev, ledger: { mode, signature: "off" } }, null, 2)}\n`, "utf8");
}

export function writeOrgPolicyRepo(
  dest: string,
  ogRoot: string,
): { pointerPath: string; cachePath: string; bundleSha: string; pinnedCommit: string } {
  fs.mkdirSync(path.join(dest, ".gitagent", "planner"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent/planner/ORG-POLICY.schema.yaml"),
    path.join(dest, ".gitagent/planner/ORG-POLICY.schema.yaml"),
  );
  const yaml = sampleOrgPolicyYaml();
  const pinnedCommit = "a".repeat(40);
  const cacheDir = path.join(dest, REL_POLICY_CACHE, pinnedCommit);
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, "ORG-POLICY.yaml");
  fs.writeFileSync(cachePath, yaml, "utf8");
  const bundleSha = crypto.createHash("sha256").update(fs.readFileSync(cachePath)).digest("hex");
  const pointer = {
    schema_version: "1.0.0",
    source: { kind: "git", url: "https://example.invalid/org-policy.git", ref: "refs/heads/main" },
    bundle_path: "ORG-POLICY.yaml",
    pinned_commit: pinnedCommit,
    bundle_sha256: bundleSha,
  };
  const pointerPath = path.join(dest, REL_POLICY_POINTER);
  fs.writeFileSync(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  return { pointerPath, cachePath, bundleSha, pinnedCommit };
}

export function appendLedgerFixture(
  root: string,
  input: {
    kind?: LedgerEntryKind;
    msn_id?: string;
    payload?: Record<string, unknown>;
    issued_at?: string;
  } = {},
): LedgerEntry {
  writeLedgerEnabledConfig(root);
  writeOrgExportConfig(root, ORG_FIXTURE_ORG_ID, ORG_FIXTURE_PEPPER);
  return appendLedgerEntry(root, {
    kind: input.kind ?? "receipt",
    msn_id: input.msn_id ?? "MSN-0100",
    payload: input.payload ?? { verify_status: "passed", signed: true },
    sign: false,
    issued_at: input.issued_at,
  });
}

export function writeTwoRepoDependencyFixture(tmpBase: string): {
  producer: string;
  consumer: string;
  repoId: string;
  expectedHash: string;
  depRef: string;
} {
  const producer = path.join(tmpBase, "producer");
  const consumer = path.join(tmpBase, "consumer");
  fs.mkdirSync(producer, { recursive: true });
  fs.mkdirSync(consumer, { recursive: true });
  fs.writeFileSync(path.join(producer, "README.md"), "producer\n", "utf8");
  fs.writeFileSync(path.join(consumer, "README.md"), "consumer\n", "utf8");
  gitInitCommit(producer, "chore: producer", PLANNER_EMAIL);
  gitInitCommit(consumer, "chore: consumer", PLANNER_EMAIL);
  writeLedgerEnabledConfig(producer);
  writeOrgExportConfig(producer, ORG_FIXTURE_ORG_ID, ORG_FIXTURE_PEPPER);
  writeOrgExportConfig(consumer, ORG_FIXTURE_ORG_ID, ORG_FIXTURE_PEPPER);
  const prevRepo = process.env.GANTRY_REPO_ID;
  process.env.GANTRY_REPO_ID = PRODUCER_REPO_ID;
  try {
    appendLedgerFixture(producer, {
      kind: "receipt",
      msn_id: "MSN-0100",
      payload: { verify_status: "passed", signed: true },
    });
  } finally {
    if (prevRepo === undefined) delete process.env.GANTRY_REPO_ID;
    else process.env.GANTRY_REPO_ID = prevRepo;
  }
  const expectedHash = hmacSha256Hex(ORG_FIXTURE_PEPPER, canonicalizeRepositoryIdentifier(PRODUCER_REPO_ID));
  const depRef = depsRefForRepo(PRODUCER_REPO_ID);
  const fetched = gitRun(consumer, ["fetch", producer, `refs/gxt/ledger:${depRef}`]);
  if (!fetched.ok) throw new Error(fetched.stderr);
  return { producer, consumer, repoId: PRODUCER_REPO_ID, expectedHash, depRef };
}
