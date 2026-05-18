#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { reportUserFacingError } from "./lib/user-error.js";

function handleFatal(error: unknown): void {
  reportUserFacingError(error);
}

buildProgram().parseAsync(process.argv).catch(handleFatal);
