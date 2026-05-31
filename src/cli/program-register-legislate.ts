import type { Command } from "commander";
import { runLegislate } from "./commands/legislate.js";
import { readStdinIfEmpty } from "./commands/triage.js";
import { logError, setExitCode } from "./lib/cli-io.js";

export function registerLegislateCommand(program: Command): void {
  program
    .command("legislate")
    .description("Scaffold YAML mission under .gitagent/missions/ using explicit MSN (Teacher still commits)")
    .argument("[intent...]", "One-line Teacher intent summary")
    .requiredOption("--msn <id>", "Explicit mission id (must match MSN-0007)")
    .option("--skill-key <key>", "Override Foreman-derived skill_key when triage escalates")
    .option("--allow-duplicate", "Allow duplicate msn_id only for intentional branch migrations")
    .option("--out <file>", "Output path (.gitagent/missions/…); defaults to MSN.slug.yaml")
    .option(
      "--gate-command <cmd>",
      "Deterministic gate command (quote the full shell string if it contains spaces)",
    )
    .option(
      "--gate-success-substring <text>",
      "Optional substring required in combined gate stdout/stderr",
    )
    .action(async function (this: Command, intentParts: string[]) {
      const opts = this.opts<{
        msn: string;
        skillKey?: string;
        out?: string;
        allowDuplicate?: boolean;
        gateCommand?: string;
        gateSuccessSubstring?: string;
      }>();
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("legislate: provide intent text or pipe stdin");
        setExitCode(2);
        return;
      }
      const result = runLegislate({
        intent: text,
        msn: opts.msn,
        skillKey: opts.skillKey,
        out: opts.out,
        allowDuplicate: opts.allowDuplicate,
        gateCommand: opts.gateCommand,
        gateSuccessSubstring: opts.gateSuccessSubstring,
      });
      if (!result.ok) setExitCode(result.exitCode);
    });
}
