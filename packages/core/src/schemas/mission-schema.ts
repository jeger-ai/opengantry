/**
 * The structured mission file (ADR-0052 A6: one schema library). `MISSION.schema.yaml` is generated from this module
 * for editors and docs; the CLI validates with this schema. Cross-field rules live in the refinement.
 */
import { z } from "zod";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const msnId = z.string().regex(/^MSN-[0-9]{4}$/);
const nonEmpty = z.string().min(1);

export const missionContractSchema = z
  .object({
    tmvc_roots: z.array(nonEmpty).optional(),
    forbidden_zones: z.array(nonEmpty).optional(),
    allowed_imports: z.array(nonEmpty).optional(),
    banned_imports: z.array(nonEmpty).optional(),
    allow_dynamic_specifiers: z
      .boolean()
      .default(false)
      .describe("When false, import(expr) / require(expr) with a non-literal argument under effective TMVC roots fails GXT_CONTRACT_IMPORT_DYNAMIC."),
    strict_relative_imports: z
      .boolean()
      .default(false)
      .describe("When true, relative or alias imports resolving outside effective TMVC roots fail GXT_CONTRACT_SCOPE_ESCAPE (forbidden zones always fail)."),
  })
  .strict()
  .describe(
    "Planner-sealed mission cage (ADR-0045). Tighten-only: tmvc_roots must be a subset of the skill's manifest roots; forbidden_zones and banned_imports are unioned with skill and org-policy sets. gantry verify re-reads this block from the Planner stamp commit and fails GXT_CONTRACT_TAMPERED on drift.",
  );

export const traceRowSchema = z
  .object({
    dod_id: z.string(),
    trace_quote: z.string(),
    anchor: z.string(),
    status: z.string().regex(/^(PASS|FAIL|PENDING|pass|fail|pending)$/),
  })
  .strict();

export const kpiThresholdSchema = z
  .object({ metric: nonEmpty, op: z.enum(["<=", ">=", "==", "<", ">"]), value: z.number() })
  .strict();

export const interrogationRowSchema = z
  .object({
    finding_id: z.string().min(8),
    kind: z.enum(["risk_escalation", "forbidden_zone", "undefined_boundary", "missing_test_criteria", "adr_conflict"]),
    question: nonEmpty,
    hypothesis: nonEmpty,
    operator_answer: nonEmpty,
    adr_refs: z.array(z.string().regex(/^ADR-[0-9]{4}$/)).optional(),
  })
  .strict();

export const missionDependencySchema = z
  .object({
    repo: nonEmpty.describe("Canonical host/owner/repo or git URL."),
    ref: z.string().default("refs/gxt/ledger"),
    msn_id: msnId,
    require: z
      .object({
        verify_status: z.enum(["passed"]).default("passed"),
        signed: z.boolean().default(false),
        max_age_days: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    expected_repository_hash: sha256.optional(),
  })
  .strict();

export const missionSchema = z
  .object({
    contract: missionContractSchema.optional(),
    contract_sha256: sha256.optional().describe("SHA-256 of the canonical (normalized, sorted) contract block."),
    msn_id: msnId.optional(),
    msnId: msnId.optional(),
    skill_key: nonEmpty,
    gate_command: nonEmpty,
    gate_success_substring: z.string().nullable().optional(),
    gate_adapter: z
      .enum(["generic", "eslint", "tsc"])
      .default("generic")
      .describe(
        "Explicit gate output parser (ADR-0041). generic: exit code + optional success substring only. eslint: gate_command must emit `eslint --format json`; tsc: gate_command must emit plain tsc diagnostics. Routing is never inferred from gate_command text.",
      ),
    virtual_capture: z
      .boolean()
      .default(false)
      .describe("Ignored since 4.0 (ADR-0052 A10 parked the virtual scratch store; see examples/virtual-scratch/). Still accepted, so v3 missions keep validating."),
    upgrade_payload: z
      .object({
        from_version: z.string(),
        to_version: z.string(),
        staged_root: z.literal(".gitagent/.upgrade-tmp").optional(),
        planned_writes: z.array(z.string()),
        skipped_scaffold_only: z.array(z.string()).optional(),
        staged_hashes: z.record(z.string(), z.string()),
        created_at: z.string().optional(),
      })
      .strict()
      .optional(),
    trace_rows: z.array(traceRowSchema).default([]),
    kpi_gate: z
      .object({ report_path: nonEmpty.optional(), thresholds: z.array(kpiThresholdSchema).min(1) })
      .strict()
      .optional(),
    llm_verifiers: z
      .array(
        z
          .object({ id: nonEmpty, command: nonEmpty, provider: z.string().optional(), required: z.boolean().default(false) })
          .strict(),
      )
      .optional(),
    aggregators: z
      .array(z.object({ key: nonEmpty, op: z.enum(["max", "min", "sum"]), sources: z.array(nonEmpty).min(1) }).strict())
      .optional(),
    interrogation: z.array(interrogationRowSchema).default([]),
    interrogation_sha256: sha256.optional(),
    declared_paths: z.array(nonEmpty).optional(),
    depends_on: z
      .array(missionDependencySchema)
      .default([])
      .describe(
        "Cross-repo mission dependencies (ADR-0044). Resolved offline from fetched refs/gxt/deps/<slug> ledger chains. gantry deps fetch is the only network path; verify/doctor/check read local refs only.",
      ),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.msn_id === undefined && m.msnId === undefined) {
      ctx.addIssue({ code: "custom", path: [], message: "must have required property 'msn_id' (or 'msnId')" });
    }
    if (m.interrogation.length > 0 && m.interrogation_sha256 === undefined) {
      ctx.addIssue({ code: "custom", path: [], message: "must have required property 'interrogation_sha256' when interrogation is not empty" });
    }
    if (m.contract !== undefined && m.contract_sha256 === undefined) {
      ctx.addIssue({ code: "custom", path: [], message: "must have required property 'contract_sha256' when contract is present" });
    }
  })
  .describe("OpenGantryMission");

export type MissionDocument = z.input<typeof missionSchema>;
