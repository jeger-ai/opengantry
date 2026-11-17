/**
 * Operation admission records (ADR-0063 decisions 2-4, 6 and 8; issue #356 R1 ADM02, ADM03, ADM06, ADM08; owner
 * decision Q9). Every object is closed (`.strict()`): an unknown field, kind, level or state is rejected, never
 * ignored. `schemas/admission/*.schema.json` is generated from this module by `npm run gen:admission-schemas`; a test
 * fails when the committed files drift. These are records, not authority: a serialized decision or permit grants
 * nothing (ADR-0063 decision 4).
 */
import { z } from "zod";

/** The seven operation families (ADR-0063 decision 2, ADM01). */
export const ADMISSION_FAMILIES = [
  "artifact.read",
  "workspace.write",
  "process.spawn",
  "dependency.materialize",
  "network.connect",
  "git.publish",
  "delivery.mutate",
] as const;
export type AdmissionFamily = (typeof ADMISSION_FAMILIES)[number];

/** The five support levels, in ADR-0063 decision 1 order. */
export const ADMISSION_LEVELS = ["prevention", "unproven", "detection", "audit-only", "unsupported"] as const;
export type AdmissionLevel = (typeof ADMISSION_LEVELS)[number];

/** Target platform rows (coverage page, owner decisions Q2 and Q8). WSL2 is not Windows (ADM05). */
export const ADMISSION_PLATFORMS = ["ubuntu-26.04-x64", "macos-26.2-arm64", "windows-11-x64"] as const;
export type AdmissionPlatform = (typeof ADMISSION_PLATFORMS)[number];

/** Harness columns of the coverage page: CC, CU, CX, HL, RB. */
export const ADMISSION_HARNESSES = ["claude-code", "cursor", "codex-cli", "headless", "repository"] as const;
export type AdmissionHarness = (typeof ADMISSION_HARNESSES)[number];

const ADMISSION_DECISIONS = ["allow", "deny", "unsupported", "held"] as const;
export type AdmissionDecisionValue = (typeof ADMISSION_DECISIONS)[number];

/** Lifecycle states (ADR-0063 decision 6). */
export const ADMISSION_STATES = [
  "received",
  "authorized",
  "denied",
  "unsupported",
  "held",
  "expired",
  "dispatch-intent",
  "confirmed",
  "failed",
  "unknown",
  "reconciled-confirmed",
  "reconciled-failed",
] as const;
export type AdmissionState = (typeof ADMISSION_STATES)[number];

/** Closed reason codes. #355 extends the list only under the `dependency.` prefix (ADR-0063 decision 9). */
const ADMISSION_REASON_CODES = [
  "request_malformed",
  "policy_invalid",
  "policy_changed",
  "policy_denied",
  "capability_absent",
  "capability_mismatch",
  "evidence_missing",
  "approval_missing",
  "advisory_denied",
  "advisory_held",
  "permit_malformed",
  "permit_expired",
  "permit_reused",
  "request_changed",
  "authority_changed",
  "capability_changed",
  "permit_unknown",
  "context_invalid",
] as const;
export type AdmissionReasonCode = (typeof ADMISSION_REASON_CODES)[number] | `dependency.${string}`;

export const ADMISSION_SCHEMA_IDS = {
  request: "opengantry.admission-request.v1",
  decision: "opengantry.admission-decision.v1",
  permit: "opengantry.admission-permit.v1",
  receipt: "opengantry.admission-receipt.v1",
  journalRecord: "opengantry.admission-journal-record.v1",
  policy: "opengantry.admission-policy.v1",
  advisory: "opengantry.admission-advisory.v1",
  capabilities: "opengantry.admission-capabilities.v1",
} as const;

