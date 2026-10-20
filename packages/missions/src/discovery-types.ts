/** Shared discovery scan types (leaf — no adapter/scanner imports). */

export const DISCOVERY_SCHEMA_VERSION = 1 as const;

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
  domain: "code" | "content";
  conventions: DiscoveryConvention[];
  anomalies: DiscoveryAnomaly[];
  dependency_edges: DiscoveryEdge[];
  scan_stats: DiscoveryScanStats;
}

export interface DiscoveryScanOptions {
  domain?: string;
  onProgress?: (filesScanned: number) => void;
}
