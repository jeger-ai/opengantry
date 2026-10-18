import { gxtCodeFromGantryUserError } from "./error-codes.js";

/** Expected policy / validation failure — never print a stack at the CLI boundary. */
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

  /** Stable GXT error code for JSON/MCP consumers. */
  get gxtCode(): string {
    return gxtCodeFromGantryUserError(this.code);
  }
}

export function isGantryUserError(e: unknown): e is GantryUserError {
  return e instanceof GantryUserError;
}
