import { createHash, createPublicKey, verify } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { canonicalRegistry } from "./dependency-policy.js";

/**
 * Dependency approvals and revocations (issue #355 slice 2, ADR-0062 decision 4). An approval is a committed JSON
 * file under the policy's `approval_refs`, read from the base commit, and signed with `ssh-keygen -Y sign` (namespace
 * {@link APPROVAL_SIGNATURE_NAMESPACE}) over the canonical JSON of the file without its `signature`. It counts only
 * when the signing key is listed for the approver in the base commit's allowed-signers file (the Planner allowlist,
 * `.gitagent/foreman/PLANNER.signing.pub`). Pure: the SSHSIG check is node:crypto, ed25519 only.
 */

const DEPENDENCY_APPROVAL_SCHEMA = "opengantry.dependency-approval.v1";
export const DEPENDENCY_REVOCATION_SCHEMA = "opengantry.dependency-revocation.v1";
export const APPROVAL_SIGNATURE_NAMESPACE = "opengantry-dependency-approval";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_SIGNATURE_BYTES = 8 * 1024;
const MAX_SIGNERS_BYTES = 64 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** npm's `hasInstallScript` says one of these runs; the lockfile does not say which. */
export const INSTALL_SCRIPTS = ["install", "postinstall", "preinstall"] as const;
const ROOT_SCRIPTS = ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare", "dependencies"];

export class DependencyApprovalError extends Error {}

/** A package as the graph names it: resolved name and version, source kind and canonical ref, integrity. */
interface ApprovedNode {
  name: string;
  version: string | null;
  source: { kind: "registry" | "workspace" | "local"; ref: string };
  integrity: string | null;
}

export interface DependencyApproval {
  /** sha256 of the signed message: what a revocation names. */
  id: string;
  lockfile: string;
  graphDigest: string;
  policyRevision: string;
  identities: ApprovedNode[];
  lifecycle: (ApprovedNode & { scripts: string[] })[];
  rootScripts: { script: string; commandSha256: string }[];
  files: { path: string; contentDigest: string }[];
  approver: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
  /** The exact bytes the signature covers. */
  message: string;
}

interface DependencyRevocation {
  revokes: string[];
  reason: string;
  revokedBy: string;
  issuedAt: string;
}

type Obj = Record<string, unknown>;

function fail(message: string): never {
  throw new DependencyApprovalError(message);
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function closed(v: unknown, where: string, keys: readonly string[]): Obj {
  if (!isObj(v)) fail(`${where} must be a JSON object`);
  for (const k of Object.keys(v)) if (!keys.includes(k)) fail(`${where}: unknown key "${k}"`);
  return v;
}

function text(v: unknown, where: string): string {
  if (typeof v !== "string" || v.trim() === "" || /[\n\r]/.test(v)) fail(`${where} must be a non-empty single-line string`);
  return v;
}

function sha(v: unknown, where: string): string {
  if (typeof v !== "string" || !SHA256.test(v)) fail(`${where} must be a sha256 (64 lower-case hex digits)`);
  return v;
}

function time(v: unknown, where: string): string {
  const ok = typeof v === "string" && UTC.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v.replace("Z", ".000Z");
  if (!ok) fail(`${where} must be a UTC timestamp (2026-11-16T00:00:00Z)`);
  return v as string;
}

function entries(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) fail(`${where} must be a list`);
  if (v.length > MAX_ENTRIES) fail(`${where} has more than ${String(MAX_ENTRIES)} entries`);
  return v;
}

/** Repository-relative, POSIX, no `..` or empty segments; `.` is the repository root. */
function repoPath(v: unknown, where: string): string {
  const ok = typeof v === "string" && (v === "." || (!v.startsWith("/") && !v.includes("\\") && v.split("/").every((s) => s !== "" && s !== "." && s !== "..")));
  if (!ok) fail(`${where} must be a repository-relative path without "..", "." segments or a leading "/"`);
  return v as string;
}

