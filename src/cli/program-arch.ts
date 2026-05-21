import type { Command } from "commander";
import { logError, setExitCode } from "./lib/cli-io.js";
import { parseArchitectureCredentialKind, type ArchitectureCredentialKind } from "./lib/architecture-credential.js";
import {
  runArchCredSet,
  runArchCredStatus,
  runArchCredUnset,
  runArchPointer,
} from "./commands/arch.js";

export function registerArchCommands(program: Command): void {
  const arch = program.command("arch").description("Architecture pointer and secure local credentials");

  arch
    .command("pointer")
    .description("Print architecture pointer summary for agents")
    .action(() => {
      runArchPointer();
    });

  const cred = arch.command("cred").description("Git-ignored credential slots for authenticated architecture sources");

  cred
    .command("status")
    .description("List stored credential slots (never prints secrets)")
    .option("--slot <name>", "Credential slot (e.g. architecture/confluence)")
    .action((opts: { slot?: string }) => {
      runArchCredStatus({ slot: opts.slot });
    });

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
        logError(e instanceof Error ? e.message : String(e));
        setExitCode(2);
        return;
      }
      await runArchCredSet({ slot: opts.slot, kind });
    });

  cred
    .command("unset")
    .description("Remove a stored credential slot")
    .requiredOption("--slot <name>", "Credential slot")
    .action((opts: { slot: string }) => {
      runArchCredUnset({ slot: opts.slot });
    });
}
