import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

/** Gitignored note listing the active mission's repo-relative TMVC roots for Aider. */
export const AIDER_TMVC_SCOPE_REL = ".gitagent/tmp/aider-tmvc-scope.md";

const AIDER_CONF_REL = ".aider.conf.yml";

export function formatAiderTmvcScope(roots: readonly string[]): string {
  const listed = roots.length === 0 ? "- (none)" : roots.map((root) => `- ${root}`).join("\n");
  return `# Active TMVC\n\nAllowed roots:\n${listed}\n\nDo not edit paths outside these roots.\n`;
}

/** Append `entry` under `read:` once. Leaves a non-sequence `read:` value untouched. */
export function ensureAiderConfRead(confBody: string, entry: string): { body: string; changed: boolean } {
  const doc = YAML.parseDocument(confBody);
  const read = doc.get("read");
  if (YAML.isSeq(read)) {
    const values = read.toJSON() as unknown[];
    if (values.includes(entry)) return { body: confBody, changed: false };
    read.add(entry);
    return { body: String(doc), changed: true };
  }
  if (read === undefined || read === null) {
    doc.set("read", [entry]);
    return { body: String(doc), changed: true };
  }
  return { body: confBody, changed: false };
}

export interface AiderScopeWriteResult {
  scopeFile: string;
  confPatched: boolean;
}

export function writeAiderTmvcScope(repoRoot: string, roots: readonly string[]): AiderScopeWriteResult {
  const scopeAbs = path.join(repoRoot, ...AIDER_TMVC_SCOPE_REL.split("/"));
  fs.mkdirSync(path.dirname(scopeAbs), { recursive: true });
  fs.writeFileSync(scopeAbs, formatAiderTmvcScope(roots), "utf8");

  const confAbs = path.join(repoRoot, AIDER_CONF_REL);
  if (!fs.existsSync(confAbs)) return { scopeFile: AIDER_TMVC_SCOPE_REL, confPatched: false };

  const current = fs.readFileSync(confAbs, "utf8");
  const next = ensureAiderConfRead(current, AIDER_TMVC_SCOPE_REL);
  if (next.changed) fs.writeFileSync(confAbs, next.body, "utf8");
  return { scopeFile: AIDER_TMVC_SCOPE_REL, confPatched: next.changed };
}
