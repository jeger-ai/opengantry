import { extractImportsWithMeta, extractImportSpecifiers } from "../import-scanner.js";
import type {
  DiscoveryAnomaly,
  DiscoveryConvention,
  DiscoveryEdge,
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

function parentDirKey(rel: string): string {
  const idx = rel.lastIndexOf("/");
  return idx === -1 ? "." : rel.slice(0, idx);
}

function dominantImportPrefix(imports: string[]): string | null {
  const counts = new Map<string, number>();
  for (const spec of imports) {
    const key = spec.startsWith(".")
      ? spec
      : spec.split("/").length >= 2
        ? `${spec.split("/")[0]}/${spec.split("/")[1]}`
        : spec;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [prefix, count] of counts) {
    if (count > bestCount) {
      best = prefix;
      bestCount = count;
    }
  }
  return best;
}

interface CodeFileScan {
  rel: string;
  dir: string;
  imports: string[];
  importEvidence: DiscoveryEvidence[];
}

function scanCodeFiles(files: DomainFileRecord[]): CodeFileScan[] {
  return files.map((f) => {
    const meta = extractImportsWithMeta(f.body);
    return {
      rel: f.rel,
      dir: parentDirKey(f.rel),
      imports: extractImportSpecifiers(f.body),
      importEvidence: meta.map((m) => ({
        file: f.rel,
        line: m.line,
        snippet: m.snippet.trim(),
      })),
    };
  });
}

function extractCodeEvidence(files: DomainFileRecord[]): DomainEvidenceResult {
  const scans = scanCodeFiles(files);
  const byDir = new Map<string, CodeFileScan[]>();
  for (const s of scans) {
    const list = byDir.get(s.dir) ?? [];
    list.push(s);
    byDir.set(s.dir, list);
  }

  const conventions: DiscoveryConvention[] = [];
  const anomalies: DiscoveryAnomaly[] = [];
  let convIdx = 0;
  let anomIdx = 0;

  for (const [dir, dirFiles] of [...byDir.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (dirFiles.length < 3) continue;
    const allImports = dirFiles.flatMap((f) => f.imports);
    const prefix = dominantImportPrefix(allImports);
    if (!prefix) continue;

    const matching = dirFiles.filter((f) =>
      f.imports.some((i) => i === prefix || i.startsWith(`${prefix}/`) || i.startsWith(prefix)),
    );
    const coverage = Math.round((matching.length / dirFiles.length) * 100);
    if (coverage < 50) continue;

    const evidence = matching
      .flatMap((f) => f.importEvidence.filter((e) => e.snippet.includes(prefix)))
      .slice(0, 3);
    if (evidence.length === 0) continue;

    convIdx += 1;
    conventions.push({
      id: `conv-${convIdx}`,
      description: `${matching.length}/${dirFiles.length} files in ${dir}/ import from ${prefix}`,
      coverage_pct: coverage,
      evidence,
    });

    const outliers = dirFiles.filter((f) => !matching.includes(f));
    for (const outlier of outliers.slice(0, 2)) {
      const odd = outlier.importEvidence.find((e) => !e.snippet.includes(prefix));
      if (!odd) continue;
      anomIdx += 1;
      anomalies.push({
        id: `anom-${anomIdx}`,
        description: `${outlier.rel} is the only file in ${dir}/ not importing ${prefix}`,
        coverage_pct: Math.round((1 / dirFiles.length) * 100),
        evidence: [odd],
      });
    }
  }

  const dependency_edges: DiscoveryEdge[] = [];
  for (const s of scans) {
    for (const spec of s.imports) {
      dependency_edges.push({ from_file: s.rel, to_specifier: spec });
      if (dependency_edges.length >= 500) break;
    }
    if (dependency_edges.length >= 500) break;
  }

  return {
    conventions: conventions.sort((a, b) => a.id.localeCompare(b.id)),
    anomalies: anomalies.sort((a, b) => a.id.localeCompare(b.id)),
    dependency_edges: dependency_edges.sort((a, b) =>
      a.from_file === b.from_file
        ? a.to_specifier.localeCompare(b.to_specifier)
        : a.from_file.localeCompare(b.from_file),
    ),
  };
}

function buildCodeBlueprintQuestions(
  conventions: DiscoveryConvention[],
  anomalies: DiscoveryAnomaly[],
): DomainBlueprintQuestion[] {
  const questions: DomainBlueprintQuestion[] = [];
  for (const [i, anomaly] of anomalies.entries()) {
    const ev = anomaly.evidence[0]!;
    questions.push({
      id: `q-${i + 1}`,
      message: `${anomaly.description} — evidence at ${ev.file}:${ev.line}. How should OpenGantry treat this?`,
      evidence: { file: ev.file, line: ev.line },
      ruleId: `rule-${i + 1}`,
      evidenceSnippet: ev.snippet,
    });
  }
  if (questions.length < 3) {
    for (const [i, conv] of conventions.entries()) {
      if (questions.length >= 3) break;
      const ev = conv.evidence[0];
      if (!ev) continue;
      questions.push({
        id: `q-conv-${i + 1}`,
        message: `Convention: ${conv.description}. Evidence at ${ev.file}:${ev.line}. Codify as enforced rule?`,
        evidence: { file: ev.file, line: ev.line },
        ruleId: `rule-conv-${i + 1}`,
        evidenceSnippet: ev.snippet,
      });
    }
  }
  return questions.slice(0, Math.max(3, questions.length));
}

function buildCodeRule(
  question: DomainBlueprintQuestion,
  choice: DomainEnforcementChoice,
  evidence: DiscoveryEvidence,
): ArchRuleSpec | null {
  if (choice === "legacy") return null;
  const snippet = evidence.snippet;
  const importMatch = /from\s+["']([^"']+)["']/.exec(snippet) ?? /import\s+["']([^"']+)["']/.exec(snippet);
  const forbidden = importMatch?.[1];
  if (choice === "enforce" && forbidden) {
    return {
      id: question.ruleId,
      from_layer: "app",
      forbid_specifier_substring: forbidden,
    };
  }
  if (choice === "warn" && forbidden) {
    return {
      id: question.ruleId,
      from_layer: "app",
      forbid_specifier_substring: forbidden,
    };
  }
  return null;
}

export const codeDomainAdapter: DomainAdapter = {
  key: "code",
  label: "Software engineering (TypeScript/JavaScript imports)",
  fileExtensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  defaultScanGlobs: ["src/**"],
  extractEvidence: (_repoRoot, files) => extractCodeEvidence(files),
  buildBlueprintQuestions: buildCodeBlueprintQuestions,
  buildRuleFromAnswer: (q, choice, ev) => buildCodeRule(q, choice, ev),
};

registerDomainAdapter(codeDomainAdapter);
