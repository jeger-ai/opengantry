import fs from "node:fs";
import path from "node:path";
import { REL_RECEIPTS_DIR } from "../constants.js";
import { verifyLedgerChain } from "./ledger-chain.js";

export const SOC2_CONTROL_MAP = [
  { framework: "ISO 27001", control: "A.5.3", mapping: "Planner stamp + mission YAML + verify ledger entry" },
  { framework: "ISO 27001", control: "A.8.15", mapping: "refs/gxt/ledger + EXECUTOR_LOG.md quotes" },
  { framework: "ISO 27001", control: "A.8.28", mapping: "TMVC + policy floor (mandatory_gates, banned_imports)" },
  { framework: "ISO 42001", control: "AI boundaries", mapping: "Mission depends_on + interrogation record" },
  { framework: "SOC 2", control: "CC7", mapping: "Ledger chain verify + doctor ledger health" },
  { framework: "SOC 2", control: "CC8", mapping: "Planner git-proof + receipt / verify_findings entries" },
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
  const receiptsDir = path.join(root, REL_RECEIPTS_DIR);
  const destReceipts = path.join(outDir, "receipts");
  if (fs.existsSync(receiptsDir)) {
    fs.mkdirSync(destReceipts, { recursive: true });
    for (const name of fs.readdirSync(receiptsDir)) {
      if (name.endsWith(".json")) {
        fs.copyFileSync(path.join(receiptsDir, name), path.join(destReceipts, name));
      }
    }
  }
  return outDir;
}
