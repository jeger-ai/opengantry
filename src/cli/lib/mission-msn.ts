import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { MSN_ID_PATTERN } from "./constants.js";

function pickMsnFromYamlRecord(o: Record<string, unknown>): string | null {
  const a = o.msn_id;
  const b = o.msnId;
  for (const v of [a, b]) {
    if (typeof v === "string" && MSN_ID_PATTERN.test(v)) return v;
  }
  return null;
}

/** Parse first YAML frontmatter block (`---` … `---`) when present. */
export function tryParseYamlFrontmatter(body: string): Record<string, unknown> | null {
  const lines = body.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 1) return null;
  const block = lines.slice(1, end).join("\n");
  if (!block.trim()) return null;
  try {
    const doc = YAML.parse(block) as unknown;
    if (typeof doc !== "object" || doc === null) return null;
    return doc as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Parser-owned mission MSN resolution (YAML, frontmatter, markdown template lines).
 */
export function extractMsnIdFromMissionBody(body: string, extLower: string): string | null {
  if (extLower === ".yaml" || extLower === ".yml") {
    try {
      const doc = YAML.parse(body) as unknown;
      if (typeof doc === "object" && doc !== null) {
        const fromRoot = pickMsnFromYamlRecord(doc as Record<string, unknown>);
        if (fromRoot) return fromRoot;
      }
    } catch {
      /* fall through to markdown cues */
    }
  }

  const fm = tryParseYamlFrontmatter(body);
  if (fm) {
    const fromFm = pickMsnFromYamlRecord(fm);
    if (fromFm) return fromFm;
  }

  const bracket = body.match(/^\[(MSN-\d{4})\]/m);
  if (bracket?.[1] && MSN_ID_PATTERN.test(bracket[1])) return bracket[1];

  const missionHeading = body.match(/# Mission:\s*\[?(MSN-\d{4})\]?/i);
  if (missionHeading?.[1]) return missionHeading[1];

  return null;
}

export function extractMsnIdFromMissionPath(missionAbsolutePath: string): string | null {
  let body: string;
  try {
    body = fs.readFileSync(missionAbsolutePath, "utf8");
  } catch {
    return null;
  }
  const ext = path.extname(missionAbsolutePath).toLowerCase();
  return extractMsnIdFromMissionBody(body, ext);
}

/** @deprecated Prefer `extractMsnIdFromMissionPath` (parser-owned identity). */
export const extractMsnIdFromMissionFile = extractMsnIdFromMissionPath;
