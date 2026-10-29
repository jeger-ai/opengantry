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

function sshPrivateKeyPath(signingKey: string): string {
  const expanded = expandHome(signingKey);
  return expanded.endsWith(".pub") ? expanded.slice(0, -4) : expanded;
}

function sshPublicKeyPath(signingKey: string): string {
  const expanded = expandHome(signingKey);
  return expanded.endsWith(".pub") ? expanded : `${expanded}.pub`;
}

function sshKeyFingerprint(pubPath: string): string | undefined {
  const result = spawnSync("ssh-keygen", ["-l", "-f", pubPath], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const line = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const match = /SHA256:([A-Za-z0-9+/=]+)/.exec(line);
  return match ? `SHA256:${match[1]}` : undefined;
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
    const keyPath = sshPrivateKeyPath(signingKey);
    const pubPath = sshPublicKeyPath(signingKey);
    const messagePath = path.join(os.tmpdir(), `gxt-receipt-${randomTempSuffix()}.txt`);
    const sigPath = `${messagePath}.sig`;
    try {
      fs.writeFileSync(messagePath, message, "utf8");
      const result = spawnSync(
        "ssh-keygen",
        ["-Y", "sign", "-f", keyPath, "-n", RECEIPT_SIGN_NAMESPACE, messagePath],
        { encoding: "utf8" },
      );
      if (result.status !== 0 || !fs.existsSync(sigPath)) return null;
      return {
        kind: "ssh",
        signature_b64: fs.readFileSync(sigPath).toString("base64"),
        payload_encoding: payloadEncoding,
        key_fingerprint: sshKeyFingerprint(pubPath) ?? path.basename(keyPath),
        verify_status: "unknown",
      };
    } finally {
      try {
        fs.unlinkSync(messagePath);
      } catch {
        /* best effort */
      }
      try {
        fs.unlinkSync(sigPath);
      } catch {
        /* best effort */
      }
    }
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
