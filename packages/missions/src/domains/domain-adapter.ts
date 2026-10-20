import type {
  DiscoveryAnomaly,
  DiscoveryConvention,
  DiscoveryEdge,
  DiscoveryEvidence,
} from "../discovery-types.js";
import type { ArchRuleSpec } from "../arch/cage/target-architecture.js";

export type DomainKey = "code" | "content";

export type DomainEnforcementChoice = "enforce" | "warn" | "legacy";

export interface DomainBlueprintQuestion {
  id: string;
  message: string;
  evidence: { file: string; line: number };
  ruleId: string;
  evidenceSnippet?: string;
}

export interface DomainEvidenceResult {
  conventions: DiscoveryConvention[];
  anomalies: DiscoveryAnomaly[];
  dependency_edges: DiscoveryEdge[];
}

export interface DomainFileRecord {
  rel: string;
  body: string;
  lines: string[];
}

export interface DomainAdapter {
  readonly key: DomainKey;
  readonly label: string;
  readonly fileExtensions: readonly string[];
  readonly defaultScanGlobs: readonly string[];
  /** When true, TARGET_ARCHITECTURE import-layer rules apply for this domain. */
  readonly supportsImportRules: boolean;
  extractEvidence(repoRoot: string, files: DomainFileRecord[]): DomainEvidenceResult;
  buildRuleFromAnswer(
    question: DomainBlueprintQuestion,
    choice: DomainEnforcementChoice,
    evidence: DiscoveryEvidence,
  ): ArchRuleSpec | null;
  buildBlueprintQuestions(
    conventions: DiscoveryConvention[],
    anomalies: DiscoveryAnomaly[],
  ): DomainBlueprintQuestion[];
}

const adapters = new Map<DomainKey, DomainAdapter>();

export function registerDomainAdapter(adapter: DomainAdapter): void {
  adapters.set(adapter.key, adapter);
}

export function getDomainAdapter(key: string): DomainAdapter {
  const normalized = key.trim().toLowerCase() as DomainKey;
  const adapter = adapters.get(normalized);
  if (!adapter) {
    throw new Error(`unknown domain adapter: ${key} (built-in: ${listDomainKeys().join(", ")})`);
  }
  return adapter;
}

export function listDomainKeys(): DomainKey[] {
  return [...adapters.keys()].sort();
}

export function isDomainFile(name: string, extensions: readonly string[]): boolean {
  const ext = name.includes(".") ? `.${name.split(".").pop()!.toLowerCase()}` : "";
  return extensions.some((e) => e.toLowerCase() === ext);
}
