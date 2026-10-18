#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { resetReporter } from "./lib/reporter.js";
import { reportUserFacingError } from "./lib/errors.js";

function handleFatal(error: unknown): void {
  if (error instanceof Error && error.message.includes("invalid audience")) {
    return;
  }
  reportUserFacingError(error);
}

resetReporter();
buildProgram().parseAsync(process.argv).catch(handleFatal);
