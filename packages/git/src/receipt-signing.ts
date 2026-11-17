import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalJson } from "#core/canonical-json.js";
import { gitConfigGet } from "./git.js";

export type ReceiptSignatureKind = "ssh" | "gpg" | "none";
export type ReceiptSignatureVerifyStatus = "good" | "bad" | "unknown";
export type ReceiptPayloadEncoding = "canonical_json_utf8";

export interface ReceiptSignature {
  kind: ReceiptSignatureKind;
  signature_b64: string;
  payload_encoding?: ReceiptPayloadEncoding;
  key_fingerprint?: string;
  signer_principal?: string;
  verify_status?: ReceiptSignatureVerifyStatus;
}

const RECEIPT_SIGN_NAMESPACE = "gxt";

function randomTempSuffix(): string {
  return crypto.randomBytes(8).toString("hex");
}

function expandHome(value: string): string {
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveSigningFormat(repoRoot: string): "ssh" | "gpg" {
  const fmt = gitConfigGet(repoRoot, "gpg.format")?.toLowerCase();
  return fmt === "ssh" ? "ssh" : "gpg";
}

function resolveSigningKey(repoRoot: string): string | null {
  const key = gitConfigGet(repoRoot, "user.signingkey");
  return key?.trim() ? key.trim() : null;
}

/** A key file named by `user.signingkey`: `~/` is home, a relative path is relative to the repository, as git reads it. */
function signingKeyFile(repoRoot: string, signingKey: string): string {
  return path.resolve(repoRoot, expandHome(signingKey));
}

function sshPrivateKeyPath(repoRoot: string, signingKey: string): string {
  const file = signingKeyFile(repoRoot, signingKey);
  return file.endsWith(".pub") ? file.slice(0, -4) : file;
}

function sshPublicKeyPath(repoRoot: string, signingKey: string): string {
  const file = signingKeyFile(repoRoot, signingKey);
  return file.endsWith(".pub") ? file : `${file}.pub`;
}

function sshKeyFingerprint(pubPath: string): string | undefined {
  const result = spawnSync("ssh-keygen", ["-l", "-f", pubPath], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const line = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const match = /SHA256:([A-Za-z0-9+/=]+)/.exec(line);
  return match ? `SHA256:${match[1]}` : undefined;
}

/** `ssh-keygen -Y sign` over `message` with the key file `keyFile` (a public key signs through ssh-agent), or null. */
function sshSign(keyFile: string, namespace: string, message: string): Buffer | null {
  const messagePath = path.join(os.tmpdir(), `gxt-sign-${randomTempSuffix()}.txt`);
  const sigPath = `${messagePath}.sig`;
  try {
    fs.writeFileSync(messagePath, message, "utf8");
    const result = spawnSync("ssh-keygen", ["-Y", "sign", "-f", keyFile, "-n", namespace, messagePath], { encoding: "utf8" });
    return result.status === 0 && fs.existsSync(sigPath) ? fs.readFileSync(sigPath) : null;
  } finally {
    for (const p of [messagePath, sigPath]) fs.rmSync(p, { force: true });
  }
}

/**
 * An armored SSH signature over `message` for `namespace` with the git signing key, as git signs commits: `gpg.format`
 * ssh, `user.signingkey` a key file (a `.pub` signs through ssh-agent) or a `key::` literal. Null when not configured
 * or signing fails. The break-glass note uses it (MSN-0385).
 */
export function sshSignWithGitKey(repoRoot: string, message: string, namespace: string): string | null {
  const signingKey = resolveSigningKey(repoRoot);
  if (!signingKey || resolveSigningFormat(repoRoot) !== "ssh") return null;
  if (!signingKey.startsWith("key::")) return sshSign(signingKeyFile(repoRoot, signingKey), namespace, message)?.toString("utf8") ?? null;
  const keyFile = path.join(os.tmpdir(), `gxt-signing-key-${randomTempSuffix()}.pub`);
  try {
    fs.writeFileSync(keyFile, `${signingKey.slice("key::".length)}\n`, { mode: 0o600 });
    return sshSign(keyFile, namespace, message)?.toString("utf8") ?? null;
  } finally {
    fs.rmSync(keyFile, { force: true });
  }
}

/** Canonical UTF-8 JSON of a body without its signature: what `verify --sign` and the export envelope sign. */
export function canonicalReceiptUtf8(signed: object): string {
  const { signature: _signature, ...body } = signed as { signature?: unknown };
  return canonicalJson(body);
}

export function signReceiptMessage(
  repoRoot: string,
  message: string,
  payloadEncoding: ReceiptPayloadEncoding,
): ReceiptSignature | null {
  const signingKey = resolveSigningKey(repoRoot);
  if (!signingKey) return null;

  if (resolveSigningFormat(repoRoot) === "ssh") {
    const keyPath = sshPrivateKeyPath(repoRoot, signingKey);
    const sig = sshSign(keyPath, RECEIPT_SIGN_NAMESPACE, message);
    if (!sig) return null;
    return {
      kind: "ssh",
      signature_b64: sig.toString("base64"),
      payload_encoding: payloadEncoding,
      key_fingerprint: sshKeyFingerprint(sshPublicKeyPath(repoRoot, signingKey)) ?? path.basename(keyPath),
      verify_status: "unknown",
    };
  }

  const result = spawnSync(
    "gpg",
    ["--detach-sign", "--armor", "--local-user", signingKey, "--output", "-"],
    { input: message, encoding: "utf8" },
  );
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (result.status !== 0 || !stdout) return null;
  return {
    kind: "gpg",
    signature_b64: Buffer.from(stdout, "utf8").toString("base64"),
    payload_encoding: payloadEncoding,
    key_fingerprint: signingKey,
    verify_status: "unknown",
  };
}

/**
 * Verify a signature against an allowed-signers file (a team's or CI's list, `ssh-keygen` ALLOWED SIGNERS format)
 * instead of the local signing key, and name the signer. SSH only: other kinds report `unknown`.
 */
export function verifySignatureWithAllowedSigners(
  message: string,
  signature: ReceiptSignature,
  allowedSignersFile: string,
): { status: ReceiptSignatureVerifyStatus; principal: string | null } {
  if (signature.kind !== "ssh") return { status: "unknown", principal: null };
  const sigPath = path.join(os.tmpdir(), `gxt-receipt-verify-${randomTempSuffix()}.sig`);
  try {
    fs.writeFileSync(sigPath, Buffer.from(signature.signature_b64, "base64"));
    const found = spawnSync("ssh-keygen", ["-Y", "find-principals", "-s", sigPath, "-f", allowedSignersFile], { encoding: "utf8" });
    const principals = found.status === 0 ? found.stdout.split("\n").map((l) => l.trim()).filter(Boolean) : [];
    for (const principal of principals) {
      const result = spawnSync(
        "ssh-keygen",
        ["-Y", "verify", "-f", allowedSignersFile, "-I", principal, "-n", RECEIPT_SIGN_NAMESPACE, "-s", sigPath],
        { input: message, encoding: "utf8" },
      );
      if (result.status === 0) return { status: "good", principal };
    }
    return { status: "bad", principal: null };
  } finally {
    try {
      fs.unlinkSync(sigPath);
    } catch {
      /* best effort */
    }
  }
}