function readJson(raw: string, what: string): unknown {
  if (Buffer.byteLength(raw, "utf8") > MAX_FILE_BYTES) fail(`${what} is larger than ${String(MAX_FILE_BYTES)} bytes`);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fail(`${what} is not JSON`);
  }
}

function node(raw: unknown, where: string, kinds: readonly ApprovedNode["source"]["kind"][], extra: readonly string[] = []): ApprovedNode {
  const e = closed(raw, where, ["name", "version", "source", "integrity", ...extra]);
  const src = closed(e.source, `${where}.source`, ["kind", "ref"]);
  if (!kinds.includes(src.kind as ApprovedNode["source"]["kind"])) fail(`${where}.source.kind must be ${kinds.join(" or ")}`);
  const kind = src.kind as ApprovedNode["source"]["kind"];
  if (kind !== "registry") {
    if (e.integrity !== null && e.integrity !== undefined) fail(`${where}.integrity must be null for a ${kind} source`);
    const version = e.version === null || e.version === undefined ? null : text(e.version, `${where}.version`);
    return { name: text(e.name, `${where}.name`), version, source: { kind, ref: text(src.ref, `${where}.source.ref`) }, integrity: null };
  }
  let ref: string;
  try {
    ref = canonicalRegistry(text(src.ref, `${where}.source.ref`));
  } catch (err) {
    return fail(`${where}.source.ref: ${(err as Error).message}`);
  }
  if (typeof e.integrity !== "string" || e.integrity === "") fail(`${where}.integrity is required for a registry source`);
  return { name: text(e.name, `${where}.name`), version: text(e.version, `${where}.version`), source: { kind, ref }, integrity: e.integrity };
}

function scripts(v: unknown, where: string): string[] {
  const xs = entries(v, where);
  const ok = xs.length > 0 && new Set(xs).size === xs.length && xs.every((s) => (INSTALL_SCRIPTS as readonly unknown[]).includes(s));
  if (!ok) fail(`${where} must list install scripts (${INSTALL_SCRIPTS.join(", ")}), each once`);
  return [...(xs as string[])].sort();
}

function lockfile(v: unknown): string {
  const p = repoPath(v, "lockfile");
  const base = p.slice(p.lastIndexOf("/") + 1);
  if (base !== "package-lock.json" && base !== "npm-shrinkwrap.json") fail("lockfile must name a package-lock.json or npm-shrinkwrap.json");
  return p;
}

/** What the approver signs: the canonical JSON of the approval without its signature. */
export function approvalSignedMessage(approval: object): string {
  const { signature: _signature, ...body } = approval as { signature?: unknown };
  return canonicalJson(body);
}

const APPROVAL_KEYS = ["schema", "lockfile", "graph_digest", "policy_revision", "identities", "lifecycle", "root_scripts", "files", "approver", "issued_at", "expires_at", "signature"];

/** Parse an approval file: closed, bounded, every field checked; a {@link DependencyApprovalError} otherwise. */
export function parseDependencyApproval(raw: string): DependencyApproval {
  const a = closed(readJson(raw, "approval file"), "approval", APPROVAL_KEYS);
  if (a.schema !== DEPENDENCY_APPROVAL_SCHEMA) fail(`schema must be ${DEPENDENCY_APPROVAL_SCHEMA}`);
  const issuedAt = time(a.issued_at, "issued_at");
  const expiresAt = time(a.expires_at, "expires_at");
  if (expiresAt <= issuedAt) fail("expires_at must be after issued_at");
  if (typeof a.signature !== "string" || a.signature === "") fail("signature is required");
  if (a.signature.length > MAX_SIGNATURE_BYTES) fail("signature is too large");
  const message = approvalSignedMessage(a);
  return {
    id: createHash("sha256").update(message).digest("hex"),
    lockfile: lockfile(a.lockfile),
    graphDigest: sha(a.graph_digest, "graph_digest"),
    policyRevision: sha(a.policy_revision, "policy_revision"),
    identities: entries(a.identities, "identities").map((e, i) => node(e, `identities[${String(i)}]`, ["registry"])),
    lifecycle: entries(a.lifecycle, "lifecycle").map((e, i) => {
      const where = `lifecycle[${String(i)}]`;
      return { ...node(e, where, ["registry", "workspace", "local"], ["scripts"]), scripts: scripts((e as Obj).scripts, `${where}.scripts`) };
    }),
    rootScripts: entries(a.root_scripts, "root_scripts").map((e, i) => {
      const r = closed(e, `root_scripts[${String(i)}]`, ["script", "command_sha256"]);
      if (!ROOT_SCRIPTS.includes(r.script as string)) fail(`root_scripts[${String(i)}].script must be a lifecycle script (${ROOT_SCRIPTS.join(", ")})`);
      return { script: r.script as string, commandSha256: sha(r.command_sha256, `root_scripts[${String(i)}].command_sha256`) };
    }),
    files: entries(a.files, "files").map((e, i) => {
      const f = closed(e, `files[${String(i)}]`, ["path", "content_digest"]);
      return { path: repoPath(f.path, `files[${String(i)}].path`), contentDigest: sha(f.content_digest, `files[${String(i)}].content_digest`) };
    }),
    approver: text(a.approver, "approver"),
    issuedAt,
    expiresAt,
    signature: a.signature,
    message,
  };
}

