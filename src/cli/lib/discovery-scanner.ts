import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "./cli-io.js";
import {
  getDomainAdapter,
  isDomainFile,
  type DomainFileRecord,
  type DomainKey,
} from "./domains/index.js";

export const DISCOVERY_SCHEMA_VERSION = 1 as const;

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
  domain: DomainKey;
  conventions: DiscoveryConvention[];
  anomalies: DiscoveryAnomaly[];
  dependency_edges: DiscoveryEdge[];
  scan_stats: DiscoveryScanStats;
}

export interface DiscoveryScanOptions {
  domain?: string;
  onProgress?: (filesScanned: number) => void;
}

function shouldSkipDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIR_NAMES.has(name);
}

/** Walk repository files matching domain adapter extensions. */
export function walkDomainFiles(repoRoot: string, extensions: readonly string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name)) continue;
        walk(path.join(dir, ent.name));
        continue;
      }
      if (ent.isFile() && isDomainFile(ent.name, extensions)) {
        files.push(path.join(dir, ent.name));
      }
    }
  };
  walk(repoRoot);
  return files.sort();
}

/** @deprecated Use walkDomainFiles with adapter extensions */
export function walkSourceFiles(repoRoot: string): string[] {
  return walkDomainFiles(repoRoot, getDomainAdapter("code").fileExtensions);
}

function loadFileRecords(repoRoot: string, absFiles: string[]): DomainFileRecord[] {
  return absFiles.map((abs) => {
    const body = fs.readFileSync(abs, "utf8");
    return {
      rel: toPosixRel(repoRoot, abs),
      body,
      lines: body.split(/\r?\n/),
    };
  });
}

/** Run deterministic discovery scan via domain adapter (no baseline writes). */
export function runDiscoveryScan(
  repoRoot: string,
  options: DiscoveryScanOptions = {},
): DiscoveryProposal {
  const adapter = getDomainAdapter(options.domain ?? "code");
  const started = Date.now();
  const absFiles = walkDomainFiles(repoRoot, adapter.fileExtensions);
  const records = loadFileRecords(repoRoot, absFiles);
  let scanned = 0;
  for (const _ of records) {
    scanned += 1;
    options.onProgress?.(scanned);
  }

  const { conventions, anomalies, dependency_edges } = adapter.extractEvidence(repoRoot, records);

  return {
    schema_version: DISCOVERY_SCHEMA_VERSION,
    domain: adapter.key,
    conventions,
    anomalies,
    dependency_edges,
    scan_stats: {
      files_scanned: records.length,
      duration_ms: Date.now() - started,
    },
  };
}

export function serializeDiscoveryProposal(proposal: DiscoveryProposal): string {
  return `${JSON.stringify(proposal, null, 2)}\n`;
}
