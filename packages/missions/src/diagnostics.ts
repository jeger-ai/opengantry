/** Where domain code sends human diagnostics (ADR-0054 decision 4): the CLI passes its log helpers; silent by default. */
export interface Diagnostics {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const SILENT: Diagnostics = { info: () => undefined, warn: () => undefined, error: () => undefined };
