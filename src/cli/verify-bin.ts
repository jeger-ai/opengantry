#!/usr/bin/env node
import { Command } from "commander";
import { CLI_VERSION } from "./version.gen.js";
import { registerVerifyContractOptions, runVerifyContractCommand, type VerifyContractCliOptions } from "./commands/verify-contract.js";
import { reportUserFacingError } from "./output/errors.js";
import { resetReporter } from "./output/reporter.js";

/**
 * Standalone `gantry-verify [contract] [options]`, equivalent to `gantry verify --contract` (ADR-0051), and the entry
 * the slim `@jeger-ai/opengantry-verify` package bundles.
 */
resetReporter();
const program = registerVerifyContractOptions(new Command("gantry-verify"), { standalone: true })
  .description("Decide whether a change may land, from one contract (verify.yaml or a COMMITLY gate.json), without .gitagent/")
  .argument("[contract]", "verify.yaml (default) or a COMMITLY gate.json")
  .option("--json", "Print the result (or the baseline, or the check) as JSON on stdout")
  .option("--format <fmt>", "text (default) | json | sarif | junit")
  .version(CLI_VERSION)
  .action(async (contract: string | undefined, opts: Omit<VerifyContractCliOptions, "contract">) => {
    await runVerifyContractCommand({ ...opts, contract: contract ?? true });
  });
program.parseAsync(process.argv).catch(reportUserFacingError);
