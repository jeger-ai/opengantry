import type {
  DiscoveryAnomaly,
  DiscoveryConvention,
  DiscoveryEvidence,
} from "../discovery-scanner.js";
import type { ArchRuleSpec } from "../target-architecture.js";
import {
  registerDomainAdapter,
  type DomainAdapter,
  type DomainBlueprintQuestion,
  type DomainEnforcementChoice,
  type DomainEvidenceResult,
  type DomainFileRecord,
} from "./domain-adapter.js";

const BOILERPLATE_MIN_LINES = 2;
const BOILERPLATE_MAX_LINES = 12;

function lineNumberAt(body: string, index: number): number {
  return body.slice(0, index).split(/\r?\n/).length;
}

/** Extract verbatim multi-line blocks (≥2 lines, trimmed) for exact-match boilerplate detection. */
function extractVerbatimBlocks(body: string, rel: string): Array<{ block: string; line: number }> {
  const lines = body.split(/\r?\n/);
  const blocks: Array<{ block: string; line: number }> = [];
  for (let start = 0; start < lines.length; start++) {
    for (let len = BOILERPLATE_MIN_LINES; len <= BOILERPLATE_MAX_LINES && start + len <= lines.length; len++) {
      const slice = lines.slice(start, start + len);
      const trimmed = slice.map((l) => l.trimEnd()).join("\n").trim();
      if (trimmed.length < 20) continue;
      if (!/[a-zA-Z]/.test(trimmed)) continue;
      blocks.push({ block: trimmed, line: start + 1 });
    }
  }
  return blocks;
}

function extractFrontmatterKeys(body: string): string[] {
  if (!body.startsWith("---")) return [];
  const end = body.indexOf("\n---", 3);
  if (end === -1) return [];
  const fm = body.slice(3, end);
  const keys: string[] = [];
  for (const line of fm.split(/\r?\n/)) {
    const m = /^([a-zA-Z0-9_-]+):/.exec(line.trim());
    if (m) keys.push(m[1]!);
  }
  return keys.sort();
}

