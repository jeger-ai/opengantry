/** Organization policy bundle (ADR-0042; ADR-0052 A6). `ORG-POLICY.schema.yaml` is generated from this module. */
import { z } from "zod";

const nonEmpty = z.string().min(1);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const tier = z.enum(["off", "warn", "require"]);

export const orgPolicySchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    org_id: nonEmpty,
    policy_id: nonEmpty,
    version: nonEmpty.describe("Semver or monotonic label for the bundle (not the CLI)."),
    signers: z
      .array(
        z
          .object({
            principal: nonEmpty.describe("SSH or GPG principal allowed to sign the policy commit."),
            kind: z.enum(["ssh", "gpg"]).optional(),
          })
          .strict(),
      )
      .default([]),
    mandatory_gates: z
      .array(
        z
          .object({
            id: nonEmpty,
            command: nonEmpty,
            adapter: z.enum(["generic", "eslint", "tsc"]).default("generic"),
            success_substring: z.string().nullable().optional(),
          })
          .strict(),
      )
      .default([]),
    banned_imports: z
      .array(
        z
          .object({
            specifier: nonEmpty,
            scope: z.enum(["changed", "all"]).default("changed").describe("changed = gantry check-imports on the mission diff; all = whole tree."),
          })
          .strict(),
      )
      .default([]),
    config_floor: z
      .object({
        planner_signature: tier.optional(),
        receipt_signature: tier.optional(),
        ledger_signature: tier.optional(),
        ledger_mode: z.enum(["off", "local"]).optional(),
        flight_telemetry: z.object({ body_mode: z.enum(["hash_only", "full"]).optional() }).strict().optional(),
        break_glass: z.object({ require_ledger_entry: z.boolean().optional() }).strict().optional(),
      })
      .strict()
      .optional(),
    manifest_constraints: z
      .object({
        forbidden_zones_add: z.array(nonEmpty).optional(),
        path_risks_min: z.record(z.string(), z.enum(["Tier-1", "Tier-2", "Tier-3"])).optional(),
        perimeter_protected_add: z.array(nonEmpty).optional(),
      })
      .strict()
      .optional(),
    expected_digests: z
      .object({
        schema_version: z.literal("0.1.0").optional(),
        manifest_sha256: sha256.optional(),
        target_architecture_sha256: sha256.nullable().optional(),
        config_sha256: sha256.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .describe("OpenGantryOrgPolicy");

export type OrgPolicyDocument = z.input<typeof orgPolicySchema>;
