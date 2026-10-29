import fs from "node:fs";
import path from "node:path";
import { REL_RUNS_DIR } from "#core/constants.js";
import { RUN_RECORD_SCHEMA, type RunRecord } from "#core/run-record.js";
import { GantryUserError, isGantryUserError } from "#core/user-error.js";
import { canonicalReceiptUtf8, signReceiptMessage, type ReceiptSignature } from "#git/receipt-signing.js";
import { verifyLedgerChain } from "./ledger-chain.js";

export const SOC2_CONTROL_MAP = [
  { framework: "ISO 27001", control: "A.5.3", mapping: "Planner stamp + mission YAML + verify ledger entry" },
  { framework: "ISO 27001", control: "A.8.15", mapping: "refs/gxt/ledger + EXECUTOR_LOG.md quotes" },
  { framework: "ISO 27001", control: "A.8.28", mapping: "TMVC + policy floor (mandatory_gates, banned_imports)" },
  { framework: "ISO 42001", control: "AI boundaries", mapping: "Mission depends_on + interrogation record" },
  { framework: "SOC 2", control: "CC7", mapping: "Ledger chain verify + doctor ledger health" },
  { framework: "SOC 2", control: "CC8", mapping: "Planner git-proof + run records + receipt / verify_findings entries" },
] as const;

export function exportLedgerJson(root: string, outDir: string): string {
  const report = verifyLedgerChain(root);
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, "ledger.json");
  fs.writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return dest;
}

export function exportSoc2Pack(root: string, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  exportLedgerJson(root, outDir);
  fs.writeFileSync(
    path.join(outDir, "control-map.json"),
    `${JSON.stringify({ schema_version: "1.0.0", controls: SOC2_CONTROL_MAP }, null, 2)}\n`,
    "utf8",
  );
  const runsDir = path.join(root, REL_RUNS_DIR);
  if (fs.existsSync(runsDir)) {
    fs.mkdirSync(path.join(outDir, "runs"), { recursive: true });
    for (const name of fs.readdirSync(runsDir).filter((n) => n.endsWith(".json"))) {
      fs.copyFileSync(path.join(runsDir, name), path.join(outDir, "runs", name));
    }
  }
  return outDir;
}

/** The hub export envelope (ADR-0061): the canonical run record, optionally signed with the git signing key. */
export const EXPORT_ENVELOPE_SCHEMA_VERSION = "2.0.0" as const;

export interface ExportEnvelope {
  envelope_schema_version: typeof EXPORT_ENVELOPE_SCHEMA_VERSION;
  payload_b64: string;
  signature?: ReceiptSignature;
}

export function writeExportEnvelope(root: string, record: RunRecord, outPath: string, sign: boolean): string {
  const canonical = canonicalReceiptUtf8(record);
  const envelope: ExportEnvelope = { envelope_schema_version: EXPORT_ENVELOPE_SCHEMA_VERSION, payload_b64: Buffer.from(canonical, "utf8").toString("base64") };
  if (sign) {
    const signature = signReceiptMessage(root, canonical, "canonical_json_utf8");
    if (!signature) throw new GantryUserError("INVALID_ARGUMENT", "gantry verify --export --sign: no local SSH/GPG signing key is configured", "configure user.signingkey and gpg.format", 2);
    envelope.signature = signature;
  }
  const target = path.resolve(root, outPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  return target;
}

/** The run record an envelope carries. A 1.x envelope (a pre-4.0 attestation receipt) is refused. */
export function readExportEnvelope(text: string): RunRecord {
  const invalid = (why: string): GantryUserError =>
    new GantryUserError("INVALID_ARGUMENT", `export envelope: ${why}`, "re-export it with gantry verify --export (envelope 2.0 over the run record)", 2);
  let envelope: Partial<ExportEnvelope>;
  let record: Partial<RunRecord>;
  try {
    envelope = JSON.parse(text) as Partial<ExportEnvelope>;
    if (envelope.envelope_schema_version !== EXPORT_ENVELOPE_SCHEMA_VERSION) throw invalid(`envelope_schema_version ${String(envelope.envelope_schema_version)} is not ${EXPORT_ENVELOPE_SCHEMA_VERSION}`);
    record = JSON.parse(Buffer.from(envelope.payload_b64 ?? "", "base64").toString("utf8")) as Partial<RunRecord>;
  } catch (e) {
    throw isGantryUserError(e) ? e : invalid("not JSON");
  }
  if (record.schema !== RUN_RECORD_SCHEMA || record.status !== "PASS" || typeof record.msn_id !== "string") throw invalid(`payload is not a passing ${RUN_RECORD_SCHEMA}`);
  return record as RunRecord;
}
