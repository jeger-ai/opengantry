import type { Command } from "commander";
import { logError, setExitCode, errorMessage } from "./lib/cli-io.js";
import { parseArchitectureCredentialKind, type ArchitectureCredentialKind } from "./lib/arch/external/architecture-credential.js";
import {
  runArchCredSet,
  runArchCredStatus,
  runArchCredUnset,
  runArchCheckCommand,
  runArchFetch,
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

  arch
    .command("fetch")
    .description("Fetch kind=external architecture docs (convenience; doctor stays offline)")
    .option("--json", "Emit structured fetch result JSON")
    .action(async (opts: { json?: boolean }) => {
      await runArchFetch({ json: opts.json === true });
    });

  arch
    .command("check")
    .description("Evaluate TARGET_ARCHITECTURE.yaml import/layer rules for TypeScript paths")
    .argument("[files...]", "Repo-relative or absolute .ts paths")
    .option("--json", "Emit structured violation JSON")
    .action((files: string[], opts: { json?: boolean }) => {
      runArchCheckCommand({ files, json: opts.json === true });
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
        logError(errorMessage(e));
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
