#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { logError, setExitCode } from "./lib/cli-io.js";

function handleFatal(error: unknown): void {
  logError(error instanceof Error ? error.stack ?? error.message : String(error));
  setExitCode(1);
}

buildProgram().parseAsync(process.argv).catch(handleFatal);
