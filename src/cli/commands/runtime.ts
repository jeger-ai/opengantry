import { resolveRuntimeEnv, resolvedRuntimeEnvToJsonPayload } from "../lib/runtime-env.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface RuntimeEnvCliOptions {
  mission: string;
  json?: boolean;
  /** `shell`: POSIX `export VAR='...'` lines; `text`: labeled lines */
  format?: "shell" | "text";
}

function escapeShellSingleQuotes(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

export function runRuntimeEnv(options: RuntimeEnvCliOptions): void {
  try {
    const workspace = loadWorkspace();
    const resolved = resolveRuntimeEnv(workspace, options.mission);
    const payload = resolvedRuntimeEnvToJsonPayload(resolved);

    if (options.json) {
      logInfo(JSON.stringify(payload, null, 2));
      return;
    }

    const fmt = options.format ?? "shell";
    if (fmt === "text") {
      for (const [k, v] of Object.entries(payload)) {
        logInfo(`${k}=${v}`);
      }
      return;
    }

    for (const [k, v] of Object.entries(payload)) {
      logInfo(`export ${k}='${escapeShellSingleQuotes(v)}'`);
    }
  } catch (e) {
    const errno = typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;
    if (errno === "ENOENT") {
      logError(
        `runtime env: mission file not found: ${options.mission} (ENOENT). Use an existing mission path — e.g. .gitagent/missions/example.verify.yaml — or run gapman legislate first, then pass that YAML path.`,
      );
    } else {
      logError(e instanceof Error ? e.message : String(e));
    }
    setExitCode(2);
  }
}
