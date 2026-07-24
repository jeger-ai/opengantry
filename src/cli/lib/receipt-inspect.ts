import fs from "node:fs";
import path from "node:path";

import { formatRepoRelative } from "./cli-io.js";
import { REL_RECEIPTS_DIR, MSN_ID_PATTERN } from "./constants.js";
import { GantryUserError } from "./errors.js";
import type { AttestationReceipt } from "./attestation-receipt.js";

export interface ReceiptListEntry {
  path: string;
  msn_id: string;
  verify_status: string;
  receipt_sha256: string;
  mtime_ms: number;
}

function receiptsDir(root: string): string {
  return path.join(root, REL_RECEIPTS_DIR);
}

function parseReceiptFile(absPath: string): AttestationReceipt | null {
  try {
    const raw = fs.readFileSync(absPath, "utf8");
    return JSON.parse(raw) as AttestationReceipt;
  } catch {
    return null;
  }
}

function loadReceiptOrThrow(absPath: string, label: string): AttestationReceipt {
  const receipt = parseReceiptFile(absPath);
  if (!receipt) {
    throw new GantryUserError(
      "RECEIPT_NOT_FOUND",
      `${label}: invalid receipt at ${absPath}`,
      undefined,
      1,
    );
  }
  return receipt;
}

function entryFromFile(root: string, absPath: string): ReceiptListEntry | null {
  const receipt = parseReceiptFile(absPath);
  if (!receipt?.msn_id) return null;
  const stat = fs.statSync(absPath);
  return {
    path: formatRepoRelative(root, absPath),
    msn_id: receipt.msn_id,
    verify_status: receipt.verify_status,
    receipt_sha256: receipt.receipt_sha256,
    mtime_ms: stat.mtimeMs,
  };
}

export function listReceipts(root: string, msnFilter?: string): ReceiptListEntry[] {
  const dir = receiptsDir(root);
  if (!fs.existsSync(dir)) return [];
  const filter = msnFilter?.trim().toUpperCase();
  const entries: ReceiptListEntry[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    if (filter && !name.startsWith(`${filter}-`)) continue;
    const abs = path.join(dir, name);
    const entry = entryFromFile(root, abs);
    if (entry) entries.push(entry);
  }
  entries.sort((a, b) => b.mtime_ms - a.mtime_ms);
  return entries;
}

export function resolveReceiptPath(
  root: string,
  arg?: string,
): { absPath: string; relPath: string; receipt: AttestationReceipt } {
  const trimmed = arg?.trim();
  if (!trimmed) {
    const latest = listReceipts(root)[0];
    if (!latest) {
      throw new GantryUserError(
        "RECEIPT_NOT_FOUND",
        "gantry receipt show: no receipts under .gitagent/history/receipts/",
        "Run gantry verify --receipt or gantry attest first",
        1,
      );
    }
    const abs = path.join(root, latest.path);
    return { absPath: abs, relPath: latest.path, receipt: loadReceiptOrThrow(abs, "gantry receipt show") };
  }

  if (MSN_ID_PATTERN.test(trimmed)) {
    const matches = listReceipts(root, trimmed);
    if (matches.length === 0) {
      throw new GantryUserError(
        "RECEIPT_NOT_FOUND",
        `gantry receipt show: no receipts for ${trimmed}`,
        undefined,
        1,
      );
    }
    const abs = path.join(root, matches[0].path);
    return {
      absPath: abs,
      relPath: matches[0].path,
      receipt: loadReceiptOrThrow(abs, "gantry receipt show"),
    };
  }

  const abs = path.isAbsolute(trimmed) ? trimmed : path.join(root, trimmed);
  if (!fs.existsSync(abs)) {
    throw new GantryUserError("RECEIPT_NOT_FOUND", `gantry receipt show: file not found: ${trimmed}`, undefined, 1);
  }
  return {
    absPath: abs,
    relPath: formatRepoRelative(root, abs),
    receipt: loadReceiptOrThrow(abs, "gantry receipt show"),
  };
}

export interface ReceiptShowSummary {
  path: string;
  msn_id: string;
  verify_status: string;
  receipt_sha256: string;
  mission_rel: string;
  git_head: string;
  issued_at: string;
  error_code?: string;
  signature_verify_status?: string;
}

export function summarizeReceipt(relPath: string, receipt: AttestationReceipt): ReceiptShowSummary {
  return {
    path: relPath,
    msn_id: receipt.msn_id,
    verify_status: receipt.verify_status,
    receipt_sha256: receipt.receipt_sha256,
    mission_rel: receipt.mission_rel,
    git_head: receipt.git_head,
    issued_at: receipt.issued_at,
    ...(receipt.error_code ? { error_code: receipt.error_code } : {}),
    ...(receipt.signature?.verify_status
      ? { signature_verify_status: receipt.signature.verify_status }
      : {}),
  };
}
