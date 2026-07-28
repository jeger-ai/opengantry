import fs from "node:fs";
import path from "node:path";

import type { AttestationReceipt } from "./attestation-receipt.js";
import { canonicalReceiptUtf8, type ReceiptSignature } from "./receipt-signing.js";

export const ATTESTATION_EXPORT_SCHEMA_VERSION = "1.0.0" as const;

export interface AttestationExportEnvelope {
  envelope_schema_version: typeof ATTESTATION_EXPORT_SCHEMA_VERSION;
  payload_b64: string;
  signature?: ReceiptSignature;
}

export function buildAttestationExportEnvelope(receipt: AttestationReceipt): AttestationExportEnvelope {
  const canonicalUtf8 = canonicalReceiptUtf8(receipt);
  const envelope: AttestationExportEnvelope = {
    envelope_schema_version: ATTESTATION_EXPORT_SCHEMA_VERSION,
    payload_b64: Buffer.from(canonicalUtf8, "utf8").toString("base64"),
  };
  if (receipt.signature) {
    envelope.signature = receipt.signature;
  }
  return envelope;
}

export function writeAttestationExportEnvelope(
  root: string,
  receipt: AttestationReceipt,
  outPath: string,
): string {
  const target = path.resolve(root, outPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const envelope = buildAttestationExportEnvelope(receipt);
  fs.writeFileSync(target, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  return target;
}