/** Default request cap: 64 KiB of UTF-8 JSON (ADM02). */
export const ADMISSION_REQUEST_MAX_BYTES = 64 * 1024;
/** Default and maximum permit lifetime on the broker's monotonic clock (ADM03). */
export const ADMISSION_PERMIT_MAX_LIFETIME_MS = 30_000;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
/** Broker-assigned identifiers: printable, no whitespace or path separators. */
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const ruleId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
const isoUtc = z.iso.datetime();
/** 128-bit broker nonce, lower-case hex. Prevents replay; not a secret. */
const nonce = z.string().regex(/^[0-9a-f]{32}$/);
const gitObject = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const hostName = z.string().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$|^\[[0-9a-f:.]+\]$/);

/**
 * A canonical absolute path: POSIX (`/a/b`) or a Windows drive path (`C:\a\b`). No `.`, `..` or empty segment, no
 * trailing separator except the root, no control character or line terminator (C0 with NUL, DEL, C1, U+2028/9): these
 * ranges stay in the regex, not a refine, as schemas/admission/ publishes it to JSON Schema users (MSN-0390). The `..`
 * lookahead scans with `[\s\S]` so a newline cannot hide a later segment. The broker resolves symlinks, not the candidate.
 */
const canonicalPath = z
  .string()
  .max(4096)
  .regex(
    /^(?![\s\S]*(?:^|[\\/])\.{1,2}(?:[\\/]|$))(?:\/|(?:\/[^/\x00-\x1f\x7f-\x9f\u2028\u2029]+)+|[A-Z]:\\|[A-Z]:(?:\\[^\\/:*?"<>|\x00-\x1f\x7f-\x9f\u2028\u2029]+)+)$/, // eslint-disable-line no-control-regex -- intended, see above
  );

/** Stable file identity: device+inode on POSIX, volume serial plus file id on Windows (decimal or hex strings). */
const fileIdentity = z.discriminatedUnion("scheme", [
  z.object({ scheme: z.literal("posix"), device: z.string().regex(/^\d{1,20}$/), inode: z.string().regex(/^\d{1,20}$/) }).strict(),
  z
    .object({ scheme: z.literal("windows"), volumeSerial: z.string().regex(/^[0-9a-f]{8,16}$/), fileId: z.string().regex(/^[0-9a-f]{16,32}$/) })
    .strict(),
]);
const fileRef = z.object({ path: canonicalPath, identity: fileIdentity.nullable() }).strict();

const artifactReadResource = z.discriminatedUnion("target", [
  z.object({ target: z.literal("file"), path: canonicalPath, identity: fileIdentity.nullable() }).strict(),
  z.object({ target: z.literal("secret"), secretRef: z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,127}$/) }).strict(),
]);
const workspaceWriteResource = z
  .object({ path: canonicalPath, parent: fileRef, priorContentDigest: z.union([sha256, z.literal("absent")]) })
  .strict();
const processSpawnResource = z
  .object({ executable: fileRef, executableDigest: sha256, cwd: fileRef, environmentAllowlistDigest: sha256 })
  .strict();
/** Supplied by #355 (ADR-0062): the normalized graph and the admitted artifact set, as digests. */
const dependencyMaterializeResource = z
  .object({ ecosystem: z.literal("npm"), graphDigest: sha256, artifactSetDigest: sha256, permittedScriptsDigest: sha256 })
  .strict();
/** Canonical origin, resolved by the broker. */
const networkConnectResource = z
  .object({ scheme: z.enum(["https", "http", "ssh", "git", "tcp"]), host: hostName, port: z.number().int().min(1).max(65535) })
  .strict();
/** `remoteUrl` carries no credentials: https/ssh URL without a password, or `user@host:path`; no control character. */
const remoteUrl = z
  .string()
  .max(2048)
  .regex(/^(?:(?:https|ssh):\/\/(?:[A-Za-z0-9._-]+@)?[a-z0-9.-]+(?::\d{1,5})?\/[^\s@:\x00-\x1f\x7f-\x9f]+|[A-Za-z0-9._-]+@[a-z0-9.-]+:[^\s@:\x00-\x1f\x7f-\x9f]+)$/); // eslint-disable-line no-control-regex -- intended, as canonicalPath
const gitPublishResource = z
  .object({
    remoteUrl,
    ref: z.string().regex(/^refs\/(?:heads|tags|notes)\/[A-Za-z0-9._/-]{1,200}$/),
    expectedOldHead: gitObject.nullable(),
    newHead: gitObject,
  })
  .strict();
const precondition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("head-sha"), value: gitObject }).strict(),
  z.object({ kind: z.literal("etag"), value: z.string().regex(/^[\x21-\x7e]{1,256}$/) }).strict(),
  z.object({ kind: z.literal("absent") }).strict(),
]);
const deliveryMutateResource = z
  .object({
    host: hostName,
    project: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/),
    objectType: ruleId,
    objectId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    mutation: ruleId,
    precondition,
  })
  .strict();

