import { discoverFolderSignature } from "../lib/ast-discovery.js";
import {
  buildSkillProposal,
  formatProposalHuman,
  formatProposalJson,
  suggestSkillKeyFromFolder,
} from "../lib/register-proposals.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface RegisterOptions {
  dir: string;
  skillKey?: string;
  json?: boolean;
}

export function runRegister(options: RegisterOptions): void {
  try {
    const { root } = loadWorkspace();
    const signature = discoverFolderSignature(root, options.dir);
    const skillKey = options.skillKey?.trim() || suggestSkillKeyFromFolder(signature.folderRel);
    const proposal = buildSkillProposal(signature, skillKey);

    if (options.json) {
      process.stdout.write(`${formatProposalJson(proposal)}\n`);
      return;
    }

    logInfo(formatProposalHuman(proposal));
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(1);
  }
}
