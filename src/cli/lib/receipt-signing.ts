import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalJson } from "./canonical-json.js";
import { gitConfigGet } from "./git.js";

export type ReceiptSignatureKind = "ssh" | "gpg" | "none";
export type ReceiptSignatureVerifyStatus = "good" | "bad" | "unknown";
export type ReceiptPayloadEncoding = "receipt_sha256_hex" | "canonical_json_utf8";

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

function resolveSshSignerPrincipal(repoRoot: string): string {
  return gitConfigGet(repoRoot, "user.email") ?? "gxt@local";
}

function sshKeyFingerprint(pubPath: string): string | undefined {
  const result = spawnSync("ssh-keygen", ["-l", "-f", pubPath], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const line = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const match = /SHA256:([A-Za-z0-9+/=]+)/.exec(line);
  return match ? `SHA256:${match[1]}` : undefined;
}

function writeAllowedSignersFile(pubPath: string, principal: string, outPath: string): void {
  const pubLine = fs.readFileSync(pubPath, "utf8").trim();
  fs.writeFileSync(outPath, `${principal} ${pubLine}\n`, "utf8");
}

export function unsignedReceiptPayload(
  input: Record<string, unknown> & { receipt_sha256?: string; signature?: unknown },
): Record<string, unknown> {
  const { receipt_sha256: _receiptSha, signature: _signature, ...rest } = input;
  return { ...rest };
}

/** Canonical UTF-8 JSON of receipt body (includes receipt_sha256; excludes signature). */
export function canonicalReceiptUtf8<T extends { signature?: unknown }>(receipt: T): string {
  const { signature: _signature, ...body } = receipt;
  return canonicalJson(body);
}

export function resolveSignatureMessage(
  receiptSha256: string,
  canonicalUtf8: string,
  encoding: ReceiptPayloadEncoding | undefined,
): string {
  if (encoding === "canonical_json_utf8") return canonicalUtf8;
  return receiptSha256;
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

/** @deprecated v0.1.0 — signs receipt_sha256 hex only. */
export function signReceiptHash(repoRoot: string, receiptSha256: string): ReceiptSignature | null {
  return signReceiptMessage(repoRoot, receiptSha256, "receipt_sha256_hex");
}

export function verifyReceiptSignature(
  repoRoot: string,
  message: string,
  signature: ReceiptSignature,
): ReceiptSignatureVerifyStatus {
  if (signature.kind === "none") return "unknown";

  if (signature.kind === "ssh") {
    const signingKey = resolveSigningKey(repoRoot);
    if (!signingKey) return "unknown";
    const pubPath = sshPublicKeyPath(signingKey);
    const principal =
      signature.signer_principal ?? resolveSshSignerPrincipal(repoRoot);
    const allowedSignersPath = path.join(os.tmpdir(), `gxt-receipt-allowed-${randomTempSuffix()}.txt`);
    const sigPath = path.join(os.tmpdir(), `gxt-receipt-verify-${randomTempSuffix()}.sig`);
    try {
      writeAllowedSignersFile(pubPath, principal, allowedSignersPath);
      fs.writeFileSync(sigPath, Buffer.from(signature.signature_b64, "base64"));
      const result = spawnSync(
        "ssh-keygen",
        [
          "-Y",
          "verify",
          "-f",
          allowedSignersPath,
          "-I",
          principal,
          "-n",
          RECEIPT_SIGN_NAMESPACE,
          "-s",
          sigPath,
        ],
        { input: message, encoding: "utf8" },
      );
      return result.status === 0 ? "good" : "bad";
    } finally {
      for (const file of [allowedSignersPath, sigPath]) {
        try {
          fs.unlinkSync(file);
        } catch {
          /* best effort */
        }
      }
    }
  }

  const sigPath = path.join(os.tmpdir(), `gxt-receipt-gpg-${randomTempSuffix()}.asc`);
  try {
    fs.writeFileSync(sigPath, Buffer.from(signature.signature_b64, "base64"));
    const result = spawnSync("gpg", ["--verify", sigPath, "-"], {
      input: message,
      encoding: "utf8",
    });
    return result.status === 0 ? "good" : "bad";
  } finally {
    try {
      fs.unlinkSync(sigPath);
    } catch {
      /* best effort */
    }
  }
}

export function verifyReceiptAgainstCanonical(
  repoRoot: string,
  receipt: { receipt_sha256: string; signature?: ReceiptSignature },
  canonicalUtf8: string,
): ReceiptSignatureVerifyStatus {
  if (!receipt.signature) return "unknown";
  const encoding = receipt.signature.payload_encoding ?? "receipt_sha256_hex";
  const message = resolveSignatureMessage(receipt.receipt_sha256, canonicalUtf8, encoding);
  return verifyReceiptSignature(repoRoot, message, receipt.signature);
}
