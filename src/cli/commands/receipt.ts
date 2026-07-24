import { logInfo } from "../lib/cli-io.js";
import { emitCliJson, runUserCommand } from "../lib/command-boundary.js";
import {
  listReceipts,
  resolveReceiptPath,
  summarizeReceipt,
} from "../lib/receipt-inspect.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface ReceiptListOptions {
  msn?: string;
  json?: boolean;
}

export interface ReceiptShowOptions {
  target?: string;
  json?: boolean;
}

export function runReceiptList(options: ReceiptListOptions): void {
  runUserCommand({ json: options.json }, () => {
    const { root } = loadWorkspace();
    const entries = listReceipts(root, options.msn);
    if (options.json) {
      emitCliJson({ status: "ok", receipts: entries });
      return;
    }
    if (entries.length === 0) {
      logInfo("gantry receipt list: (no receipts)");
      return;
    }
    for (const e of entries) {
      logInfo(`${e.path}  ${e.msn_id}  ${e.verify_status}  ${e.receipt_sha256.slice(0, 12)}`);
    }
  });
}

export function runReceiptShow(options: ReceiptShowOptions): void {
  runUserCommand({ json: options.json }, () => {
    const { root } = loadWorkspace();
    const { relPath, receipt } = resolveReceiptPath(root, options.target);
    const summary = summarizeReceipt(relPath, receipt);
    if (options.json) {
      emitCliJson({ status: "ok", receipt: summary, raw: receipt });
      return;
    }
    logInfo(`gantry receipt show: ${summary.path}`);
    logInfo(`  msn_id: ${summary.msn_id}`);
    logInfo(`  verify_status: ${summary.verify_status}`);
    logInfo(`  receipt_sha256: ${summary.receipt_sha256}`);
    logInfo(`  mission_rel: ${summary.mission_rel}`);
    logInfo(`  git_head: ${summary.git_head}`);
    logInfo(`  issued_at: ${summary.issued_at}`);
    if (summary.error_code) logInfo(`  error_code: ${summary.error_code}`);
    if (summary.signature_verify_status) {
      logInfo(`  signature.verify_status: ${summary.signature_verify_status}`);
    }
  });
}