/**
 * A revocation names approval ids. It needs no signature: it can only remove authority, and it is read from the
 * base commit like the approvals. Revoking is permanent while the file stays; deleting the approval is not enough,
 * because a deleted signed approval could be committed again.
 */
export function parseDependencyRevocation(raw: string): DependencyRevocation {
  const r = closed(readJson(raw, "revocation file"), "revocation", ["schema", "revokes", "reason", "revoked_by", "issued_at"]);
  if (r.schema !== DEPENDENCY_REVOCATION_SCHEMA) fail(`schema must be ${DEPENDENCY_REVOCATION_SCHEMA}`);
  const revokes = entries(r.revokes, "revokes");
  if (revokes.length === 0) fail("revokes must name at least one approval id");
  return {
    revokes: revokes.map((x, i) => sha(x, `revokes[${String(i)}]`)),
    reason: text(r.reason, "reason"),
    revokedBy: text(r.revoked_by, "revoked_by"),
    issuedAt: time(r.issued_at, "issued_at"),
  };
}

// --- SSHSIG (PROTOCOL.sshsig), ed25519 -------------------------------------------------------------------------

interface AllowedSigner {
  principals: string[];
  /** null: every namespace. */
  namespaces: string[] | null;
  key: Buffer;
}

function sshString(b: Buffer | string): Buffer {
  const body = typeof b === "string" ? Buffer.from(b) : b;
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

/** The bytes an SSHSIG signature covers for `message`. */
export function sshSignatureSignedData(message: string, namespace: string, hash: "sha256" | "sha512"): Buffer {
  const digest = createHash(hash).update(message).digest();
  return Buffer.concat([Buffer.from("SSHSIG"), sshString(namespace), sshString(""), sshString(hash), sshString(digest)]);
}

class Reader {
  private at = 0;
  constructor(private readonly buf: Buffer) {}
  bytes(n: number): Buffer {
    if (this.at + n > this.buf.length) throw new DependencyApprovalError("truncated");
    const out = this.buf.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
  u32(): number {
    return this.bytes(4).readUInt32BE(0);
  }
  string(): Buffer {
    return this.bytes(this.u32());
  }
  done(): boolean {
    return this.at === this.buf.length;
  }
}

/** An ssh-ed25519 public key blob's 32-byte key, or null. */
function ed25519Key(blob: Buffer): Buffer | null {
  try {
    const r = new Reader(blob);
    const type = r.string().toString();
    const key = r.string();
    return type === "ssh-ed25519" && key.length === 32 && r.done() ? key : null;
  } catch {
    return null;
  }
}

function tokens(line: string): string[] {
  return line.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

function signerLine(line: string): AllowedSigner | null {
  const t = tokens(line);
  const keyAt = t[1] === "ssh-ed25519" ? 1 : 2;
  if (t.length < keyAt + 2 || t[keyAt] !== "ssh-ed25519") return null;
  let namespaces: string[] | null = null;
  if (keyAt === 2) {
    const m = /^namespaces="([^"]+)"$/.exec(t[1]!);
    if (!m) return null; // any other option (cert-authority, valid-before, …) makes the line untrusted
    namespaces = m[1]!.split(",");
  }
  const key = Buffer.from(t[keyAt + 1]!, "base64");
  if (!ed25519Key(key)) return null;
  const principals = t[0]!.replace(/^"|"$/g, "").split(",").filter((p) => p !== "" && !/[*?!]/.test(p));
  return principals.length > 0 ? { principals, namespaces, key } : null;
}

/** An `ssh-keygen` ALLOWED SIGNERS file, read fail-closed: ed25519 keys only; only the `namespaces` option. */
export function parseAllowedSigners(textIn: string): AllowedSigner[] {
  if (Buffer.byteLength(textIn, "utf8") > MAX_SIGNERS_BYTES) return [];
  return textIn
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map(signerLine)
    .filter((s): s is AllowedSigner => s !== null);
}

interface Sshsig {
  key: Buffer;
  namespace: string;
  hash: string;
  signature: Buffer;
}

function decodeSshsig(armored: string): Sshsig | null {
  const m = /^-----BEGIN SSH SIGNATURE-----\n([A-Za-z0-9+/=\n]+)-----END SSH SIGNATURE-----\n?$/.exec(armored);
  if (!m) return null;
  try {
    const r = new Reader(Buffer.from(m[1]!.replace(/\n/g, ""), "base64"));
    if (r.bytes(6).toString() !== "SSHSIG" || r.u32() !== 1) return null;
    const key = r.string();
    const namespace = r.string().toString();
    r.string(); // reserved
    const hash = r.string().toString();
    const sig = new Reader(r.string());
    if (!r.done() || sig.string().toString() !== "ssh-ed25519") return null;
    const signature = sig.string();
    return sig.done() && signature.length === 64 ? { key, namespace, hash, signature } : null;
  } catch {
    return null;
  }
}

type SshVerify = { status: "good"; principals: string[] } | { status: "bad"; detail: string };

/** Verify an armored SSHSIG over `message` for `namespace` against allowed signers. */
export function verifySshSignature(message: string, armored: string, namespace: string, signers: readonly AllowedSigner[]): SshVerify {
  const sig = decodeSshsig(armored);
  if (!sig) return { status: "bad", detail: "the signature is malformed (not an ed25519 SSHSIG)" };
  if (sig.namespace !== namespace) return { status: "bad", detail: `the signature is for namespace ${JSON.stringify(sig.namespace)}, not ${namespace}` };
  if (sig.hash !== "sha256" && sig.hash !== "sha512") return { status: "bad", detail: "the signature uses an unsupported hash" };
  const raw = ed25519Key(sig.key);
  const lines = signers.filter((s) => s.key.equals(sig.key) && (s.namespaces === null || s.namespaces.includes(namespace)));
  if (!raw || lines.length === 0) return { status: "bad", detail: "the signing key is not in the allowed signers" };
  const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
  if (!verify(null, sshSignatureSignedData(message, namespace, sig.hash), pub, sig.signature)) {
    return { status: "bad", detail: "the signature does not verify" };
  }
  return { status: "good", principals: [...new Set(lines.flatMap((s) => s.principals))].sort() };
}

/** An approval counts only when signed by a key the allowed signers list for its `approver`. */
export function verifyDependencyApproval(approval: DependencyApproval, signers: readonly AllowedSigner[]): { status: "good"; principal: string } | { status: "bad"; detail: string } {
  const v = verifySshSignature(approval.message, approval.signature, APPROVAL_SIGNATURE_NAMESPACE, signers);
  if (v.status === "bad") return v;
  if (!v.principals.includes(approval.approver)) return { status: "bad", detail: `the signing key is not listed for ${approval.approver}` };
  return { status: "good", principal: approval.approver };
}
