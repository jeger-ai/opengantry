import { checkPerimeter } from "../lib/perimeter.js";
import { logError, logInfo, logWarn, setExitCode } from "../lib/cli-io.js";
import { gitRevParse } from "../lib/git-repo.js";
import { loadWorkspace } from "../lib/workspace.js";
import type { PerimeterViolation } from "../lib/perimeter.js";

export interface PerimeterOptions {
  baseRef?: string;
  ci?: boolean;
  json?: boolean;
}

function resolveBaseRef(root: string, baseRef?: string): string {
  if (baseRef?.trim()) return baseRef.trim();
  const originMain = gitRevParse(root, "origin/main");
  if (originMain) return "origin/main";
  const main = gitRevParse(root, "main");
  if (main) return "main";
  return "HEAD~1";
}

export function runPerimeter(options: PerimeterOptions): void {
  try {
    const { root, manifest } = loadWorkspace();
    const baseRef = resolveBaseRef(root, options.baseRef);
    const result = checkPerimeter(root, manifest, { baseRef, ci: options.ci === true });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ok) setExitCode(1);
      return;
    }

    for (const advisory of result.advisories) {
      logWarn(advisory);
    }

    const hard: PerimeterViolation[] = result.violations.filter((v) => !v.advisoryOnly);
    for (const v of hard) {
      logError(v.reason);
    }

    if (hard.length > 0) {
      setExitCode(1);
      return;
    }

    if (result.violations.length > 0 && options.ci !== true) {
      logInfo("gapman perimeter: advisory-only mode — no hard failures locally");
    } else {
      logInfo("gapman perimeter: OK");
    }
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(1);
  }
}
