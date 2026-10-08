#!/usr/bin/env node
import { Command } from "commander";
import { CLI_VERSION } from "./lib/constants.js";
import { reportUserFacingError } from "./lib/errors.js";
import { resetOutputContext } from "./lib/output-context.js";
import { configureCageCommand } from "./program-cage.js";

/** Standalone `opengantry-cage [options] -- <command...>`, equivalent to `gantry cage`. */
resetOutputContext();
const program = configureCageCommand(new Command("opengantry-cage")).version(CLI_VERSION);
program.parseAsync(process.argv).catch(reportUserFacingError);
