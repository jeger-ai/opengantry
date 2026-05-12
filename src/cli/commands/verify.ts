import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import { gatePassed, runGate } from "../lib/gate.js";
import { assertMissionGatePresent, parseMissionFile } from "../lib/mission-parser.js";
import { defaultWorkerLogPath, verifyTraceRows } from "../lib/trace.js";

export function runVerify(opts: { mission: string; workerLog?: string; cwd?: string }): void {
  const root = getRepoRoot();
  const m = parseMissionFile(root, opts.mission);
  assertMissionGatePresent(m);
  const gate = m.gate!;
  const workDir = opts.cwd ? path.resolve(root, opts.cwd) : root;
  const workerLog = opts.workerLog ? path.resolve(root, opts.workerLog) : defaultWorkerLogPath(root);

  const gr = runGate(workDir, gate);
  if (!gatePassed(gr, gate.successSubstring)) {
    console.error("gapman verify: GATE FAILED");
    console.error("--- stdout ---\n" + gr.stdout);
    console.error("--- stderr ---\n" + gr.stderr);
    console.error(`exit code: ${gr.exitCode}`);
    process.exitCode = 1;
    return;
  }
  console.log("gapman verify: gate passed");

  const traceFails = verifyTraceRows(workerLog, m.traceRows);
  if (traceFails.length > 0) {
    console.error("gapman verify: TRACE MAPPING FAILED (Evidence Tampering / missing evidence)");
    for (const f of traceFails) {
      console.error(`  DoD ${f.row.dodId}: ${f.reason}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`gapman verify: trace mapping OK (${workerLog})`);
}
