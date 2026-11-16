/**
 * Conformance goldens for the admission records (MSN-0384, owner decision Q9): example records and their digests,
 * committed under test/conformance/admission/. A consumer in another language can check its canonical JSON and
 * sha256 against these files. Re-record only in a mission whose intent names the change: CONFORMANCE_RECORD=1.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admissionDigest, decide, emptyPermitLedger, issuePermit, parseAdmissionRequest, permitDigest, requestDigest } from "../src/admission.js";
import { admissionCapabilityReport } from "../src/admission-capabilities.js";
import { appendAdmissionJournal, encodeAdmissionJournalRecord, verifyAdmissionJournal } from "../src/admission-journal.js";
import {
  ADMISSION_FAMILIES,
  admissionCapabilityRowSchema,
  admissionJsonSchemas,
  admissionPermitSchema,
  type AdmissionJournalRecord,
  type AdmissionPermit,
} from "../src/schemas/admission-schema.js";
import { CTX, policy, receipts, request } from "./admission-fixtures.js";

const DIR = path.join(fileURLToPath(new URL("../../../../", import.meta.url)), "test", "conformance", "admission");
const RECORD = process.env.CONFORMANCE_RECORD === "1";

/**
 * Negative examples: each is valid JSON Schema structure (every field present and of the right type) but breaks a
 * cross-field rule that JSON Schema cannot express, so only the zod schema (or the reference validator) rejects it.
 */
function invalidExamples(permit: AdmissionPermit): Record<string, { schema: "permit" | "capability-row"; rule: RegExp; value: unknown }> {
  const row = admissionCapabilityReport().rows.find((r) => r.capabilityId === "ubuntu-26.04-x64/claude-code/workspace.write");
  if (row === undefined) throw new Error("no cell");
  return {
    "invalid.permit.lifetime-1h.json": { schema: "permit", rule: /lifetime/, value: { ...permit, expiresAtMs: permit.issuedAtMs + 3_600_000 } },
    "invalid.permit.expires-before-issue.json": { schema: "permit", rule: /lifetime/, value: { ...permit, expiresAtMs: permit.issuedAtMs - 1 } },
    "invalid.capability-row.id-mismatch.json": { schema: "capability-row", rule: /platform\/harness\/family/, value: { ...row, family: "git.publish" } },
    "invalid.capability-row.prevention-without-canary.json": { schema: "capability-row", rule: /canary/, value: { ...row, level: "prevention" } },
  };
}

function goldens(): Record<string, string> {
  const pol = policy();
  const caps = admissionCapabilityReport();
  const files: Record<string, string> = {};
  const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
  files["policy.json"] = json(pol);
  const digests: Record<string, string> = { "policy.json": admissionDigest(pol) };
  for (const kind of ADMISSION_FAMILIES) {
    const r = request(kind, pol);
    files[`request.${kind}.json`] = json(r);
    digests[`request.${kind}.json`] = requestDigest(r);
  }
  const allow = decide(request("workspace.write", pol), pol, caps, undefined, CTX);
  const held = decide(request("git.publish", pol), pol, caps, undefined, CTX);
  files["decision.workspace.write.allow.json"] = json(allow);
  files["decision.git.publish.held.json"] = json(held);
  const permit = issuePermit({
    request: request("workspace.write", pol),
    decision: allow,
    ledger: emptyPermitLedger(),
    authority: { brokerId: "broker-1", epoch: 1 },
    clockId: "boot-1",
    nowMs: 1000,
  });
  if (!permit.ok) throw new Error(permit.reason);
  files["permit.workspace.write.json"] = json(permit.permit);
  digests["permit.workspace.write.json"] = permitDigest(permit.permit);
  for (const [file, body] of Object.entries(invalidExamples(permit.permit))) files[file] = json(body.value);
  const recs: AdmissionJournalRecord[] = [];
  for (const r of receipts()) recs.push(appendAdmissionJournal(recs.at(-1) ?? null, r));
  files["journal.jsonl"] = recs.map(encodeAdmissionJournalRecord).join("");
  digests["journal.jsonl"] = recs[recs.length - 1].recordDigest;
  files["digests.json"] = json(digests);
  return files;
}

test("admission goldens: the committed example records and digests are reproduced byte for byte", () => {
  const expected = goldens();
  if (RECORD) {
    fs.mkdirSync(DIR, { recursive: true });
    for (const [f, body] of Object.entries(expected)) fs.writeFileSync(path.join(DIR, f), body, "utf8");
  }
  assert.deepEqual(fs.readdirSync(DIR).sort(), Object.keys(expected).sort(), "golden file set drifted");
  for (const [f, body] of Object.entries(expected)) assert.equal(fs.readFileSync(path.join(DIR, f), "utf8"), body, `${f} drifted`);
});

test("admission goldens: every committed request parses and hashes to its recorded digest; the journal verifies", () => {
  const digests = JSON.parse(fs.readFileSync(path.join(DIR, "digests.json"), "utf8")) as Record<string, string>;
  for (const kind of ADMISSION_FAMILIES) {
    const file = `request.${kind}.json`;
    const parsed = parseAdmissionRequest(JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")));
    assert.ok(parsed.ok, file);
    assert.equal(requestDigest(parsed.request), digests[file]);
  }
  const journal = verifyAdmissionJournal(fs.readFileSync(path.join(DIR, "journal.jsonl"), "utf8"));
  assert.ok(journal.ok);
  assert.equal(journal.headDigest, digests["journal.jsonl"]);
});

test("admission goldens: every invalid.* example is rejected by zod for its cross-field rule, which the JSON Schema names but cannot express", () => {
  const permit = JSON.parse(fs.readFileSync(path.join(DIR, "permit.workspace.write.json"), "utf8")) as AdmissionPermit;
  const examples = invalidExamples(permit);
  const committed = fs.readdirSync(DIR).filter((f) => f.startsWith("invalid."));
  assert.deepEqual(committed.sort(), Object.keys(examples).sort());
  const schemas = admissionJsonSchemas() as Record<string, { $comment: string }>;
  for (const [file, ex] of Object.entries(examples)) {
    const value: unknown = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    const result = (ex.schema === "permit" ? admissionPermitSchema : admissionCapabilityRowSchema).safeParse(value);
    assert.equal(result.success, false, `${file} was accepted`);
    if (!result.success) assert.match(result.error.issues.map((i) => i.message).join("; "), ex.rule, file);
  }
  assert.match(schemas["admission-permit.v1.schema.json"].$comment, /lifetime/);
  assert.match(schemas["admission-capabilities.v1.schema.json"].$comment, /platform\/harness\/family/);
  assert.match(schemas["admission-capabilities.v1.schema.json"].$comment, /canary/);
  assert.match(schemas["admission-decision.v1.schema.json"].$comment, /decisionDigest/);
  assert.match(schemas["admission-journal-record.v1.schema.json"].$comment, /prevDigest/);
  for (const [file, schema] of Object.entries(schemas)) assert.match(schema.$comment, /zod schema or the reference validator/, file);
});
