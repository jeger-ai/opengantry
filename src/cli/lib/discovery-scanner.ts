import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "./cli-io.js";
import { extractImportsWithMeta, extractImportSpecifiers } from "./import-scanner.js";

export const DISCOVERY_SCHEMA_VERSION = 1 as const;

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "out",
  "vendor",
]);

export interface DiscoveryEvidence {
  file: string;
  line: number;
  snippet: string;
}

export interface DiscoveryConvention {
  id: string;
  description: string;
  coverage_pct: number;
  evidence: DiscoveryEvidence[];
}

export interface DiscoveryAnomaly {
  id: string;
  description: string;
  coverage_pct: number;
  evidence: DiscoveryEvidence[];
}

export interface DiscoveryEdge {
  from_file: string;
  to_specifier: string;
}

export interface DiscoveryScanStats {
  files_scanned: number;
  duration_ms: number;
}

export interface DiscoveryProposal {
  schema_version: typeof DISCOVERY_SCHEMA_VERSION;
  conventions: DiscoveryConvention[];
  anomalies: DiscoveryAnomaly[];
  dependency_edges: DiscoveryEdge[];
  scan_stats: DiscoveryScanStats;
}

export interface DiscoveryScanOptions {
  onProgress?: (filesScanned: number) => void;
}

function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function shouldSkipDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIR_NAMES.has(name);
}

/** Walk repository source files with default exclusions (streaming-friendly). */
export function walkSourceFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name)) continue;
        walk(path.join(dir, ent.name));
        continue;
      }
      if (ent.isFile() && isSourceFile(ent.name)) {
        files.push(path.join(dir, ent.name));
      }
    }
  };
  walk(repoRoot);
  return files.sort();
}

function scanFileExports(body: string): string[] {
  const exports = new Set<string>();
  const exportNamedRe =
    /export\s+(?:async\s+)?(?:function|class|const|let|var|enum|interface|type)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = exportNamedRe.exec(body)) !== null) {
    exports.add(m[1]!);
  }
  if (/export\s+default/.test(body)) {
    exports.add("default");
  }
  return [...exports];
}

interface FileScan {
  rel: string;
  dir: string;
  imports: string[];
  importEvidence: DiscoveryEvidence[];
  exports: string[];
}

function parentDirKey(rel: string): string {
  const idx = rel.lastIndexOf("/");
  return idx === -1 ? "." : rel.slice(0, idx);
}

function dominantImportPrefix(imports: string[]): string | null {
  const counts = new Map<string, number>();
  for (const spec of imports) {
    const key = spec.startsWith(".") ? spec : spec.split("/").length >= 2 ? `${spec.split("/")[0]}/${spec.split("/")[1]}` : spec;
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

function buildConventionsAndAnomalies(scans: FileScan[]): {
  conventions: DiscoveryConvention[];
  anomalies: DiscoveryAnomaly[];
} {
  const byDir = new Map<string, FileScan[]>();
  for (const s of scans) {
    const list = byDir.get(s.dir) ?? [];
    list.push(s);
    byDir.set(s.dir, list);
  }

  const conventions: DiscoveryConvention[] = [];
  const anomalies: DiscoveryAnomaly[] = [];
  let convIdx = 0;
  let anomIdx = 0;

  for (const [dir, files] of [...byDir.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (files.length < 3) continue;
    const allImports = files.flatMap((f) => f.imports);
    const prefix = dominantImportPrefix(allImports);
    if (!prefix) continue;

    const matching = files.filter((f) =>
      f.imports.some((i) => i === prefix || i.startsWith(`${prefix}/`) || i.startsWith(`${prefix}`)),
    );
    const coverage = Math.round((matching.length / files.length) * 100);
    if (coverage < 50) continue;

    const evidence = matching
      .flatMap((f) => f.importEvidence.filter((e) => e.snippet.includes(prefix)))
      .slice(0, 3);
    if (evidence.length === 0) continue;

    convIdx += 1;
    conventions.push({
      id: `conv-${convIdx}`,
      description: `${matching.length}/${files.length} files in ${dir}/ import from ${prefix}`,
      coverage_pct: coverage,
      evidence,
    });

    const outliers = files.filter((f) => !matching.includes(f));
    for (const outlier of outliers.slice(0, 2)) {
      const odd = outlier.importEvidence.find((e) => !e.snippet.includes(prefix));
      if (!odd) continue;
      anomIdx += 1;
      anomalies.push({
        id: `anom-${anomIdx}`,
        description: `${outlier.rel} is the only file in ${dir}/ not importing ${prefix}`,
        coverage_pct: Math.round((1 / files.length) * 100),
        evidence: [odd],
      });
    }
  }

  return { conventions, anomalies };
}

function buildDependencyEdges(scans: FileScan[], limit = 500): DiscoveryEdge[] {
  const edges: DiscoveryEdge[] = [];
  for (const s of scans) {
    for (const spec of s.imports) {
      edges.push({ from_file: s.rel, to_specifier: spec });
      if (edges.length >= limit) return edges;
    }
  }
  return edges;
}

/** Run deterministic discovery scan and build proposal (no baseline writes). */
export function runDiscoveryScan(
  repoRoot: string,
  options: DiscoveryScanOptions = {},
): DiscoveryProposal {
  const started = Date.now();
  const absFiles = walkSourceFiles(repoRoot);
  let scanned = 0;
  const scans: FileScan[] = [];
  for (const abs of absFiles) {
    const body = fs.readFileSync(abs, "utf8");
    const rel = toPosixRel(repoRoot, abs);
    const meta = extractImportsWithMeta(body);
    scans.push({
      rel,
      dir: parentDirKey(rel),
      imports: extractImportSpecifiers(body),
      importEvidence: meta.map((m) => ({
        file: rel,
        line: m.line,
        snippet: m.snippet.trim(),
      })),
      exports: scanFileExports(body),
    });
    scanned += 1;
    options.onProgress?.(scanned);
  }

  const { conventions, anomalies } = buildConventionsAndAnomalies(scans);
  const dependency_edges = buildDependencyEdges(scans);

  return {
    schema_version: DISCOVERY_SCHEMA_VERSION,
    conventions: conventions.sort((a, b) => a.id.localeCompare(b.id)),
    anomalies: anomalies.sort((a, b) => a.id.localeCompare(b.id)),
    dependency_edges: dependency_edges.sort((a, b) =>
      a.from_file === b.from_file
        ? a.to_specifier.localeCompare(b.to_specifier)
        : a.from_file.localeCompare(b.from_file),
    ),
    scan_stats: {
      files_scanned: scans.length,
      duration_ms: Date.now() - started,
    },
  };
}

export function serializeDiscoveryProposal(proposal: DiscoveryProposal): string {
  return `${JSON.stringify(proposal, null, 2)}\n`;
}