const actorIdentity = z.object({ harness: z.enum(ADMISSION_HARNESSES), sessionId: id, taskId: id }).strict();
const capabilityId = z.string().regex(/^[a-z0-9.-]+\/[a-z-]+\/[a-z.]+$/);
const capabilityEvidence = z.object({ capabilityId, level: z.enum(ADMISSION_LEVELS), probeDigest: sha256.nullable() }).strict();

const requestBase = {
  schema: z.literal(ADMISSION_SCHEMA_IDS.request),
  operationId: id,
  attemptId: id,
  acceptedContractDigest: sha256,
  resolvedPolicyDigest: sha256,
  actorIdentity,
  argsDigest: sha256,
  capabilityEvidence,
  nonce,
};
const requestFor = <K extends AdmissionFamily, R extends z.ZodType>(kind: K, resourceIdentity: R) =>
  z.object({ ...requestBase, kind: z.literal(kind), resourceIdentity }).strict();

/** ADM02. The per-kind `resourceIdentity` shape is selected by `kind`; an unknown kind matches no branch. */
export const admissionRequestSchema = z
  .discriminatedUnion("kind", [
    requestFor("artifact.read", artifactReadResource),
    requestFor("workspace.write", workspaceWriteResource),
    requestFor("process.spawn", processSpawnResource),
    requestFor("dependency.materialize", dependencyMaterializeResource),
    requestFor("network.connect", networkConnectResource),
    requestFor("git.publish", gitPublishResource),
    requestFor("delivery.mutate", deliveryMutateResource),
  ])
  .describe("OpenGantryAdmissionRequest");
export type AdmissionRequest = z.infer<typeof admissionRequestSchema>;

/** Policy limits, and the longest legal `policyRuleIds`: every rule plus every advisory rule. Never truncated. */
const ADMISSION_MAX_RULES = 256;
const ADMISSION_MAX_ADVISORY_RULES = 64;
const ADMISSION_MAX_RULE_IDS = ADMISSION_MAX_RULES + ADMISSION_MAX_ADVISORY_RULES;

const reasonCode = z.union([z.enum(ADMISSION_REASON_CODES), z.string().regex(/^dependency\.[a-z0-9_]{1,64}$/)]);

/** ADM03. `decisionDigest` is the sha256 of the canonical decision without that field. */
export const admissionDecisionSchema = z
  .object({
    schema: z.literal(ADMISSION_SCHEMA_IDS.decision),
    decision: z.enum(ADMISSION_DECISIONS),
    requestDigest: sha256,
    operationId: id.nullable(),
    attemptId: id.nullable(),
    policyRuleIds: z.array(ruleId).max(ADMISSION_MAX_RULE_IDS),
    reasonCodes: z.array(reasonCode).max(32),
    resolvedPolicyDigest: sha256.nullable(),
    capabilityId: capabilityId.nullable(),
    /** The matched cell's level from the capability report, never from the request; null when no cell matched. */
    capabilityLevel: z.enum(ADMISSION_LEVELS).nullable(),
    advisoryDigest: sha256.nullable(),
    /** Null only on a `context_invalid` deny, when the broker's own clock reading was not an ISO UTC time. */
    decidedAt: isoUtc.nullable(),
    decisionDigest: sha256,
  })
  .strict()
  .refine((d) => (d.capabilityId === null) === (d.capabilityLevel === null), { message: "capabilityId and capabilityLevel are both null or both set" })
  .describe("OpenGantryAdmissionDecision");
