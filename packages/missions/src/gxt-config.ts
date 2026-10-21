// The config shape and resolvers live in packages/core; this reads the file (ADR-0047 dual-read since MSN-0302).
import { parseGxtConfigSource, type GxtConfigShape } from "#core/config.js";
import { readLawFileAt } from "#git/repo-text.js";

/** `.gitagent/config.yaml` (or the 3.x config.json) as loaded. A `defensive_profile` block is ignored (ADR-0052 A10). */
export type GxtConfig = GxtConfigShape;

export function loadGxtConfig(root: string): GxtConfig {
  const source = readLawFileAt(root, "config");
  return source ? parseGxtConfigSource(source) : {};
}
