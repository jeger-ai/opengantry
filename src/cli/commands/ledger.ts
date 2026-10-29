import fs from "node:fs";
import { loadWorkspace } from "#missions/workspace.js";
import { LEDGER_REF } from "#core/constants.js";
import { gitRun } from "#git/git.js";
import { appendLedgerEntry } from "#missions/ledger/ledger-append.js";
import type { ReceiptLedgerPayload } from "#plane/ledger-entry.js";
import { exportLedgerJson, exportSoc2Pack, readExportEnvelope } from "#plane/ledger-export.js";
import { runRecordDigest } from "#core/run-record.js";
import { verifyLedgerChain } from "#plane/ledger-chain.js";
import { parseMissionFile } from "#missions/mission/parser.js";
import { resolveMissionArg } from "../flows/mission-arg.js";
import { msnIdOrDefault } from "#core/mission-types.js";
import { runUserCommand } from "../output/command-boundary.js";

export function runLedgerAppend(opts: {
  fromEnvelope?: string;
  mission?: string;
  json?: boolean;
}): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    let msnId = msnIdOrDefault(undefined);
    let payload: ReceiptLedgerPayload = { source: "manual", verify_status: "passed", signed: false };
    if (opts.mission) {
      const resolved = resolveMissionArg(root, opts.mission);
      const mission = parseMissionFile(root, resolved.missionRel);
      msnId = msnIdOrDefault(mission);
    }
    if (opts.fromEnvelope) {
      const record = readExportEnvelope(fs.readFileSync(opts.fromEnvelope, "utf8"));
      msnId = record.msn_id;
      payload = { verify_status: "passed", run_record_sha256: runRecordDigest(record) };
    }
    const entry = appendLedgerEntry(root, { kind: "receipt", msn_id: msnId, payload });
    return {
      json: { status: "ok", entry },
      human: `gantry ledger append: ${entry.entry_kind} ${entry.msn_id}`,
    };
  });
}

export function runLedgerVerify(opts: { json?: boolean; requireSignatures?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const report = verifyLedgerChain(root, LEDGER_REF, {
      requireSignatures: opts.requireSignatures === true,
    });
    return {
      json: report,
      human: [
        `gantry ledger verify: ${report.ok ? "ok" : "FAIL"} ${report.count} entries`,
        ...report.errors,
      ],
    };
  });
}

export function runLedgerList(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const entries = verifyLedgerChain(root).entries;
    return {
      json: { status: "ok", entries },
      human: entries.map((e) => `${e.issued_at} ${e.entry_kind} ${e.msn_id}`),
    };
  });
}

export function runLedgerExport(opts: { format?: string; out?: string; json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const out = opts.out?.trim() || ".gitagent/history/ledger-export";
    const dest = opts.format === "soc2-pack" ? exportSoc2Pack(root, out) : exportLedgerJson(root, out);
    return { json: { status: "ok", out: dest }, human: `gantry ledger export: ${dest}` };
  });
}

export function runLedgerPush(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const r = gitRun(root, ["push", "origin", LEDGER_REF]);
    return {
      json: { status: r.ok ? "ok" : "error", stderr: r.stderr },
      human: r.ok ? `gantry ledger push: ${LEDGER_REF}` : `gantry ledger push: ${r.stderr}`,
    };
  });
}

export function runLedgerFetch(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const r = gitRun(root, ["fetch", "origin", `${LEDGER_REF}:${LEDGER_REF}`]);
    return {
      json: { status: r.ok ? "ok" : "error", stderr: r.stderr },
      human: r.ok ? `gantry ledger fetch: ${LEDGER_REF}` : `gantry ledger fetch: ${r.stderr}`,
    };
  });
}