export type AdmissionDecision = z.infer<typeof admissionDecisionSchema>;

/**
 * A broker-held permit (ADM03). Times are milliseconds on the broker's local monotonic clock, identified by
 * `clockId` (one boot of one broker); they are never compared with wall-clock time or another clock.
 */
export const admissionPermitSchema = z
  .object({
    schema: z.literal(ADMISSION_SCHEMA_IDS.permit),
    requestDigest: sha256,
    decisionDigest: sha256,
    resolvedPolicyDigest: sha256,
    capabilityId,
    capabilityLevel: z.enum(ADMISSION_LEVELS),
    operationId: id,
    attemptId: id,
    authority: z.object({ brokerId: id, epoch: z.number().int().min(0) }).strict(),
    clock: z.object({ kind: z.literal("monotonic"), clockId: id }).strict(),
    issuedAtMs: z.number().int().min(0),
    expiresAtMs: z.number().int().min(0),
  })
  .strict()
  .refine((p) => p.expiresAtMs > p.issuedAtMs && p.expiresAtMs - p.issuedAtMs <= ADMISSION_PERMIT_MAX_LIFETIME_MS, {
    message: `permit lifetime must be positive and at most ${ADMISSION_PERMIT_MAX_LIFETIME_MS} ms`,
  })
  .describe("OpenGantryAdmissionPermit");
export type AdmissionPermit = z.infer<typeof admissionPermitSchema>;

/** Redacted provenance: who observed, and a digest of what they observed. Never raw output or secrets. */
const provenance = z.object({ observer: id, evidenceDigest: sha256.nullable() }).strict();
const receiptBase = {
  schema: z.literal(ADMISSION_SCHEMA_IDS.receipt),
  operationId: id,
  attemptId: id,
  requestDigest: sha256,
  actorIdentity,
  capabilityId: capabilityId.nullable(),
  observedLevel: z.enum(ADMISSION_LEVELS),
};

/** ADM08. A decision or an effect; no field can claim a rollback (ADM-T05). */
export const admissionReceiptSchema = z
  .discriminatedUnion("receiptKind", [
    z
      .object({
        ...receiptBase,
        receiptKind: z.literal("decision"),
        decision: z.enum(ADMISSION_DECISIONS),
        decisionDigest: sha256,
        policyRuleIds: z.array(ruleId).max(ADMISSION_MAX_RULE_IDS),
        reasonCodes: z.array(reasonCode).max(32),
        resolvedPolicyDigest: sha256.nullable(),
        acceptedContractDigest: sha256,
      })
      .strict(),
    z
      .object({
        ...receiptBase,
        receiptKind: z.literal("effect"),
        state: z.enum(["dispatch-intent", "confirmed", "failed", "unknown", "reconciled-confirmed", "reconciled-failed", "expired"]),
        ambiguity: z.enum(["crash", "timeout", "lost-acknowledgement"]).nullable(),
        provenance,
      })
      .strict(),
  ])
  .describe("OpenGantryAdmissionReceipt");
export type AdmissionReceipt = z.infer<typeof admissionReceiptSchema>;

/** One line of the append-only journal (owner decision Q6). `prevDigest` chains; 64 zeros starts the chain. */
export const admissionJournalRecordSchema = z
  .object({
    schema: z.literal(ADMISSION_SCHEMA_IDS.journalRecord),
    seq: z.number().int().min(0),
    prevDigest: sha256,
    receipt: admissionReceiptSchema,
    recordDigest: sha256,
  })
  .strict()
  .describe("OpenGantryAdmissionJournalRecord");
