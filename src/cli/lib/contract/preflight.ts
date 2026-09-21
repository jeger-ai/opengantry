import { runHeuristicPreflight } from "./preflight-heuristic.js";
import { runJevPreflight } from "./preflight-jev.js";
import { isPreflightProvider, type PreflightProvider, type PreflightResult } from "./preflight-types.js";
import { GantryUserError } from "../errors.js";
import type { Manifest } from "../types.js";

export type { PreflightProvider, PreflightResult, TmvcRootCandidate } from "./preflight-types.js";
export { PREFLIGHT_MIN_CONFIDENCE, PREFLIGHT_PROVIDERS, isPreflightProvider } from "./preflight-types.js";

export interface RunPreflightInput {
  root: string;
  manifest: Manifest;
  intent: string;
  paths?: string[];
  provider?: PreflightProvider;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function assertProvider(provider: string | undefined): PreflightProvider {
  const resolved = provider ?? "heuristic";
  if (!isPreflightProvider(resolved)) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      `contract preflight: unknown provider ${resolved}`,
      "Use heuristic or jev",
      2,
    );
  }
  return resolved;
}

/** Advisory classifier in front of proposeContract. Never writes a contract or hash. */
export async function runPreflight(input: RunPreflightInput): Promise<PreflightResult> {
  const provider = assertProvider(input.provider);
  switch (provider) {
    case "heuristic":
      return runHeuristicPreflight(input);
    case "jev":
      return runJevPreflight({
        root: input.root,
        manifest: input.manifest,
        intent: input.intent,
        paths: input.paths,
        apiKey: input.apiKey ?? "",
        fetchImpl: input.fetchImpl,
      });
    default: {
      const _exhaustive: never = provider;
      throw new GantryUserError("INVALID_ARGUMENT", `contract preflight: unhandled provider ${String(_exhaustive)}`, undefined, 2);
    }
  }
}
