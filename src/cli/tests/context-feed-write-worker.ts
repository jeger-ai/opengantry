/**
 * Multiprocess test helper — spawned by context-feed.test.ts to exercise concurrent writes.
 * Usage: node context-feed-write-worker.js <repoRoot> <workerIndex>
 */
import { writeRemediationSnapshot, REMEDIATION_SCHEMA_VERSION } from "../lib/context-feed-store.js";

const root = process.argv[2];
const idx = process.argv[3];
if (!root || idx === undefined) {
  process.exit(2);
}

try {
  writeRemediationSnapshot(root, {
    schema_version: REMEDIATION_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    source: "gantry verify",
    phase: "gate",
    error_code: "GXT_GATE_FAILED",
    message: `worker-${idx}`,
    fix_hints: [],
    next_actions: [],
  });
  process.exit(0);
} catch {
  process.exit(1);
}
