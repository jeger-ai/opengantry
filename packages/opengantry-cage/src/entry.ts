import { Command } from "commander";
import { CLI_VERSION } from "../../../src/cli/lib/constants.js";
import { reportUserFacingError } from "../../../src/cli/lib/errors.js";
import { resetOutputContext } from "../../../src/cli/lib/output-context.js";
import { configureCageCommand, registerCageCommands } from "../../../src/cli/program-cage.js";

/**
 * Entry of the slim `@jeger-ai/opengantry-cage` package. Bundled by build.mjs together with the cage
 * runtime from src/cli (shared source, no copy), so `opengantry-cage [options] -- <command...>` behaves
 * exactly like `gantry cage`.
 *
 * The cage session pre-push hook calls `<node> <dist/cli/index.js> cage-guard pre-push --root … --plan …`
 * (see src/cli/lib/cage/cage-push-guard.ts). In the full package that file is the gantry CLI; here the
 * same path is the package bin, so the guard subcommand is served from this entry too.
 */
resetOutputContext();

const argv = process.argv;
const program =
  argv[2] === "cage-guard"
    ? registerGuard(new Command("opengantry-cage"))
    : configureCageCommand(new Command("opengantry-cage")).version(CLI_VERSION);

program.parseAsync(argv).catch(reportUserFacingError);

function registerGuard(cmd: Command): Command {
  // Registers `cage` and the hidden `cage-guard pre-push` exactly as the gantry program does
  // (which enables positional options on the root command first).
  cmd.enablePositionalOptions();
  registerCageCommands(cmd);
  return cmd;
}
