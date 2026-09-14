import fs from "node:fs";
import { approveContractPrompt } from "./contract/approve-prompt.js";
import { normalizeContract, parseContractYaml } from "./contract/contract-hash.js";
import { proposeContract } from "./contract/propose.js";
import { GantryUserError } from "./errors.js";
import { logInfo } from "./cli-io.js";
import { resolveSkillKeyForLegislation, runLegislate, type LegislateOptions, type LegislateResult } from "./legislate.js";
import { loadWorkspace } from "./workspace.js";
import type { MissionContract } from "./types.js";

export interface FromIntentOptions extends LegislateOptions {
  fromIntent?: boolean;
  yes?: boolean;
  contractFile?: string;
}

function loadContractFile(file: string): MissionContract {
  return parseContractYaml(fs.readFileSync(file, "utf8"));
}

/** Propose (or load) a contract, optionally prompt, then legislate. */
export async function runLegislateFromIntent(options: FromIntentOptions): Promise<LegislateResult> {
  const { root, manifest } = loadWorkspace();
  const resolved = resolveSkillKeyForLegislation({
    root,
    manifest,
    intent: options.intent,
    skillKey: options.skillKey,
  });
  if (!resolved.ok) {
    throw new GantryUserError("INVALID_ARGUMENT", `legislate: ${resolved.reason}`, undefined, 2);
  }

  const proposed = proposeContract({
    root,
    manifest,
    intent: options.intent,
    skillKey: resolved.skillKey,
    paths: options.paths,
    gateCommand: options.gateCommand,
    gateSuccessSubstring: options.gateSuccessSubstring,
  });

  let contract = options.contractFile?.trim()
    ? loadContractFile(options.contractFile.trim())
    : options.contract
      ? normalizeContract(options.contract)
      : proposed.contract;

  if (options.fromIntent === true && !options.contractFile?.trim()) {
    const decision = await approveContractPrompt({
      contract,
      gate: proposed.gate,
      rationale: proposed.rationale,
      yes: options.yes,
    });
    if (decision.action === "quit") {
      logInfo("legislate: contract rejected — no mission written");
      return { ok: false, exitCode: 2 };
    }
    contract = decision.contract;
  }

  return runLegislate({
    ...options,
    skillKey: resolved.skillKey,
    contract,
    gateCommand: options.gateCommand ?? proposed.gate.command,
    gateSuccessSubstring: options.gateSuccessSubstring ?? proposed.gate.successSubstring ?? undefined,
  });
}
