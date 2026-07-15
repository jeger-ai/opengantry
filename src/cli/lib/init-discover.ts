import { CLI_NAME } from "./constants.js";
import { logInfo } from "./cli-io.js";
import {
  applyDiscoveryProposal,
  emitDiscoveryProposal,
  type DiscoveryApplyResult,
} from "./discovery-proposal.js";
import type { DiscoveryProposal } from "./discovery-scanner.js";

export interface InitDiscoverOptions {
  yes?: boolean;
  stdout?: boolean;
  onProgress?: (filesScanned: number) => void;
}

async function promptConfirmApply(): Promise<boolean> {
  const { confirm, isCancel } = await import("@clack/prompts");
  const answer = await confirm({
    message: "Apply discovery proposal to TARGET_ARCHITECTURE.yaml and MANIFEST.json?",
  });
  if (isCancel(answer) || answer !== true) return false;
  return true;
}

/** Run gantry init --discover: emit proposal, optionally apply after confirmation. */
export async function runInitDiscoverFlow(
  repoRoot: string,
  options: InitDiscoverOptions = {},
): Promise<{ proposal: DiscoveryProposal; applied: DiscoveryApplyResult | null }> {
  const started = Date.now();
  let progressLogged = false;
  const { proposal, proposalPath } = emitDiscoveryProposal(repoRoot, {
    onProgress: (n) => {
      if (!progressLogged && Date.now() - started > 1000) {
        logInfo(`${CLI_NAME} discover: scanning… (${n} files so far)`);
        progressLogged = true;
      }
      options.onProgress?.(n);
    },
  });

  if (options.stdout) {
    process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`);
  } else {
    logInfo(
      `${CLI_NAME} discover: wrote ${proposalPath} (${proposal.scan_stats.files_scanned} files, ${proposal.scan_stats.duration_ms}ms)`,
    );
    logInfo(
      `${CLI_NAME} discover: ${proposal.conventions.length} convention(s), ${proposal.anomalies.length} anomaly(ies)`,
    );
  }

  if (proposal.conventions.length === 0 && proposal.anomalies.length === 0) {
    logInfo(`${CLI_NAME} discover: no conventions detected — refine scan roots or add source files`);
  }

  const shouldApply =
    options.yes === true || (options.stdout !== true && (await promptConfirmApply()));
  if (!shouldApply) {
    return { proposal, applied: null };
  }

  const applied = applyDiscoveryProposal(repoRoot, proposal);
  logInfo(
    `${CLI_NAME} discover: applied ${applied.targetArchitecturePath} and ${applied.manifestPath}`,
  );
  return { proposal, applied };
}
