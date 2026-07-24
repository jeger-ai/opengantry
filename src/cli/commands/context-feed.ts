import { logInfo } from "../lib/cli-io.js";
import { emitCliJson, runUserCommand } from "../lib/command-boundary.js";
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
  runUserCommand({ json: options.json }, () => {
    const { root } = loadWorkspace();

    if (options.clear) {
      clearRemediationSnapshot(root);
      if (options.json) {
        emitCliJson({ status: "cleared", path: ".gitagent/tmp/NEXT_REMEDIATION.json" });
      } else {
        logInfo("context-feed: cleared");
      }
      return;
    }

    const snapshot = readRemediationSnapshot(root);
    if (!snapshot) {
      if (options.json) {
        emitCliJson({ status: "empty", snapshot: null });
      } else {
        logInfo("context-feed: (no active remediation)");
      }
      return;
    }

    if (options.json) {
      emitCliJson({ status: "ok", snapshot });
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
  });
}
