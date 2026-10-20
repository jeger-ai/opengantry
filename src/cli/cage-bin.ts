#!/usr/bin/env node
import { Command } from "commander";
import { CLI_VERSION } from "./lib/version.gen.js";
import { reportUserFacingError } from "./lib/errors.js";
import { resetReporter } from "./lib/reporter.js";
import { configureCageCommand, registerCageCommands } from "./program-cage.js";

/**
 * Standalone `gantry-cage [options] -- <command...>`, equivalent to `gantry cage`; also the legacy `opengantry-cage`
 * bin (MSN-0258) and the entry the slim package bundles, where the session pre-push hook calls `cage-guard pre-push`.
 */
resetReporter();
const program = new Command("gantry-cage");
if (process.argv[2] === "cage-guard") registerCageCommands(program.enablePositionalOptions());
else configureCageCommand(program).version(CLI_VERSION);
program.parseAsync(process.argv).catch(reportUserFacingError);
