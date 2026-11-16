/** Shared admission fixtures (MSN-0384): a valid request per family, a policy whose digest the requests bind, a context. */
import { admissionDigest } from "../src/admission.js";
import { admissionCapabilityReport } from "../src/admission-capabilities.js";
import type { AdmissionFamily, AdmissionPolicy, AdmissionReceipt, AdmissionRequest } from "../src/schemas/admission-schema.js";

export const D = (c: string): string => c.repeat(64);
export const DECIDED_AT = "2026-11-16T12:00:00.000Z";
/** The broker's resolved host in every fixture: Ubuntu 26.04 under Claude Code, the cell `request()` names. */
export const HOST = { platform: "ubuntu-26.04-x64", harness: "claude-code" } as const;
export const CTX = { decidedAt: DECIDED_AT, host: HOST };

export function policy(extra: Partial<AdmissionPolicy> = {}): AdmissionPolicy {
  return {
    schema: "opengantry.admission-policy.v1",
    requirements: {},
    rules: [
      { id: "allow-write", kind: "workspace.write", effect: "allow", requireApproval: false },
      { id: "allow-read", kind: "artifact.read", effect: "allow", requireApproval: false },
      { id: "allow-publish", kind: "git.publish", effect: "allow", requireApproval: true },
    ],
    advisoryRules: [
      { id: "risk-hold", signal: "risk", atLeast: 0.7, effect: "held" },
      { id: "risk-deny", signal: "risk", atLeast: 0.95, effect: "deny" },
      { id: "complexity-approval", signal: "complexity", atLeast: 0.5, effect: "require-approval" },
    ],
    ...extra,
  };
}

const posix = { scheme: "posix", device: "2049", inode: "131074" } as const;

export const RESOURCES: Record<AdmissionFamily, unknown> = {
  "artifact.read": { target: "file", path: "/work/repo/src/a.ts", identity: posix },
  "workspace.write": { path: "/work/repo/src/a.ts", parent: { path: "/work/repo/src", identity: posix }, priorContentDigest: D("1") },
  "process.spawn": {
    executable: { path: "/usr/bin/node", identity: posix },
    executableDigest: D("2"),
    cwd: { path: "/work/repo", identity: null },
    environmentAllowlistDigest: D("3"),
  },
  "dependency.materialize": { ecosystem: "npm", graphDigest: D("4"), artifactSetDigest: D("5"), permittedScriptsDigest: D("6") },
  "network.connect": { scheme: "https", host: "registry.npmjs.org", port: 443 },
  "git.publish": { remoteUrl: "https://github.com/acme/repo.git", ref: "refs/heads/feature/x", expectedOldHead: null, newHead: "a".repeat(40) },
  "delivery.mutate": {
    host: "github.com",
    project: "acme/repo",
    objectType: "pull-request",
    objectId: "17",
    mutation: "create",
    precondition: { kind: "head-sha", value: "b".repeat(40) },
  },
};

/** A request for `kind` on Ubuntu 26.04 under Claude Code, bound to `pol`, with the matrix cell's real level. */
export function request(kind: AdmissionFamily = "workspace.write", pol: AdmissionPolicy = policy(), extra: Record<string, unknown> = {}): AdmissionRequest {
  const capabilityId = `ubuntu-26.04-x64/claude-code/${kind}`;
  const row = admissionCapabilityReport().rows.find((r) => r.capabilityId === capabilityId);
  if (row === undefined) throw new Error(`no cell ${capabilityId}`);
  return {
    schema: "opengantry.admission-request.v1",
    operationId: "op-1",
    attemptId: "att-1",
    acceptedContractDigest: D("c"),
    resolvedPolicyDigest: admissionDigest(pol),
    actorIdentity: { harness: "claude-code", sessionId: "sess-1", taskId: "task-1" },
    kind,
    resourceIdentity: RESOURCES[kind],
    argsDigest: D("e"),
    capabilityEvidence: { capabilityId, level: row.level, probeDigest: null },
    nonce: "0123456789abcdef0123456789abcdef",
    ...extra,
  } as AdmissionRequest;
}

/** A decision receipt, a dispatch intent and the crash that left it unknown, for one git.publish attempt. */
export function receipts(): AdmissionReceipt[] {
  const common = {
    schema: "opengantry.admission-receipt.v1",
    operationId: "op-1",
    attemptId: "att-1",
    requestDigest: D("a"),
    actorIdentity: { harness: "claude-code", sessionId: "sess-1", taskId: "task-1" },
    capabilityId: "ubuntu-26.04-x64/claude-code/git.publish",
    observedLevel: "unproven",
  } as const;
  return [
    {
      ...common,
      receiptKind: "decision",
      decision: "allow",
      decisionDigest: D("b"),
      policyRuleIds: ["allow-publish"],
      reasonCodes: [],
      resolvedPolicyDigest: D("d"),
      acceptedContractDigest: D("c"),
    },
    { ...common, receiptKind: "effect", state: "dispatch-intent", ambiguity: null, provenance: { observer: "broker-1", evidenceDigest: null } },
    { ...common, receiptKind: "effect", state: "unknown", ambiguity: "crash", provenance: { observer: "broker-1", evidenceDigest: null } },
  ];
}
