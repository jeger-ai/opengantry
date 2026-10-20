#!/usr/bin/env node
import { Command } from "commander";
import { CLI_VERSION } from "./lib/version.gen.js";
import { reportUserFacingError } from "./lib/errors.js";
import { resetReporter } from "./lib/reporter.js";
import { configureCageCommand } from "./program-cage.js";

/**
 * Standalone `gantry-cage [options] -- <command...>`, equivalent to `gantry cage`. Also installed as
 * `opengantry-cage`, the bin name before MSN-0258, kept as a silent legacy alias.
 */
resetReporter();
const program = configureCageCommand(new Command("gantry-cage")).version(CLI_VERSION);
program.parseAsync(process.argv).catch(reportUserFacingError);