export type AdmissionJournalRecord = z.infer<typeof admissionJournalRecordSchema>;

/** A level a contract may require. Q4: nothing is required by default. */
const requiredLevel = z.enum(["prevention", "detection", "audit-only"]);

/**
 * The resolved, tighten-only admission policy the evaluator reads (ADR-0063 decision 4). Rules match by family and,
 * optionally, harness; resource matchers come with the broker slice. Advisory rules may only tighten (Q5).
 */
export const admissionPolicySchema = z
  .object({
    schema: z.literal(ADMISSION_SCHEMA_IDS.policy),
    requirements: z.partialRecord(z.enum(ADMISSION_FAMILIES), requiredLevel),
    rules: z
      .array(
        z
          .object({
            id: ruleId,
            kind: z.enum(ADMISSION_FAMILIES),
            harness: z.enum(ADMISSION_HARNESSES).optional(),
            effect: z.enum(["allow", "deny"]),
            requireApproval: z.boolean(),
          })
          .strict(),
      )
      .max(ADMISSION_MAX_RULES),
    advisoryRules: z
      .array(
        z
          .object({
            id: ruleId,
            signal: ruleId,
            atLeast: z.number().min(0).max(1),
            effect: z.enum(["held", "deny", "require-approval"]),
          })
          .strict(),
      )
      .max(ADMISSION_MAX_ADVISORY_RULES),
  })
  .strict()
  .describe("OpenGantryAdmissionPolicy");
export type AdmissionPolicy = z.infer<typeof admissionPolicySchema>;

/** AI output (ADR-0063 decision 7): recorded and digested, read only to tighten. */
export const admissionAdvisorySchema = z
  .object({
    schema: z.literal(ADMISSION_SCHEMA_IDS.advisory),
    source: id,
    signals: z.array(z.object({ name: ruleId, value: z.number().min(0).max(1) }).strict()).max(32),
  })
  .strict()
  .describe("OpenGantryAdmissionAdvisory");

const capabilityEvidenceRef = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("inventory"),
      ref: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/),
      inventoryLevel: z.string().regex(/^[a-z/ -]{1,64}$/),
      note: z.string().max(400).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("canary"),
      ref: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/),
      probeDigest: sha256,
      harnessVersion: z.string().regex(/^[A-Za-z0-9._+-]{1,64}$/),
      /** The host the probe ran on (MSN-0391); the probe digest binds the full record. */
      host: z
        .object({
          kernel: z.string().regex(/^[A-Za-z0-9._+-]{1,64}$/),
          apparmorRestrictUserns: z.enum(["0", "1", "absent"]),
          bwrap: z.string().regex(/^[A-Za-z0-9._+-]{1,32}$/).nullable(),
        })
        .strict()
        .optional(),
      note: z.string().max(400).optional(),
    })
    .strict(),
]);

/** One cell of the capability matrix. `prevention` requires canary evidence (ADR-0063 decision 1). */
export const admissionCapabilityRowSchema = z
  .object({
    capabilityId,
    platform: z.enum(ADMISSION_PLATFORMS),
    harness: z.enum(ADMISSION_HARNESSES),
    family: z.enum(ADMISSION_FAMILIES),
    level: z.enum(ADMISSION_LEVELS),
    evidence: capabilityEvidenceRef,
  })
  .strict()
  .refine((r) => r.capabilityId === `${r.platform}/${r.harness}/${r.family}`, { message: "capabilityId must be platform/harness/family" })
  .refine((r) => r.level !== "prevention" || r.evidence.kind === "canary", { message: "prevention needs canary evidence" });
export type AdmissionCapabilityRow = z.infer<typeof admissionCapabilityRowSchema>;

