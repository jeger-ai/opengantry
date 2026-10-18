/** Standalone stand-in for the CLI's GantryUserError (the example does not import src/cli). */
export class GantryUserError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "GantryUserError";
  }
}

export function isGantryUserError(e: unknown): e is GantryUserError {
  return e instanceof GantryUserError;
}
