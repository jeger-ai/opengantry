import { EXIT_CODE } from "#core/exit-codes.js";
import type { Command } from "commander";
import { logError, setExitCode } from "./output/cli-io.js";
import { errorMessage } from "#core/user-error.js";
import { parseArchitectureCredentialKind, type ArchitectureCredentialKind } from "#missions/arch/external/architecture-credential.js";
import {
  runArchCredSet,
  runArchCredStatus,
  runArchCredUnset,
  runArchCheckCommand,
  runArchFetch,
  runArchPointer,
  type ArchCheckOptions,
} from "./commands/arch.js";

export function registerArchCommands(program: Command): void {
  const arch = program.command("arch").description("Architecture pointer and secure local credentials");
  arch.command("pointer").description("Print architecture pointer summary for agents").action(runArchPointer);
  arch
    .command("fetch")
    .description("Fetch kind=external architecture docs (convenience; doctor stays offline)")
    .option("--json", "Emit structured fetch result JSON")
    .action(runArchFetch);
  arch
    .command("check")
    .description("Evaluate TARGET_ARCHITECTURE.yaml import/layer rules for TypeScript paths")
    .argument("[files...]", "Repo-relative or absolute .ts paths")
    .option("--json", "Emit structured violation JSON")
    .option("--ratchet", "Whole-tree run: write ARCH_BASELINE.json from the current counts (lower-only)")
    .option("--allow-raise", "With --ratchet: write even where a layer grew (Planner missions only)")
    .action((files: string[], opts: ArchCheckOptions) => runArchCheckCommand({ ...opts, files }));

  const cred = arch.command("cred").description("Git-ignored credential slots for authenticated architecture sources");
  cred
    .command("status")
    .description("List stored credential slots (never prints secrets)")
    .option("--slot <name>", "Credential slot (e.g. architecture/confluence)")
    .action(runArchCredStatus);
  cred
    .command("set")
    .description("Store credentials from stdin (pipe secrets; never use argv)")
    .requiredOption("--slot <name>", "Credential slot")
    .requiredOption("--kind <kind>", "bearer | api_key | basic | custom")
    .action(async (opts: { slot: string; kind: string }) => {
      let kind: ArchitectureCredentialKind;
      try {
        kind = parseArchitectureCredentialKind(opts.kind);
      } catch (e) {
        logError(errorMessage(e));
        setExitCode(EXIT_CODE.USAGE);
        return;
      }
      await runArchCredSet({ slot: opts.slot, kind });
    });
  cred.command("unset").description("Remove a stored credential slot").requiredOption("--slot <name>", "Credential slot").action(runArchCredUnset);
}