export const admissionCapabilityReportSchema = z
  .object({
    schema: z.literal(ADMISSION_SCHEMA_IDS.capabilities),
    inventoryCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
    rows: z.array(admissionCapabilityRowSchema).max(1024),
  })
  .strict()
  .describe("OpenGantryAdmissionCapabilityReport");
export type AdmissionCapabilityReport = z.infer<typeof admissionCapabilityReportSchema>;

/**
 * The schemas published as JSON Schema, keyed by output file name, with the cross-field rules JSON Schema cannot express.
 * A consumer that validates only against the JSON Schema accepts records that break these rules; it must also run the
 * zod schema or the reference validator in packages/core/src/admission*.ts.
 */
const ADMISSION_JSON_SCHEMA_SOURCES: readonly (readonly [string, string, z.ZodType, readonly string[]])[] = [
  ["admission-request.v1.schema.json", ADMISSION_SCHEMA_IDS.request, admissionRequestSchema, ["the canonical JSON of the request is at most 65536 bytes (parseAdmissionRequest)"]],
  [
    "admission-decision.v1.schema.json",
    ADMISSION_SCHEMA_IDS.decision,
    admissionDecisionSchema,
    ["decisionDigest is the sha256 of the canonical decision without decisionDigest (decisionDigest)", "capabilityId and capabilityLevel are both null or both set"],
  ],
  [
    "admission-permit.v1.schema.json",
    ADMISSION_SCHEMA_IDS.permit,
    admissionPermitSchema,
    [`expiresAtMs > issuedAtMs and the lifetime is at most ${ADMISSION_PERMIT_MAX_LIFETIME_MS} ms`, "a permit authorizes only if its digest is in the issuing broker's state (checkPermit)"],
  ],
  ["admission-receipt.v1.schema.json", ADMISSION_SCHEMA_IDS.receipt, admissionReceiptSchema, []],
  [
    "admission-journal-record.v1.schema.json",
    ADMISSION_SCHEMA_IDS.journalRecord,
    admissionJournalRecordSchema,
    ["recordDigest is the sha256 of the canonical record without recordDigest", "seq counts from 0 and prevDigest chains to the record before, 64 zeros first (verifyAdmissionJournal)"],
  ],
  ["admission-policy.v1.schema.json", ADMISSION_SCHEMA_IDS.policy, admissionPolicySchema, []],
  ["admission-advisory.v1.schema.json", ADMISSION_SCHEMA_IDS.advisory, admissionAdvisorySchema, []],
  [
    "admission-capabilities.v1.schema.json",
    ADMISSION_SCHEMA_IDS.capabilities,
    admissionCapabilityReportSchema,
    ["each row's capabilityId is platform/harness/family", "a prevention row needs canary evidence", "every platform x harness x family cell appears exactly once (checkCapabilityReport)"],
  ],
];

/**
 * JSON Schema (draft 2020-12) for every admission record, keyed by file name, as `scripts/gen-admission-schemas.mjs`
 * writes them. JSON Schema checks structure only; the cross-field rules it cannot state are listed in each `$comment`.
 */
export function admissionJsonSchemas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [file, schemaId, schema, rules] of ADMISSION_JSON_SCHEMA_SOURCES) {
    const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    const crossField = rules.length === 0 ? "No cross-field rules beyond this structure." : `Cross-field rules this JSON Schema cannot express: ${rules.join("; ")}.`;
    out[file] = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `https://opengantry.local/schemas/${schemaId}.json`,
      $comment: `Generated from packages/core/src/schemas/admission-schema.ts (ADR-0063, owner decision Q9). Do not edit. ${crossField} Validate with the zod schema or the reference validator in packages/core/src/admission*.ts as well; JSON Schema alone accepts records that break these rules.`,
      ...Object.fromEntries(Object.entries(json).filter(([k]) => k !== "$schema")),
    };
  }
  return out;
}
