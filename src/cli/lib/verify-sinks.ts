import type { VerifyOptions } from "./verify-engine.js";
import { resolveVerifyExportFormat } from "./verify-engine.js";

export type VerifySink =
  | "break_glass_json"
  | "break_glass_human"
  | "json"
  | "fix_interactive"
  | "fix_noninteractive"
  | "human";

export function resolveVerifySink(options: VerifyOptions): VerifySink {
  if (options.breakGlass === true) {
    return options.json || options.format ? "break_glass_json" : "break_glass_human";
  }
  if (resolveVerifyExportFormat(options)) return "json";
  if (options.fix === true) {
    return options.fixNonInteractive ? "fix_noninteractive" : "fix_interactive";
  }
  return "human";
}
