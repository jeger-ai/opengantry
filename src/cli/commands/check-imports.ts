import { findBannedImportsInFolder } from "../lib/ast-discovery.js";
import { logError, setExitCode } from "../lib/cli-io.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface CheckImportsOptions {
  dir: string;
  ban: string[];
  json?: boolean;
}

export function runCheckImports(options: CheckImportsOptions): void {
  if (options.ban.length === 0) {
    logError("gantry check-imports: provide at least one --ban specifier");
    setExitCode(2);
    return;
  }

  try {
    const { root } = loadWorkspace();
    const violations = findBannedImportsInFolder(root, options.dir, options.ban);

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: violations.length === 0, violations }, null, 2)}\n`,
      );
      if (violations.length > 0) setExitCode(1);
      return;
    }

    if (violations.length === 0) {
      process.stdout.write("check-imports: OK\n");
      return;
    }

    for (const v of violations) {
      process.stderr.write(`${v.file}: banned import "${v.specifier}"\n`);
    }
    setExitCode(1);
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(1);
  }
}
