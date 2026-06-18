import fs from "node:fs";
import path from "node:path";

export type AuditRigorLevel = "ok" | "warn" | "fail";

export interface AuditRigorLine {
  level: AuditRigorLevel;
  check_id: string;
  message: string;
}

export interface AuditRigorReport {
  workspace_root: string;
  lines: AuditRigorLine[];
  exit_code: number;
}

export interface AuditRigorOptions {
  /** When true, warnings elevate to failures. */
  strict?: boolean;
}

function readJsonFile(absPath: string): unknown | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function findTsconfigPaths(workspaceRoot: string): string[] {
  const candidates = [
    path.join(workspaceRoot, "tsconfig.json"),
    path.join(workspaceRoot, "tsconfig.base.json"),
  ];
  return candidates.filter((p) => fs.existsSync(p));
}

function checkTypeScriptStrict(workspaceRoot: string): AuditRigorLine[] {
  const configs = findTsconfigPaths(workspaceRoot);
  if (configs.length === 0) {
    return [
      {
        level: "warn",
        check_id: "typescript_strict",
        message: "no tsconfig.json at workspace root — cannot verify strict compiler posture",
      },
    ];
  }

  const lines: AuditRigorLine[] = [];
  for (const configPath of configs) {
    const rel = path.relative(workspaceRoot, configPath).replace(/\\/g, "/");
    const doc = readJsonFile(configPath) as { compilerOptions?: { strict?: boolean } } | null;
    if (!doc?.compilerOptions) {
      lines.push({
        level: "fail",
        check_id: "typescript_strict",
        message: `${rel}: missing compilerOptions — enable strict mode for agent-safe refactors`,
      });
      continue;
    }
    if (doc.compilerOptions.strict === true) {
      lines.push({
        level: "ok",
        check_id: "typescript_strict",
        message: `${rel}: compilerOptions.strict=true`,
      });
    } else {
      lines.push({
        level: "fail",
        check_id: "typescript_strict",
        message: `${rel}: compilerOptions.strict is not true — loosened types weaken verification gates`,
      });
    }
  }
  return lines;
}

const COVERAGE_CANDIDATES = [
  "coverage/coverage-summary.json",
  "coverage/coverage-final.json",
  ".nyc_output/coverage-summary.json",
];

function coveragePctFromSummary(doc: Record<string, unknown>): number | null {
  const total = doc.total as Record<string, { pct?: number }> | undefined;
  const lines = total?.lines?.pct;
  if (typeof lines === "number" && Number.isFinite(lines)) return lines;
  const statements = total?.statements?.pct;
  if (typeof statements === "number" && Number.isFinite(statements)) return statements;
  return null;
}

function checkCoverageArtifacts(workspaceRoot: string, strict: boolean): AuditRigorLine[] {
  for (const rel of COVERAGE_CANDIDATES) {
    const abs = path.join(workspaceRoot, rel);
    const doc = readJsonFile(abs) as Record<string, unknown> | null;
    if (!doc) continue;
    const pct = coveragePctFromSummary(doc);
    if (pct === null) {
      return [
        {
          level: strict ? "fail" : "warn",
          check_id: "coverage_threshold",
          message: `${rel}: present but missing total.*.pct — configure Istanbul/nyc summary output`,
        },
      ];
    }
    if (pct < 50) {
      return [
        {
          level: strict ? "fail" : "warn",
          check_id: "coverage_threshold",
          message: `${rel}: line/statement coverage ${String(pct)}% is below 50% advisory floor`,
        },
      ];
    }
    return [
      {
        level: "ok",
        check_id: "coverage_threshold",
        message: `${rel}: coverage ${String(pct)}% meets advisory floor`,
      },
    ];
  }

  return [
    {
      level: strict ? "fail" : "warn",
      check_id: "coverage_threshold",
      message:
        "no coverage summary artifact (coverage/coverage-summary.json) — run tests with coverage before agent-heavy refactors",
    },
  ];
}

function isOverlyBroadWildcard(pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed === "*" || trimmed === "**" || trimmed === "*/**" || trimmed === "**/*") return true;
  if (/^\*\*$/.test(trimmed)) return true;
  return false;
}

function collectManifestWildcards(workspaceRoot: string): string[] {
  const manifestPath = path.join(workspaceRoot, ".gitagent/foreman/MANIFEST.json");
  const doc = readJsonFile(manifestPath) as {
    skills?: Record<string, { forbidden_zones?: string[]; tmvc_roots?: string[] }>;
  } | null;
  if (!doc?.skills) return [];

  const patterns: string[] = [];
  for (const skill of Object.values(doc.skills)) {
    for (const zone of skill.forbidden_zones ?? []) patterns.push(zone);
    for (const root of skill.tmvc_roots ?? []) patterns.push(root);
  }
  return patterns;
}

function checkWildcardDependencyRules(workspaceRoot: string): AuditRigorLine[] {
  const lines: AuditRigorLine[] = [];
  const patterns = collectManifestWildcards(workspaceRoot);
  const broad = patterns.filter(isOverlyBroadWildcard);
  if (broad.length === 0) {
    if (patterns.length === 0) {
      lines.push({
        level: "warn",
        check_id: "wildcard_paths",
        message: "MANIFEST has no tmvc_roots/forbidden_zones to evaluate for overly broad wildcards",
      });
    } else {
      lines.push({
        level: "ok",
        check_id: "wildcard_paths",
        message: `MANIFEST path rules (${String(patterns.length)}) avoid catch-all wildcards`,
      });
    }
    return lines;
  }

  for (const pattern of broad) {
    lines.push({
      level: "fail",
      check_id: "wildcard_paths",
      message: `MANIFEST contains overly broad path rule "${pattern}" — narrow TMVC/forbidden zones`,
    });
  }
  return lines;
}

function resolveExitCode(lines: AuditRigorLine[], strict: boolean): number {
  if (lines.some((l) => l.level === "fail")) return 1;
  if (strict && lines.some((l) => l.level === "warn")) return 1;
  return 0;
}

/** Path-isolated meta-governance scanner — always pass explicit workspaceRoot in tests. */
export function runAuditRigorChecks(
  workspaceRoot: string,
  options: AuditRigorOptions = {},
): AuditRigorReport {
  const strict = options.strict === true;
  const lines = [
    ...checkTypeScriptStrict(workspaceRoot),
    ...checkCoverageArtifacts(workspaceRoot, strict),
    ...checkWildcardDependencyRules(workspaceRoot),
  ];
  return {
    workspace_root: workspaceRoot,
    lines,
    exit_code: resolveExitCode(lines, strict),
  };
}
