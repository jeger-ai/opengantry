#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { resetReporter } from "./output/reporter.js";
import { reportUserFacingError } from "./output/errors.js";

function handleFatal(error: unknown): void {
  if (error instanceof Error && error.message.includes("invalid audience")) {
    return;
  }
  reportUserFacingError(error);
}

resetReporter();
buildProgram().parseAsync(process.argv).catch(handleFatal);
