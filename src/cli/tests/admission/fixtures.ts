/** Shared fixtures for the admission broker tests (issue #356 slice 3). */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { admissionDigest } from "#core/admission.js";
import { gitChildEnv } from "#git/git.js";
import { AdmissionBroker, type BrokerClock, type BrokerResponse, type RequestTemplate } from "#missions/admission/broker.js";
import { buildAdmissionRequest, posixFileRef, sha256File } from "#missions/admission/client.js";
import { environmentNamesDigest } from "#missions/admission/dispatch.js";
import { AdmissionJournalFile, admissionJournalPath } from "#missions/admission/journal-file.js";

export const CONTRACT_DIGEST = "c".repeat(64);
export const HOST = { platform: "ubuntu-26.04-x64", harness: "claude-code" } as const;

/** A fresh git repository at its physical path, and a policy dir outside it. */
export function brokerRepo(): { root: string; outside: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-broker-repo-")));
  const r = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8", env: gitChildEnv() });
  assert.equal(r.status, 0, r.stderr);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-broker-out-")));
  return { root, outside };
}

/** A policy allowing the two dispatched families (and git.publish, to show the broker still refuses it). */
export function writePolicy(file: string, extra: { kind: string; effect: "allow" | "deny"; id: string }[] = []): string {
  const rules = [
    { id: "allow-write", kind: "workspace.write", effect: "allow", requireApproval: false },
    { id: "allow-spawn", kind: "process.spawn", effect: "allow", requireApproval: false },
    { id: "allow-publish", kind: "git.publish", effect: "allow", requireApproval: false },
    ...extra.map((e) => ({ ...e, requireApproval: false })),
  ];
  fs.writeFileSync(file, `${JSON.stringify({ schema: "opengantry.admission-policy.v1", requirements: {}, rules, advisoryRules: [] })}\n`);
  return file;
}

/** A clock the test moves by hand. */
export function manualClock(): { clock: () => BrokerClock; advance: (ms: number) => void } {
  let mono = 1_000;
  return { clock: () => ({ wall: "2026-11-16T12:00:00.000Z", monoMs: mono }), advance: (ms) => void (mono += ms) };
}

export interface OpenedBroker {
  broker: AdmissionBroker;
  journal: AdmissionJournalFile;
  journalFile: string;
}

export function openBroker(root: string, policyFile: string, opts: { clock?: () => BrokerClock; maxBytes?: number; spawnTimeoutMs?: number } = {}): OpenedBroker {
  const journalFile = admissionJournalPath(root)!;
  const { journal, records } = AdmissionJournalFile.open(journalFile, opts.maxBytes === undefined ? {} : { maxBytes: opts.maxBytes });
  const broker = new AdmissionBroker({
    root,
    host: HOST,
    policyFile,
    acceptedContractDigest: CONTRACT_DIGEST,
    journal,
    journalRecords: records,
    ...(opts.clock ? { clock: opts.clock } : {}),
    ...(opts.spawnTimeoutMs ? { spawnTimeoutMs: opts.spawnTimeoutMs } : {}),
  });
  return { broker, journal, journalFile };
}

export function template(res: BrokerResponse): RequestTemplate {
  assert.equal(res.ok, true, JSON.stringify(res));
  return res.template!;
}

/** A dispatch message writing `content` to `rel` under `root`. */
export function writeMessage(broker: AdmissionBroker, root: string, rel: string, content: string, operationId?: string): { type: "dispatch"; request: Record<string, unknown>; args: { contentBase64: string } } {
  const t = template(broker.prepare({ kind: "workspace.write", ...(operationId ? { operationId } : {}) }));
  const abs = path.join(root, rel);
  const parent = posixFileRef(path.dirname(abs));
  const prior = fs.existsSync(abs) ? sha256File(abs) : "absent";
  const args = { contentBase64: Buffer.from(content).toString("base64") };
  const resource = { path: path.join(parent.path, path.basename(abs)), parent, priorContentDigest: prior };
  return { type: "dispatch", request: buildAdmissionRequest(t, resource, args), args };
}

/** A dispatch message running `argv` (argv[0] resolved to its physical executable) in `cwd`. */
export function spawnMessage(broker: AdmissionBroker, cwd: string, argv: string[], env: Record<string, string> = { PATH: "/usr/bin:/bin" }): { type: "dispatch"; request: Record<string, unknown>; args: { argv: string[]; env: Record<string, string> } } {
  const t = template(broker.prepare({ kind: "process.spawn" }));
  const exe = posixFileRef(resolveExecutable(argv[0]!));
  const args = { argv, env };
  const resource = { executable: exe, executableDigest: sha256File(exe.path), cwd: posixFileRef(cwd), environmentAllowlistDigest: environmentNamesDigest(env) };
  return { type: "dispatch", request: buildAdmissionRequest(t, resource, args), args };
}

export function resolveExecutable(name: string): string {
  if (path.isAbsolute(name)) return fs.realpathSync(name);
  for (const dir of ["/usr/bin", "/bin"]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.realpathSync(p);
  }
  throw new Error(`no ${name}`);
}

/** The journal's receipts, in order, as `kind:state-or-decision`. */
export function journalTrail(journalFile: string): string[] {
  if (!fs.existsSync(journalFile)) return [];
  const text = fs.readFileSync(journalFile, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const r = (JSON.parse(l) as { receipt: { receiptKind: string; decision?: string; state?: string } }).receipt;
      return `${r.receiptKind}:${r.decision ?? r.state}`;
    });
}

export const digestOf = admissionDigest;
