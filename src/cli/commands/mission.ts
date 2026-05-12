import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import { loadManifest } from "../lib/manifest.js";
import { assertMissionGatePresent, parseMissionFile } from "../lib/mission-parser.js";
import { captureStartState, writeSnapshot } from "../lib/start-state.js";

export function runMissionValidate(file: string): void {
  const root = getRepoRoot();
  const m = parseMissionFile(root, file);
  assertMissionGatePresent(m);
  console.log(`gapman mission validate: OK (${m.rawPath})`);
  if (m.gate) console.log(`  gate: ${m.gate.command}`);
}

export function runMissionSnapshot(file: string, msnOverride?: string): void {
  const root = getRepoRoot();
  const manifest = loadManifest(root);
  const m = parseMissionFile(root, file);
  assertMissionGatePresent(m);
  const msn = msnOverride ?? m.msnId;
  if (!msn || !/^MSN-\d{4}$/.test(msn)) {
    console.error("gapman mission snapshot: need MSN-NNNN in mission or pass --msn");
    process.exitCode = 1;
    return;
  }
  const snap = captureStartState(root, manifest, m.skillKey);
  const out = writeSnapshot(root, snap, msn);
  console.log(`gapman mission snapshot: wrote ${path.relative(root, out)}`);
}
