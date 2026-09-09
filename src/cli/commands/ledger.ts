import fs from "node:fs";
import { logInfo } from "../lib/cli-io.js";
import { emitCliJson, runUserCommand } from "../lib/command-boundary.js";
import { loadWorkspace } from "../lib/workspace.js";
import { LEDGER_REF } from "../lib/constants.js";
import { gitRun } from "../lib/git.js";
import { appendLedgerEntry } from "../lib/ledger/ledger-append.js";
import { sha256Utf8, type ReceiptLedgerPayload } from "../lib/ledger/ledger-entry.js";
import { exportLedgerJson, exportSoc2Pack } from "../lib/ledger/ledger-export.js";
import { verifyLedgerChain } from "../lib/ledger/ledger-chain.js";
import { parseMissionFile } from "../lib/missions/parser.js";
import { resolveMissionArg } from "../lib/mission-arg.js";

export function runLedgerAppend(opts: {
  fromEnvelope?: string;
  mission?: string;
  json?: boolean;
}): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    let msnId = "MSN-0000";
    let payload: ReceiptLedgerPayload = { source: "manual", verify_status: "passed", signed: false };
    if (opts.mission) {
      const resolved = resolveMissionArg(root, opts.mission);
      const mission = parseMissionFile(root, resolved.missionRel);
      msnId = mission.msnId ?? msnId;
    }
    if (opts.fromEnvelope) {
      const text = fs.readFileSync(opts.fromEnvelope, "utf8");
      const raw = JSON.parse(text) as { payload_b64?: string };
      payload = { envelope_sha: sha256Utf8(text), has_payload: Boolean(raw.payload_b64) };
    }
    const entry = appendLedgerEntry(root, { kind: "receipt", msn_id: msnId, payload });
    if (opts.json) {
      emitCliJson({ status: "ok", entry });
      return;
    }
    logInfo(`gantry ledger append: ${entry.entry_kind} ${entry.msn_id}`);
  });
}

export function runLedgerVerify(opts: { json?: boolean; requireSignatures?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const report = verifyLedgerChain(root, LEDGER_REF, {
      requireSignatures: opts.requireSignatures === true,
    });
    if (opts.json) {
      emitCliJson(report);
      return;
    }
    logInfo(`gantry ledger verify: ${report.ok ? "ok" : "FAIL"} ${report.count} entries`);
    for (const e of report.errors) logInfo(e);
  });
}

export function runLedgerList(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const entries = verifyLedgerChain(root).entries;
    if (opts.json) {
      emitCliJson({ status: "ok", entries });
      return;
    }
    for (const e of entries) logInfo(`${e.issued_at} ${e.entry_kind} ${e.msn_id}`);
  });
}

export function runLedgerExport(opts: { format?: string; out?: string; json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const out = opts.out?.trim() || ".gitagent/history/ledger-export";
    const dest = opts.format === "soc2-pack" ? exportSoc2Pack(root, out) : exportLedgerJson(root, out);
    if (opts.json) {
      emitCliJson({ status: "ok", out: dest });
      return;
    }
    logInfo(`gantry ledger export: ${dest}`);
  });
}

export function runLedgerPush(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const r = gitRun(root, ["push", "origin", LEDGER_REF]);
    if (opts.json) {
      emitCliJson({ status: r.ok ? "ok" : "error", stderr: r.stderr });
      return;
    }
    logInfo(r.ok ? `gantry ledger push: ${LEDGER_REF}` : `gantry ledger push: ${r.stderr}`);
  });
}

export function runLedgerFetch(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const r = gitRun(root, ["fetch", "origin", `${LEDGER_REF}:${LEDGER_REF}`]);
    if (opts.json) {
      emitCliJson({ status: r.ok ? "ok" : "error", stderr: r.stderr });
      return;
    }
    logInfo(r.ok ? `gantry ledger fetch: ${LEDGER_REF}` : `gantry ledger fetch: ${r.stderr}`);
  });
}
