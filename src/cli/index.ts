#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { resetOutputContext } from "./lib/output-context.js";
import { reportUserFacingError } from "./lib/errors.js";

function handleFatal(error: unknown): void {
  if (error instanceof Error && error.message.includes("invalid audience")) {
    return;
  }
  reportUserFacingError(error);
}

resetOutputContext();
buildProgram().parseAsync(process.argv).catch(handleFatal);
