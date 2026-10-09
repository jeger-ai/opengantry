import { Command } from "commander";
import { runCageCommand, runCageGuardPrePush, runCageSuggestCommand } from "./commands/cage.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * `gantry cage suggest` was typed: `suggest` is the first operand and no `--` came before it.
 * Commander drops `--` from operands, so read the raw argv; `gantry cage -- suggest` runs a command.
 */
export function isSuggestInvocation(operands: readonly string[], argv: readonly string[] = process.argv): boolean {
  if (operands[0] !== "suggest") return false;
  const raw = argv.slice(2);
  const after = raw.slice(raw.indexOf("cage") + 1);
  const dashes = after.indexOf("--");
  return dashes === -1 || after.indexOf("suggest") < dashes;
}

async function runSuggestArgs(args: string[], inherited: { json?: boolean }): Promise<void> {
  const sub = new Command("gantry cage suggest")
    .description("Propose .cage.yaml protect entries for review (setup step; refused inside a cage session)")
    .option("--write", "Write .cage.yaml.suggested instead of printing (never writes .cage.yaml)")
    .option("--force", "Replace an existing .cage.yaml.suggested")
    .option("--json", "Emit suggestions as JSON on stdout");
  sub.parse(args, { from: "user" });
  await runCageSuggestCommand({ json: inherited.json, ...sub.opts() });
}

/** Shared by `gantry cage` and the standalone `opengantry-cage` bin so the two never drift. */
export function configureCageCommand(cmd: Command, opts: { suggest?: boolean } = {}): Command {
  if (opts.suggest) {
    cmd.addHelpText(
      "after",
      "\nSetup (run it yourself, outside a cage session):\n  gantry cage suggest [--write] [--force] [--json]  propose .cage.yaml rules for review\n",
    );
  }
  return cmd
    .description(
      "Zero-config: run a command and restore changes to CI configs, .env secrets, git hooks/config, manifest forbidden zones and .cage.yaml protect entries while it runs and at exit (lockfiles reported); refuses git pushes of protected paths from inside the session",
    )
    .option("--json", "Emit the digest-only cage report as JSON on stdout")
    .option("--report-only", "Detect and report protected changes without reverting them")
    .option("--no-watch", "Check only once, after the command exits (no live restore)")
    .option("--watch-interval-ms <n>", "Live check interval while the command runs (default 1000)")
    .option("--max-file-bytes <n>", "Per-file in-memory snapshot cap; larger files are detect-only")
    .option(
      "--contest-limit <n>",
      "Live restores of one path before cage terminates the command (default 3, or .cage.yaml contest_limit; 0 never halts)",
    )
    .option(
      "--allow-override <path>",
      "Report instead of restore changes under <path> for this run (repeatable; never git hooks/config or .cage.yaml)",
      collect,
      [],
    )
    .allowUnknownOption(true)
    .passThroughOptions()
    .argument("<command...>", "Command to run after --")
    .action(
      async (
        command: string[],
        cliOpts: {
          json?: boolean;
          reportOnly?: boolean;
          maxFileBytes?: string;
          watch?: boolean;
          watchIntervalMs?: string;
          allowOverride?: string[];
          contestLimit?: string;
        },
      ) => {
        if (opts.suggest && isSuggestInvocation(command)) {
          await runSuggestArgs(command.slice(1), { json: cliOpts.json });
          return;
        }
        await runCageCommand({ command, ...cliOpts });
      },
    );
}

export function registerCageCommands(program: Command): void {
  configureCageCommand(program.command("cage"), { suggest: true });
  program
    .command("cage-guard", { hidden: true })
    .description("Internal: checks run by the cage session git hooks")
    .command("pre-push")
    .requiredOption("--root <dir>", "Cage root (git work tree)")
    .option("--plan <file>", "Session plan written by gantry cage")
    .action(async (opts: { root: string; plan?: string }) => {
      await runCageGuardPrePush(opts);
    });
}
