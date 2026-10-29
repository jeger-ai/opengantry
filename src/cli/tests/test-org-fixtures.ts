import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REL_POLICY_CACHE, REL_POLICY_POINTER_JSON } from "#core/constants.js";
import { appendLedgerEntry } from "#missions/ledger/ledger-append.js";
import type { LedgerEntry, ReceiptLedgerPayload } from "#plane/ledger-entry.js";
import type { OrgPolicyBundle } from "#plane/policy-types.js";

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
    config_floor: overrides?.config_floor ?? {
      planner_signature: "warn",
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
    "config_floor:",
    "  planner_signature: warn",
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
  extraYaml = "",
): { pointerPath: string; cachePath: string; bundleSha: string; pinnedCommit: string } {
  fs.mkdirSync(path.join(dest, ".gitagent", "planner"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent/planner/ORG-POLICY.schema.yaml"),
    path.join(dest, ".gitagent/planner/ORG-POLICY.schema.yaml"),
  );
  const yaml = sampleOrgPolicyYaml() + extraYaml;
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
  const pointerPath = path.join(dest, REL_POLICY_POINTER_JSON);
  fs.writeFileSync(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  return { pointerPath, cachePath, bundleSha, pinnedCommit };
}

export function appendLedgerFixture(
  root: string,
  input: {
    msn_id?: string;
    payload?: ReceiptLedgerPayload;
    issued_at?: string;
    sign?: boolean;
  } = {},
): LedgerEntry {
  writeLedgerEnabledConfig(root);
  return appendLedgerEntry(root, {
    kind: "receipt",
    msn_id: input.msn_id ?? "MSN-0100",
    payload: input.payload ?? { verify_status: "passed" },
    sign: input.sign === true,
    issued_at: input.issued_at,
  });
}
