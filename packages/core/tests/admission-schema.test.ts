/** Admission request and record schemas (MSN-0384, ADR-0063 decisions 3, 4 and 8; ADM02, ADM08; owner decision Q9). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAdmissionRequest, parseAdmissionRequestText } from "../src/admission.js";
import {
  ADMISSION_FAMILIES,
  ADMISSION_REQUEST_MAX_BYTES,
  admissionAdvisorySchema,
  admissionJsonSchemas,
  admissionPolicySchema,
  admissionReceiptSchema,
} from "../src/schemas/admission-schema.js";
import { D, RESOURCES, policy, request } from "./admission-fixtures.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const malformed = (value: unknown, detail?: RegExp): void => {
  const r = parseAdmissionRequest(value);
  assert.equal(r.ok, false, "a malformed request was accepted");
  if (!r.ok) {
    assert.equal(r.reason, "request_malformed");
    if (detail) assert.match(r.detail, detail);
  }
};

test("admission request: one valid request per family parses (ADM02)", () => {
  for (const kind of ADMISSION_FAMILIES) assert.equal(parseAdmissionRequest(request(kind)).ok, true, kind);
});

test("admission request: unknown fields, unknown kinds and missing fields are rejected", () => {
  const ok = request();
  malformed({ ...ok, extra: 1 });
  malformed({ ...ok, kind: "shell.exec" });
  malformed({ ...ok, schema: "opengantry.admission-request.v2" });
  malformed({ ...ok, resourceIdentity: { ...(ok.resourceIdentity as object), extra: true } });
  malformed({ ...ok, actorIdentity: { ...ok.actorIdentity, uid: 1000 } });
  malformed({ ...ok, capabilityEvidence: { ...ok.capabilityEvidence, level: "partial" } });
  for (const key of Object.keys(ok)) {
    const without: Record<string, unknown> = { ...ok };
    delete without[key];
    malformed(without);
  }
  malformed(null);
  malformed([]);
  malformed("request");
});

test("admission request: resource identity is checked per kind, and a resource of another kind is rejected", () => {
  malformed({ ...request("workspace.write"), resourceIdentity: RESOURCES["network.connect"] });
  malformed({ ...request("git.publish"), resourceIdentity: RESOURCES["delivery.mutate"] });
});

test("admission request: canonical paths only, no credentials in remotes, closed digests and nonce", () => {
  const w = request("workspace.write");
  const res = w.resourceIdentity as Record<string, unknown>;
  for (const p of ["src/a.ts", "/work/../etc/passwd", "/work/./a", "/work//a", "/work/a/", "/work/a\0b", "C:\\work\\..\\x"]) {
    malformed({ ...w, resourceIdentity: { ...res, path: p } }, /path/);
  }
  assert.equal(parseAdmissionRequest({ ...w, resourceIdentity: { ...res, path: "C:\\work\\a.ts" } }).ok, true);
  // A line terminator must not hide a later `..` segment from the lookahead, and no control character is canonical.
  for (const p of ["/safe\n/../target", "/safe\r/../target", "/safe\u2028/../target", "C:\\safe\n\\..\\x", "/work/a\nb", "/work/a\tb", "/work/a\u007fb", "/work/a\u0085b", "/work/a\u2029b", "C:\\work\\a\nb"]) {
    malformed({ ...w, resourceIdentity: { ...res, path: p } }, /path/);
  }
  const g = request("git.publish");
  const gres = g.resourceIdentity as Record<string, unknown>;
  malformed({ ...g, resourceIdentity: { ...gres, remoteUrl: "https://user:token@github.com/acme/repo.git" } });
  malformed({ ...g, resourceIdentity: { ...gres, ref: "main" } });
  malformed({ ...w, argsDigest: "A".repeat(64) });
  malformed({ ...w, nonce: "short" });
  malformed({ ...request("network.connect"), resourceIdentity: { scheme: "https", host: "Registry.NPMJS.org", port: 443 } });
  malformed({ ...request("network.connect"), resourceIdentity: { scheme: "https", host: "registry.npmjs.org", port: 0 } });
  malformed({ ...request("artifact.read"), resourceIdentity: { target: "secret", secretRef: "../../.ssh/id_rsa" } });
});

test("admission request: every control character and line terminator is rejected in a canonical path, by zod and by the published JSON Schema (MSN-0390)", () => {
  const rejected = [
    ...Array.from({ length: 0x20 }, (_, i) => i), // C0, NUL included
    0x7f, // DEL
    ...Array.from({ length: 0x20 }, (_, i) => 0x80 + i), // C1, NEL included
    0x2028, // LINE SEPARATOR
    0x2029, // PARAGRAPH SEPARATOR
  ];
  // The neighbours of each range stay canonical, so the check is neither weakened nor widened.
  const accepted = [0x20, 0x7e, 0xa0, 0x2027, 0x202a];
  const forms = (c: number): string[] => [`/work/a${String.fromCharCode(c)}b`, `C:\\work\\a${String.fromCharCode(c)}b`];
  const w = request("workspace.write");
  const res = w.resourceIdentity as Record<string, unknown>;
  const zodOk = (p: string): boolean => parseAdmissionRequest({ ...w, resourceIdentity: { ...res, path: p } }).ok;
  // JSON Schema consumers validate with the committed pattern, not with zod: it must reject the same code points.
  const patterns = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "pattern" && typeof v === "string" && v.includes("[A-Z]:")) patterns.add(v);
        else walk(v);
      }
    }
  };
  walk(JSON.parse(fs.readFileSync(path.join(ROOT, "schemas", "admission", "admission-request.v1.schema.json"), "utf8")));
  assert.equal(patterns.size, 1, "one canonical-path pattern in the published request schema");
  const published = new RegExp([...patterns][0]!);
  for (const c of rejected) {
    for (const p of forms(c)) {
      const hex = `U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
      assert.equal(zodOk(p), false, `zod accepted ${hex} in ${JSON.stringify(p)}`);
      assert.equal(published.test(p), false, `the JSON Schema pattern accepted ${hex} in ${JSON.stringify(p)}`);
    }
  }
  for (const c of accepted) {
    for (const p of forms(c)) {
      assert.equal(zodOk(p), true, `zod rejected ${JSON.stringify(p)}`);
      assert.equal(published.test(p), true, `the JSON Schema pattern rejected ${JSON.stringify(p)}`);
    }
  }
});

test("admission request: every control character is rejected in a remote URL's host path, by zod and by the published JSON Schema (MSN-0390 review round)", () => {
  // C0 (NUL included), DEL and C1 (NEL included); whitespace was rejected by \s before, and stays rejected.
  const rejected = [...Array.from({ length: 0x20 }, (_, i) => i), 0x7f, ...Array.from({ length: 0x20 }, (_, i) => 0x80 + i), 0x20, 0xa0, 0x2028, 0x2029];
  // The neighbours that are neither control characters nor whitespace stay accepted: the check is not widened.
  const accepted = [0x21, 0x7e, 0xa1, 0x2027, 0x202a];
  const forms = (c: number): string[] => [`https://github.com/acme/re${String.fromCharCode(c)}po.git`, `ssh://git@github.com:22/acme/re${String.fromCharCode(c)}po.git`, `git@github.com:acme/re${String.fromCharCode(c)}po.git`];
  const g = request("git.publish");
  const gres = g.resourceIdentity as Record<string, unknown>;
  const zodOk = (u: string): boolean => parseAdmissionRequest({ ...g, resourceIdentity: { ...gres, remoteUrl: u } }).ok;
  const patterns = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "remoteUrl" && v && typeof v === "object" && typeof (v as { pattern?: unknown }).pattern === "string") patterns.add((v as { pattern: string }).pattern);
        else walk(v);
      }
    }
  };
  walk(JSON.parse(fs.readFileSync(path.join(ROOT, "schemas", "admission", "admission-request.v1.schema.json"), "utf8")));
  assert.equal(patterns.size, 1, "one remoteUrl pattern in the published request schema");
  const published = new RegExp([...patterns][0]!);
  for (const c of rejected) {
    for (const u of forms(c)) {
      const hex = `U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
      assert.equal(zodOk(u), false, `zod accepted ${hex} in ${JSON.stringify(u)}`);
      assert.equal(published.test(u), false, `the JSON Schema pattern accepted ${hex} in ${JSON.stringify(u)}`);
    }
  }
  for (const c of accepted) {
    for (const u of forms(c)) {
      assert.equal(zodOk(u), true, `zod rejected ${JSON.stringify(u)}`);
      assert.equal(published.test(u), true, `the JSON Schema pattern rejected ${JSON.stringify(u)}`);
    }
  }
});

test("admission request: 64 KiB bound on the bytes received and on the canonical value", () => {
  const ok = request();
  const text = JSON.stringify(ok);
  assert.equal(parseAdmissionRequestText(text).ok, true);
  const padded = text.replace(/}$/, `${" ".repeat(ADMISSION_REQUEST_MAX_BYTES - text.length + 1)}}`);
  const big = parseAdmissionRequestText(padded);
  assert.equal(big.ok, false);
  if (!big.ok) assert.match(big.detail, /exceeds 65536 bytes/);
  assert.equal(parseAdmissionRequestText(text.replace(/}$/, `${" ".repeat(ADMISSION_REQUEST_MAX_BYTES - text.length)}}`)).ok, true);
  malformed({ ...ok, operationId: "x".repeat(ADMISSION_REQUEST_MAX_BYTES) }, /exceeds/);
  const notJson = parseAdmissionRequestText("{");
  assert.equal(notJson.ok, false);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  malformed(cyclic, /does not serialize/);
});

test("admission policy, advisory and receipt schemas are closed", () => {
  assert.equal(admissionPolicySchema.safeParse(policy()).success, true);
  assert.equal(admissionPolicySchema.safeParse({ ...policy(), extra: 1 }).success, false);
  assert.equal(admissionPolicySchema.safeParse(policy({ requirements: { "network.connect": "unproven" } as never })).success, false);
  assert.equal(admissionPolicySchema.safeParse(policy({ rules: [{ id: "r", kind: "workspace.write", effect: "allow" }] as never })).success, false);
  assert.equal(admissionPolicySchema.safeParse(policy({ advisoryRules: [{ id: "a", signal: "risk", atLeast: 0.5, effect: "allow" }] as never })).success, false);
  const adv = { schema: "opengantry.admission-advisory.v1", source: "model-x", signals: [{ name: "risk", value: 0.2 }] };
  assert.equal(admissionAdvisorySchema.safeParse(adv).success, true);
  assert.equal(admissionAdvisorySchema.safeParse({ ...adv, grant: true }).success, false);
  assert.equal(admissionAdvisorySchema.safeParse({ ...adv, signals: [{ name: "risk", value: 2 }] }).success, false);
  const effect = {
    schema: "opengantry.admission-receipt.v1",
    receiptKind: "effect",
    operationId: "op-1",
    attemptId: "att-1",
    requestDigest: D("a"),
    actorIdentity: { harness: "claude-code", sessionId: "s", taskId: "t" },
    capabilityId: "ubuntu-26.04-x64/claude-code/git.publish",
    observedLevel: "unproven",
    state: "unknown",
    ambiguity: "crash",
    provenance: { observer: "broker-1", evidenceDigest: null },
  };
  assert.equal(admissionReceiptSchema.safeParse(effect).success, true);
  assert.equal(admissionReceiptSchema.safeParse({ ...effect, state: "rolled-back" }).success, false, "no rollback state (ADM-T05)");
  assert.equal(admissionReceiptSchema.safeParse({ ...effect, rollback: true }).success, false, "no rollback field (ADM-T05)");
  assert.equal(admissionReceiptSchema.safeParse({ ...effect, schema: "opengantry.admission-receipt.v2" }).success, false, "version-bound");
  assert.equal(admissionReceiptSchema.safeParse({ ...effect, provenance: { observer: "b", evidenceDigest: null, stdout: "secret" } }).success, false);
});

test("JSON Schema: schemas/admission/ matches the zod schemas (regenerate with npm run gen:admission-schemas)", () => {
  const dir = path.join(ROOT, "schemas", "admission");
  const expected = admissionJsonSchemas();
  const committed = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(committed, Object.keys(expected).sort(), "file set drifted");
  for (const [file, schema] of Object.entries(expected)) {
    assert.equal(fs.readFileSync(path.join(dir, file), "utf8"), `${JSON.stringify(schema, null, 2)}\n`, `${file} drifted`);
  }
  const req = expected["admission-request.v1.schema.json"] as { oneOf?: { additionalProperties?: unknown }[]; anyOf?: unknown[] };
  const branches = req.oneOf ?? (req.anyOf as { additionalProperties?: unknown }[]);
  assert.equal(branches.length, ADMISSION_FAMILIES.length);
  for (const b of branches) assert.equal(b.additionalProperties, false);
});
