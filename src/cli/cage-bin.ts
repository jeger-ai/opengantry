#!/usr/bin/env node
import { Command } from "commander";
import { CLI_VERSION } from "./lib/constants.js";
import { reportUserFacingError } from "./lib/errors.js";
import { resetOutputContext } from "./lib/output-context.js";
import { configureCageCommand } from "./program-cage.js";

/**
 * Standalone `gantry-cage [options] -- <command...>`, equivalent to `gantry cage`. Also installed as
 * `opengantry-cage`, the bin name before MSN-0258, kept as a silent legacy alias.
 */
resetOutputContext();
const program = configureCageCommand(new Command("gantry-cage")).version(CLI_VERSION);
program.parseAsync(process.argv).catch(reportUserFacingError);
