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
import { admissionDigest, decide, issuePermit, parseAdmissionRequest, permitDigest, requestDigest } from "../src/admission.js";
import { admissionCapabilityReport } from "../src/admission-capabilities.js";
import { appendAdmissionJournal, encodeAdmissionJournalRecord, verifyAdmissionJournal } from "../src/admission-journal.js";
import { ADMISSION_FAMILIES, type AdmissionJournalRecord } from "../src/schemas/admission-schema.js";
import { DECIDED_AT, policy, receipts, request } from "./admission-fixtures.js";

const DIR = path.join(fileURLToPath(new URL("../../../../", import.meta.url)), "test", "conformance", "admission");
const RECORD = process.env.CONFORMANCE_RECORD === "1";

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
  const allow = decide(request("workspace.write", pol), pol, caps, undefined, { decidedAt: DECIDED_AT });
  const held = decide(request("git.publish", pol), pol, caps, undefined, { decidedAt: DECIDED_AT });
  files["decision.workspace.write.allow.json"] = json(allow);
  files["decision.git.publish.held.json"] = json(held);
  const permit = issuePermit({
    request: request("workspace.write", pol),
    decision: allow,
    capabilityLevel: "unproven",
    authority: { brokerId: "broker-1", epoch: 1 },
    clockId: "boot-1",
    nowMs: 1000,
  });
  if (!permit.ok) throw new Error(permit.reason);
  files["permit.workspace.write.json"] = json(permit.permit);
  digests["permit.workspace.write.json"] = permitDigest(permit.permit);
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
