import fs from "node:fs";
import { approveContractPrompt } from "./contract/approve-prompt.js";
import { contractSha256, normalizeContract, parseContractYaml } from "./contract/contract-hash.js";
import type { HostEmbedding } from "./contract/contract-drift.js";
import { OpenAiEmbeddingProvider } from "./contract/embedding-provider.js";
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
  embeddingFile?: string;
  autoEmbed?: boolean;
}

function loadContractFile(file: string): MissionContract {
  return parseContractYaml(fs.readFileSync(file, "utf8"));
}

async function embedIntent(options: FromIntentOptions): Promise<HostEmbedding> {
  const embedding = await new OpenAiEmbeddingProvider().generateEmbedding(options.intent);
  const msnId = options.msn?.trim();
  const summary = options.intent.trim();
  return msnId ? { embedding, summary, msnId } : { embedding, summary };
}

/**
 * `--embedding-file` reads disk here. `--auto-embed` passes the provider array.
 * sqlite-vec loads only when the index actually runs.
 */
async function applyDriftIndex(root: string, contractSha256Value: string, options: FromIntentOptions): Promise<void> {
  const embeddingFile = options.embeddingFile?.trim();
  if (embeddingFile && options.autoEmbed === true) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      "legislate: --auto-embed and --embedding-file are mutually exclusive",
      undefined,
      2,
    );
  }
  const generated = !embeddingFile && options.autoEmbed === true ? await embedIntent(options) : undefined;
  if (!embeddingFile && !generated) return;

  const drift = await import("./contract/contract-drift.js");
  const host = embeddingFile ? drift.readHostEmbedding(embeddingFile) : generated;
  if (!host) return;
  const warnings = drift.indexProposedContract({
    root,
    contractSha256: contractSha256Value,
    host,
  });
  for (const line of warnings) logInfo(line);
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

  await applyDriftIndex(root, contractSha256(normalizeContract(contract)), options);

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
