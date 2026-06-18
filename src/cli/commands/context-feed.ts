import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import {
  clearRemediationSnapshot,
  readRemediationSnapshot,
} from "../lib/context-feed-store.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface ContextFeedOptions {
  json?: boolean;
  clear?: boolean;
}

export function runContextFeed(options: ContextFeedOptions = {}): void {
  try {
    const { root } = loadWorkspace();

    if (options.clear) {
      clearRemediationSnapshot(root);
      if (options.json) {
        logInfo(JSON.stringify({ status: "cleared", path: ".gitagent/tmp/NEXT_REMEDIATION.json" }, null, 2));
      } else {
        logInfo("context-feed: cleared");
      }
      return;
    }

    const snapshot = readRemediationSnapshot(root);
    if (!snapshot) {
      if (options.json) {
        logInfo(JSON.stringify({ status: "empty", snapshot: null }, null, 2));
      } else {
        logInfo("context-feed: (no active remediation)");
      }
      return;
    }

    if (options.json) {
      logInfo(JSON.stringify({ status: "ok", snapshot }, null, 2));
      return;
    }

    logInfo(`context-feed: phase=${snapshot.phase} error=${snapshot.error_code}`);
    logInfo(`  message: ${snapshot.message}`);
    if (snapshot.mission_file_path) logInfo(`  mission: ${snapshot.mission_file_path}`);
    if (snapshot.msn_id) logInfo(`  msn_id: ${snapshot.msn_id}`);
    if (snapshot.fix_hints.length > 0) {
      logInfo("  fix_hints:");
      for (const hint of snapshot.fix_hints) logInfo(`    - ${hint}`);
    }
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(2);
  }
}