function extractContentEvidence(files: DomainFileRecord[]): DomainEvidenceResult {
  const blockOccurrences = new Map<string, { files: Set<string>; evidence: DiscoveryEvidence[] }>();

  for (const file of files) {
    for (const { block, line } of extractVerbatimBlocks(file.body, file.rel)) {
      const entry = blockOccurrences.get(block) ?? { files: new Set(), evidence: [] };
      entry.files.add(file.rel);
      if (entry.evidence.length < 3) {
        entry.evidence.push({
          file: file.rel,
          line,
          snippet: block.split("\n")[0]!.slice(0, 120),
        });
      }
      blockOccurrences.set(block, entry);
    }
  }

  const conventions: DiscoveryConvention[] = [];
  const anomalies: DiscoveryAnomaly[] = [];
  let convIdx = 0;
  let anomIdx = 0;

  const sharedBlocks = [...blockOccurrences.entries()]
    .filter(([, v]) => v.files.size >= 2)
    .sort((a, b) => a[0].localeCompare(b[0]));

  for (const [block, meta] of sharedBlocks.slice(0, 10)) {
    convIdx += 1;
    const fileList = [...meta.files].sort();
    conventions.push({
      id: `conv-${convIdx}`,
      description: `Verbatim boilerplate in ${fileList.length} files: "${block.split("\n")[0]!.slice(0, 60)}…"`,
      coverage_pct: Math.round((fileList.length / files.length) * 100),
      evidence: meta.evidence,
    });

    for (const file of files) {
      if (meta.files.has(file.rel)) continue;
      if (!file.body.includes(block)) {
        anomIdx += 1;
        anomalies.push({
          id: `anom-${anomIdx}`,
          description: `${file.rel} missing verbatim boilerplate present in ${fileList.length} sibling file(s)`,
          coverage_pct: 0,
          evidence: [
            {
              file: file.rel,
              line: 1,
              snippet: `(missing block starting: ${block.split("\n")[0]!.slice(0, 80)})`,
            },
          ],
        });
        if (anomIdx >= 5) break;
      }
    }
  }

  const fmKeyCounts = new Map<string, number>();
  for (const file of files) {
    for (const key of extractFrontmatterKeys(file.body)) {
      fmKeyCounts.set(key, (fmKeyCounts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of [...fmKeyCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count < 2) continue;
    convIdx += 1;
    conventions.push({
      id: `conv-fm-${convIdx}`,
      description: `YAML frontmatter key "${key}" in ${count}/${files.length} files`,
      coverage_pct: Math.round((count / files.length) * 100),
      evidence: files
        .filter((f) => extractFrontmatterKeys(f.body).includes(key))
        .slice(0, 2)
        .map((f) => ({ file: f.rel, line: 1, snippet: `${key}:` })),
    });
  }

  return {
    conventions: conventions.sort((a, b) => a.id.localeCompare(b.id)),
    anomalies: anomalies.sort((a, b) => a.id.localeCompare(b.id)),
    dependency_edges: [],
  };
}

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildContentBlueprintQuestions(
  conventions: DiscoveryConvention[],
  anomalies: DiscoveryAnomaly[],
): DomainBlueprintQuestion[] {
  const questions: DomainBlueprintQuestion[] = [];
  for (const [i, anomaly] of anomalies.entries()) {
    const ev = anomaly.evidence[0]!;
    questions.push({
      id: `q-${i + 1}`,
      message: `${anomaly.description} — evidence at ${ev.file}:${ev.line}. Require this boilerplate in all files?`,
      evidence: { file: ev.file, line: ev.line },
      ruleId: `rule-${i + 1}`,
      evidenceSnippet: ev.snippet,
    });
  }
  for (const [i, conv] of conventions.entries()) {
    if (questions.length >= 5) break;
    const ev = conv.evidence[0];
    if (!ev) continue;
    questions.push({
      id: `q-conv-${i + 1}`,
      message: `${conv.description}. Enforce via require_pattern at ${ev.file}:${ev.line}?`,
      evidence: { file: ev.file, line: ev.line },
      ruleId: `rule-conv-${i + 1}`,
      evidenceSnippet: ev.snippet,
    });
  }
  return questions.slice(0, Math.max(3, questions.length));
}

function buildContentRule(
  question: DomainBlueprintQuestion,
  choice: DomainEnforcementChoice,
  evidence: DiscoveryEvidence,
): ArchRuleSpec | null {
  if (choice === "legacy") return null;
  const snippet = question.evidenceSnippet ?? evidence.snippet;
  if (snippet.startsWith("(missing block")) {
    const inner = /starting: (.+)\)/.exec(snippet)?.[1];
    if (!inner || choice !== "enforce") return null;
    return {
      id: question.ruleId,
      from_layer: "content",
      applies_to: ["content/**"],
      require_pattern: escapeRegexLiteral(inner.trim()),
    };
  }
  if (snippet.includes("…") || snippet.length < 8) {
    return {
      id: question.ruleId,
      from_layer: "content",
      applies_to: ["content/**"],
      require_pattern: escapeRegexLiteral(snippet.replace(/…$/, "").trim()),
    };
  }
  if (choice === "enforce") {
    return {
      id: question.ruleId,
      from_layer: "content",
      applies_to: ["content/**"],
      require_pattern: escapeRegexLiteral(snippet.trim()),
    };
  }
  return null;
}

export const contentDomainAdapter: DomainAdapter = {
  key: "content",
  label: "Brand/compliance content (markdown, HTML, text)",
  fileExtensions: [".md", ".html", ".htm", ".txt", ".json"],
  defaultScanGlobs: ["content/**"],
  extractEvidence: (_repoRoot, files) => extractContentEvidence(files),
  buildBlueprintQuestions: buildContentBlueprintQuestions,
  buildRuleFromAnswer: (q, choice, ev) => buildContentRule(q, choice, ev),
};

registerDomainAdapter(contentDomainAdapter);
