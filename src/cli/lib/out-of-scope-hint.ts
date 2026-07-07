import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { REL_OUT_OF_SCOPE_DIR } from "./constants.js";
import type { AdrHint } from "./types.js";

interface ParsedAdrMeta {
  id: string;
  title?: string;
  status: string;
  match_terms: string[];
}

function parseAdrFrontmatter(body: string): { meta: ParsedAdrMeta | null; rest: string } {
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: null, rest: body };
  const yamlBlock = m[1]!.trim();
  const rest = m[2] ?? "";
  try {
    const data = YAML.parse(yamlBlock) as Record<string, unknown>;
    if (typeof data !== "object" || data === null) return { meta: null, rest };
    const id = typeof data.id === "string" ? data.id : "";
    const title = typeof data.title === "string" ? data.title : undefined;
    const status = typeof data.status === "string" ? data.status : "ACTIVE";
    let match_terms: string[] = [];
    if (Array.isArray(data.match_terms)) {
      match_terms = data.match_terms.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    }
    if (!id) return { meta: null, rest };
    return {
      meta: { id, title, status: status.toUpperCase(), match_terms },
      rest,
    };
  } catch {
    return { meta: null, rest: body };
  }
}

function intentMatchesTerms(intentNorm: string, terms: string[]): boolean {
  for (const t of terms) {
    const needle = t.trim().toLowerCase();
    if (needle.length === 0) continue;
    if (intentNorm.includes(needle)) return true;
  }
  return false;
}

/**
 * Non-binding ADR hints for triage output. Routing stays manifest-only; Teacher
 * MUST still evaluate ADRs during legislation (see RULES).
 */
export function collectOutOfScopeAdrHints(root: string, intentNorm: string): AdrHint[] {
  const dir = path.join(root, REL_OUT_OF_SCOPE_DIR);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];

  const hints: AdrHint[] = [];
  const names = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n.toUpperCase() !== "README.MD");
  for (const name of names) {
    const abs = path.join(dir, name);
    let body: string;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const { meta } = parseAdrFrontmatter(body);
    if (!meta) continue;
    if (meta.status === "SUPERSEDED") continue;
    if (meta.match_terms.length === 0) continue;
    if (!intentMatchesTerms(intentNorm, meta.match_terms)) continue;
    hints.push({
      id: meta.id,
      title: meta.title,
      note: `Intent may relate to ADR ${meta.id} (match_terms overlap); Planner must confirm or reject during legislation.`,
    });
  }
  return hints;
}
