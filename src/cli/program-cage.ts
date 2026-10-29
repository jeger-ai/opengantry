import { Command } from "commander";
import {
  runCageCheckCommand,
  runCageCommand,
  runCageGuardPrePush,
  runCagePolicyCommand,
  runCageSuggestCommand,
  runReadGuardCommand,
  runCageWatchCommand,
  type CageCheckCliOptions,
  type CageCliOptions,
  type CageWatchCliOptions,
} from "./commands/cage.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * `gantry cage <name>` was typed: `name` is the first operand and no `--` came before it.
 * Commander drops `--` from operands, so read the raw argv; `gantry cage -- <name>` runs a command.
 */
export function isCageSubcommandInvocation(name: string, operands: readonly string[], argv: readonly string[] = process.argv): boolean {
  if (operands[0] !== name) return false;
  const raw = argv.slice(2);
  const after = raw.slice(raw.indexOf("cage") + 1);
  const dashes = after.indexOf("--");
  return dashes === -1 || after.indexOf(name) < dashes;
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

async function runPolicyArgs(args: string[], inherited: { json?: boolean }): Promise<void> {
  const sub = new Command("gantry cage policy")
    .description("Print the agent's sandbox and permission settings built from the cage's rules, for review (setup step; refused inside a cage session)")
    .option("--agent <agent>", "Agent whose settings to write: claude-code")
    .option("--contract <file>", "Also deny writes to this verify contract's forbidden_paths")
    .option("--out <file>", "Write the fragment to <file> instead of printing it")
    .option("--force", "Replace an existing --out file")
    .option("--json", "Emit { agent, written, settings } on stdout");
  sub.parse(args, { from: "user" });
  await runCagePolicyCommand({ json: inherited.json, ...sub.opts() });
}

/** Options given before the subcommand name (`gantry cage --json check …`) carry over to it. */
type InheritedCageOptions = Pick<CageCliOptions, "json" | "lockDeps" | "allowOnly">;

const ALLOW_ONLY_HELP =
  "Scope: protect every file git would track outside <glob> (repeatable; a glob matching a directory covers it; intersected with .cage.yaml allow_only)";

/** Repeatable `--allow-only` before and after the subcommand name add up. */
function withInherited<T extends { allowOnly?: string[] }>(inherited: InheritedCageOptions, own: T): T & InheritedCageOptions {
  const allowOnly = [...(inherited.allowOnly ?? []), ...(own.allowOnly ?? [])];
  return { ...inherited, ...own, allowOnly };
}

const LOCK_DEPS_HELP = "Freeze dependencies: lockfiles and dependency manifests (package.json, pyproject.toml, go.mod, ...) become revert-rule paths for this run";

async function runCheckArgs(args: string[], inherited: InheritedCageOptions): Promise<void> {
  const sub = new Command("gantry cage check")
    .description("Check commits in base..head for protected-path changes, with the cage rules committed at base (pre-push, CI)")
    .requiredOption("--base <ref>", "Base commit; its .cage.yaml and manifest forbidden_zones are the rules")
    .option("--head <ref>", "Head commit (default HEAD)")
    .option("--lock-deps", `${LOCK_DEPS_HELP} (adds to the base commit's rules)`)
    .option("--allow-only <glob>", `${ALLOW_ONLY_HELP} (narrows the base commit's scope)`, collect, [])
    .option("--json", "Emit the digest-only gantry.cage-check.v1 report on stdout");
  sub.parse(args, { from: "user" });
  await runCageCheckCommand(withInherited(inherited, sub.opts<CageCheckCliOptions>()));
}

async function runWatchArgs(args: string[], inherited: InheritedCageOptions): Promise<void> {
  const sub = new Command("gantry cage watch")
    .description("Watch protected files on disk (gitignored .env and .git hooks included); you accept or reject every change in this terminal")
    .option("--decision-timeout <seconds>", "Seconds before an unanswered change is restored (default 20)")
    .option("--watch-interval-ms <n>", "Check interval (default 1000)")
    .option("--max-file-bytes <n>", "Per-file snapshot cap (default 5 MiB); a larger protected file stops watch before it starts (exit 2)")
    .option("--no-notify", "No desktop notifications (the terminal bell and prompt still alert)")
    .option("--lock-deps", LOCK_DEPS_HELP)
    .option("--allow-only <glob>", ALLOW_ONLY_HELP, collect, [])
    .option("--json", "Emit the digest-only gantry.cage-watch.v1 report on stdout when the watch stops");
  sub.parse(args, { from: "user" });
  await runCageWatchCommand(withInherited(inherited, sub.opts<CageWatchCliOptions>()));
}

/** `gantry cage <verb>`: parsed here, not by Commander (registry `dispatch: cage`); suggest and policy see only --json. */
const SUBCOMMANDS = { check: runCheckArgs, policy: runPolicyArgs, suggest: runSuggestArgs, watch: runWatchArgs };

/** Shared by `gantry cage` and the standalone `gantry-cage` bin (alias `opengantry-cage`) so they never drift. */
export function configureCageCommand(cmd: Command, opts: { subcommands?: boolean } = {}): Command {
  if (opts.subcommands) {
    cmd.addHelpText(
      "after",
      "\nCheck commits (pre-push, CI):\n  gantry cage check --base <ref> [--head <ref>] [--lock-deps] [--allow-only <glob>] [--json]  exit 3 when commits in base..head change protected paths\n" +
        "\nWatch files while you work (own terminal):\n  gantry cage watch [--decision-timeout <s>] [--no-notify] [--lock-deps] [--allow-only <glob>] [--json]  accept or reject every protected change\n" +
        "\nSetup (run it yourself, outside a cage session):\n  gantry cage suggest [--write] [--force] [--json]  propose .cage.yaml rules for review\n" +
        "  gantry cage policy --agent claude-code [--contract <file>] [--out <file>] [--force] [--json]  print the agent's sandbox settings for review\n",
    );
  }
  return cmd
    .description(
      "Zero-config: run a command and restore changes to CI configs, .env secrets, git hooks/config, manifest forbidden zones and .cage.yaml protect entries while it runs and at exit (lockfiles reported, restored with --lock-deps); refuses git pushes of protected paths from inside the session",
    )
    .option("--json", "Emit the digest-only cage report as JSON on stdout")
    .option("--report-only", "Detect and report protected changes without reverting them")
    .option("--no-watch", "Check only once, after the command exits (no live restore)")
    .option("--watch-interval-ms <n>", "Live check interval while the command runs (default 1000)")
    .option("--max-file-bytes <n>", "Per-file snapshot cap (default 5 MiB); a larger protected file stops cage before the command runs (exit 2)")
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
    .option("--lock-deps", `${LOCK_DEPS_HELP} (or .cage.yaml dependencies: revert)`)
    .option("--allow-only <glob>", ALLOW_ONLY_HELP, collect, [])
    .allowUnknownOption(true)
    .passThroughOptions()
    .argument("<command...>", "Command to run after --")
    .action(async (command: string[], cliOpts: Omit<CageCliOptions, "command">) => {
      const inherited: InheritedCageOptions = { json: cliOpts.json, lockDeps: cliOpts.lockDeps, allowOnly: cliOpts.allowOnly };
      const sub = opts.subcommands ? Object.entries(SUBCOMMANDS).find(([name]) => isCageSubcommandInvocation(name, command)) : undefined;
      if (sub) await sub[1](command.slice(1), inherited);
      else await runCageCommand({ command, ...cliOpts });
    });
}

export function registerCageCommands(program: Command): void {
  configureCageCommand(program.command("cage"), { subcommands: true });
  registerCageGuardCommand(program);
  registerReadGuardCommand(program);
}

export function registerCageGuardCommand(program: Command): void {
  program
    .command("cage-guard", { hidden: true })
    .description("Internal: checks run by the cage session git hooks")
    .command("pre-push")
    .requiredOption("--root <dir>", "Cage root (git work tree)")
    .option("--plan <file>", "Session plan written by gantry cage")
    .action(runCageGuardPrePush);
}

/** `gantry-cage read-guard`: the agent hook that keeps secret files out of the model's context (ADR-0056). */
export function registerReadGuardCommand(program: Command): void {
  program
    .command("read-guard")
    .description("Agent hook (Claude Code PreToolUse, Cursor beforeReadFile/beforeShellExecution): refuse tool calls that would read secret files")
    .action(runReadGuardCommand);
}
