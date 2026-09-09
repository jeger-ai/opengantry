import type { GateAdapterId, KpiThreshold, TrustThreshold } from "../types.js";
import type { FlightTelemetryBodyMode, LedgerMode, ReceiptSignatureTier } from "../gxt-config.js";

export const ORG_POLICY_SCHEMA_VERSION = "1.0.0" as const;
export const POLICY_POINTER_SCHEMA_VERSION = "1.0.0" as const;

export interface PolicySigner {
  principal: string;
  kind?: "ssh" | "gpg";
}

export interface PolicyMandatoryGate {
  id: string;
  command: string;
  adapter?: GateAdapterId;
  success_substring?: string | null;
}

export interface PolicyBannedImport {
  specifier: string;
  scope?: "changed" | "all";
}

export interface PolicyConfigFloor {
  planner_signature?: ReceiptSignatureTier;
  receipt_signature?: ReceiptSignatureTier;
  ledger_signature?: ReceiptSignatureTier;
  ledger_mode?: LedgerMode;
  flight_telemetry?: { body_mode?: FlightTelemetryBodyMode };
  break_glass?: { require_ledger_entry?: boolean };
}

export interface PolicyManifestConstraints {
  forbidden_zones_add?: string[];
  path_risks_min?: Record<string, TrustThreshold>;
  perimeter_protected_add?: string[];
}

export interface OrgPolicyBundle {
  schema_version: typeof ORG_POLICY_SCHEMA_VERSION;
  org_id: string;
  policy_id: string;
  version: string;
  signers?: PolicySigner[];
  mandatory_gates?: PolicyMandatoryGate[];
  banned_imports?: PolicyBannedImport[];
  producers?: Record<string, string>;
  kpi_thresholds?: KpiThreshold[];
  config_floor?: PolicyConfigFloor;
  manifest_constraints?: PolicyManifestConstraints;
  expected_digests?: {
    schema_version: "0.1.0";
    manifest_sha256?: string;
    target_architecture_sha256?: string | null;
    config_sha256?: string | null;
  };
}

export interface PolicyPointer {
  schema_version: typeof POLICY_POINTER_SCHEMA_VERSION;
  source: { kind: "git"; url: string; ref: string };
  bundle_path: string;
  pinned_commit: string;
  bundle_sha256: string;
}

/** Offline pointer file state. `pinned` means url + hex commit; cache may still be missing. */
export type PolicyPointerState =
  | { kind: "absent" }
  | { kind: "scaffold"; pointer: PolicyPointer }
  | { kind: "pinned"; pointer: PolicyPointer };
