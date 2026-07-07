import { pathMatchesPerimeterGlob } from "./perimeter.js";
import type { Manifest } from "./types.js";

/** Path-like tokens in intent text (repo-relative). */
const PATH_TOKEN =
  /(?:^|[\s"'`,(])(\.?(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_*./-]+)/g;

function normalizeToken(raw: string): string {
  return raw.replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Return manifest forbidden_zone globs that the intent text may target.
 * Warn-only at legislate time — Planner narrows TMVC in the mission file.
 */
export function findForbiddenZoneHits(
  manifest: Manifest,
  skillKey: string,
  intent: string,
): string[] {
  const skill = manifest.skills[skillKey];
  if (!skill) return [];
  const zones = skill.forbidden_zones ?? [];
  if (zones.length === 0) return [];

  const intentLower = intent.toLowerCase();
  const tokens = new Set<string>();
  for (const match of intent.matchAll(PATH_TOKEN)) {
    tokens.add(normalizeToken(match[1]));
  }

  const hits = new Set<string>();
  for (const zone of zones) {
    const needle = zone
      .replace(/^\*\*\//, "")
      .replace(/\*+/g, "")
      .replace(/\/$/, "")
      .toLowerCase();
    if (needle.length > 2 && intentLower.includes(needle)) {
      hits.add(zone);
      continue;
    }
    for (const token of tokens) {
      if (pathMatchesPerimeterGlob(token, zone)) {
        hits.add(zone);
        break;
      }
    }
  }
  return [...hits];
}
