import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { gitConfigGet } from "./git.js";

export type ReceiptSignatureKind = "ssh" | "gpg" | "none";
export type ReceiptSignatureVerifyStatus = "good" | "bad" | "unknown";

export interface ReceiptSignature {
  kind: ReceiptSignatureKind;
  signature_b64: string;
  key_fingerprint?: string;
  signer_principal?: string;
  verify_status?: ReceiptSignatureVerifyStatus;
}

const RECEIPT_SIGN_NAMESPACE = "gxt";

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

export function signReceiptHash(repoRoot: string, receiptSha256: string): ReceiptSignature | null {
  const signingKey = resolveSigningKey(repoRoot);
  if (!signingKey) return null;

  if (resolveSigningFormat(repoRoot) === "ssh") {
    const keyPath = sshPrivateKeyPath(signingKey);
    const pubPath = sshPublicKeyPath(signingKey);
    const principal = resolveSshSignerPrincipal(repoRoot);
    const messagePath = path.join(os.tmpdir(), `gxt-receipt-${process.pid}-${Date.now()}.txt`);
    const sigPath = `${messagePath}.sig`;
    try {
      fs.writeFileSync(messagePath, receiptSha256, "utf8");
      const result = spawnSync(
        "ssh-keygen",
        ["-Y", "sign", "-f", keyPath, "-n", RECEIPT_SIGN_NAMESPACE, messagePath],
        { encoding: "utf8" },
      );
      if (result.status !== 0 || !fs.existsSync(sigPath)) return null;
      return {
        kind: "ssh",
        signature_b64: fs.readFileSync(sigPath).toString("base64"),
        key_fingerprint: sshKeyFingerprint(pubPath) ?? path.basename(keyPath),
        signer_principal: principal,
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
    { input: receiptSha256, encoding: "utf8" },
  );
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (result.status !== 0 || !stdout) return null;
  return {
    kind: "gpg",
    signature_b64: Buffer.from(stdout, "utf8").toString("base64"),
    key_fingerprint: signingKey,
    verify_status: "unknown",
  };
}

export function verifyReceiptSignature(
  repoRoot: string,
  receiptSha256: string,
  signature: ReceiptSignature,
): ReceiptSignatureVerifyStatus {
  if (signature.kind === "none") return "unknown";

  if (signature.kind === "ssh") {
    const signingKey = resolveSigningKey(repoRoot);
    if (!signingKey) return "unknown";
    const pubPath = sshPublicKeyPath(signingKey);
    const principal = signature.signer_principal ?? resolveSshSignerPrincipal(repoRoot);
    const allowedSignersPath = path.join(
      os.tmpdir(),
      `gxt-receipt-allowed-${process.pid}-${Date.now()}.txt`,
    );
    const sigPath = path.join(os.tmpdir(), `gxt-receipt-verify-${process.pid}-${Date.now()}.sig`);
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
        { input: receiptSha256, encoding: "utf8" },
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

  const sigPath = path.join(os.tmpdir(), `gxt-receipt-gpg-${process.pid}-${Date.now()}.asc`);
  try {
    fs.writeFileSync(sigPath, Buffer.from(signature.signature_b64, "base64"));
    const result = spawnSync("gpg", ["--verify", sigPath, "-"], {
      input: receiptSha256,
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
