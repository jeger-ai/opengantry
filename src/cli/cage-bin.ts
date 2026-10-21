#!/usr/bin/env node
import { Command } from "commander";
import { CLI_VERSION } from "./version.gen.js";
import { reportUserFacingError } from "./output/errors.js";
import { resetReporter } from "./output/reporter.js";
import { configureCageCommand, registerCageGuardCommand, registerReadGuardCommand } from "./program-cage.js";

/**
 * Standalone `gantry-cage [options] -- <command...>`, equivalent to `gantry cage`; also the legacy `opengantry-cage`
 * bin (MSN-0258) and the entry the slim package bundles, where the session pre-push hook calls `cage-guard pre-push`
 * and agent hooks call `read-guard` (ADR-0056).
 */
resetReporter();
const program = new Command("gantry-cage");
// Decided before parsing: the root takes `<command...>` with pass-through options, so a subcommand could not win.
if (process.argv[2] === "cage-guard") registerCageGuardCommand(program.enablePositionalOptions());
else if (process.argv[2] === "read-guard") registerReadGuardCommand(program);
else configureCageCommand(program).version(CLI_VERSION);
program.parseAsync(process.argv).catch(reportUserFacingError);
