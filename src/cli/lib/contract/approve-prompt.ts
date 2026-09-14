import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import YAML from "yaml";
import { GantryUserError } from "../errors.js";
import { formatContractBlock } from "./format.js";
import { normalizeContract, parseContractYaml } from "./contract-hash.js";
import type { MissionContract } from "./contract-types.js";
import type { ProposedGate } from "./propose-gate.js";

export type ContractApproval =
  | { action: "approve"; contract: MissionContract }
  | { action: "quit" };

export interface ApproveContractInput {
  contract: MissionContract;
  gate?: ProposedGate;
  rationale?: string[];
  yes?: boolean;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

function parseEditedContract(body: string): MissionContract {
  return parseContractYaml(body);
}

function editInEditor(contract: MissionContract): MissionContract {
  const editor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || "vi";
  const tmp = path.join(os.tmpdir(), `gantry-contract-${process.pid}.yaml`);
  fs.writeFileSync(tmp, YAML.stringify({ contract }), "utf8");
  try {
    const r = spawnSync(editor, [tmp], { stdio: "inherit" });
    if (r.status !== 0) {
      throw new GantryUserError("INVALID_ARGUMENT", `editor ${editor} exited ${String(r.status ?? "null")}`, undefined, 2);
    }
    return parseEditedContract(fs.readFileSync(tmp, "utf8"));
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* tmp cleanup is best-effort */
    }
  }
}

/**
 * TTY [a]pprove / [e]dit in $EDITOR / [q]uit. `--yes` skips the prompt. Non-TTY without `--yes`
 * exits 2 — CI must pass `--yes` or `--contract-file`.
 */
export async function approveContractPrompt(input: ApproveContractInput): Promise<ContractApproval> {
  if (input.yes === true) return { action: "approve", contract: normalizeContract(input.contract) };

  const stdin = input.stdin ?? process.stdin;
  const stdout = input.stdout ?? process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      "gantry legislate --from-intent requires a TTY, or pass --yes / --contract-file",
      "Re-run in an interactive terminal, or gantry legislate --from-intent --yes …",
      2,
    );
  }

  let current = normalizeContract(input.contract);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      stdout.write(`${formatContractBlock(current, input.gate)}\n`);
      if (input.rationale && input.rationale.length > 0) {
        stdout.write(`Rationale:\n${input.rationale.map((r) => `  - ${r}`).join("\n")}\n`);
      }
      const answer = (await rl.question("[a]pprove / [e]dit in $EDITOR / [q]uit: ")).trim().toLowerCase();
      if (answer === "a" || answer === "approve" || answer === "yes" || answer === "y") {
        return { action: "approve", contract: current };
      }
      if (answer === "q" || answer === "quit" || answer === "n" || answer === "no") {
        return { action: "quit" };
      }
      if (answer === "e" || answer === "edit") {
        current = editInEditor(current);
        continue;
      }
      stdout.write("Enter a, e, or q.\n");
    }
  } finally {
    rl.close();
  }
}
