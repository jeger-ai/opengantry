import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { REL_MANIFEST } from "./constants.js";
import { toPosixRel } from "./cli-io.js";
import {
  TARGET_ARCHITECTURE_FILENAME,
  TARGET_ARCHITECTURE_SCHEMA_VERSION,
  TARGET_ARCHITECTURE_V3_SCHEMA_VERSION,
  type TargetArchitectureSpec,
} from "./arch/cage/target-architecture.js";
import { getDomainAdapter } from "./domains/index.js";
import {
  type DiscoveryProposal,
  runDiscoveryScan,
  serializeDiscoveryProposal,
} from "./discovery-scanner.js";

export const DISCOVERY_PROPOSAL_REL = ".gitagent/discovery-proposal.json" as const;

export interface DiscoveryApplyResult {
  proposalPath: string;
  targetArchitecturePath?: string;
  manifestPath?: string;
}

function proposalPath(repoRoot: string): string {
  return path.join(repoRoot, DISCOVERY_PROPOSAL_REL.split("/").join(path.sep));
}

/** Emit discovery proposal JSON without writing baseline governance files. */
export function emitDiscoveryProposal(
  repoRoot: string,
  options: { domain?: string; onProgress?: (n: number) => void } = {},
): { proposal: DiscoveryProposal; proposalPath: string } {
  const proposal = runDiscoveryScan(repoRoot, options);
  const out = proposalPath(repoRoot);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serializeDiscoveryProposal(proposal), "utf8");
  return { proposal, proposalPath: toPosixRel(repoRoot, out) };
}

function inferLayersFromProposal(proposal: DiscoveryProposal): TargetArchitectureSpec["layers"] {
  const layerDirs = new Set<string>();
  for (const edge of proposal.dependency_edges) {
    const dir = edge.from_file.includes("/") ? edge.from_file.split("/")[0]! : "src";
    layerDirs.add(dir);
  }
  if (layerDirs.size === 0) {
    return [{ id: "app", globs: ["src/**"] }];
  }
  return [...layerDirs]
    .sort()
    .map((dir) => ({ id: dir.replace(/[^a-z0-9_]/gi, "_"), globs: [`${dir}/**`] }));
}

function buildDraftTargetArchitecture(proposal: DiscoveryProposal): TargetArchitectureSpec {
  const adapter = getDomainAdapter(proposal.domain ?? "code");
  if (adapter.key === "content") {
    const globs = [...adapter.defaultScanGlobs];
    return {
      schema_version: TARGET_ARCHITECTURE_V3_SCHEMA_VERSION,
      domain: "content",
      scan_roots: globs.map((g) => g.replace(/\/\*\*$/, "")),
      languages: ["markdown", "html", "text"],
      layers: [{ id: "content", globs }],
      rules: [],
    };
  }
  const layers = inferLayersFromProposal(proposal);
  const scan_roots = layers.map((l) => l.globs[0]!.replace(/\/\*\*$/, ""));
  return {
    schema_version: TARGET_ARCHITECTURE_SCHEMA_VERSION,
    domain: "code",
    scan_roots,
    languages: ["typescript"],
    layers,
    rules: [],
  };
}

function buildDraftManifest(repoRoot: string): Record<string, unknown> {
  const pkgPath = path.join(repoRoot, "package.json");
  let skillKey = "app";
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
      const name = pkg.name?.split("/").pop() ?? "app";
      skillKey = name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 32) || "app";
    } catch {
      /* keep default */
    }
  }
  return {
    schema_version: "0.5.0",
    skills: {
      [skillKey]: {
        desc: "Auto-discovered skill scaffold (confirm before merge).",
        trust_threshold: "Tier-2",
        tmvc_roots: ["src/"],
        forbidden_zones: [".gitagent/foreman/", ".gitagent/planner/RULES.md"],
      },
    },
    path_risks: { "src/": "Tier-2" },
    risk_keywords: ["refactor", "migrate", "delete", "security", "schema"],
    perimeter_protected: [
      "**/.gxt-skill.yaml",
      ".gitagent/foreman/MANIFEST.json",
      ".gitagent/planner/RULES.md",
    ],
  };
}

/** Apply confirmed discovery proposal to draft TARGET_ARCHITECTURE.yaml + MANIFEST.json. */
export function applyDiscoveryProposal(repoRoot: string, proposal: DiscoveryProposal): DiscoveryApplyResult {
  const archBody = YAML.stringify(buildDraftTargetArchitecture(proposal));
  const archAbs = path.join(repoRoot, TARGET_ARCHITECTURE_FILENAME);
  fs.writeFileSync(archAbs, archBody, "utf8");

  const manifestAbs = path.join(repoRoot, REL_MANIFEST.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(manifestAbs), { recursive: true });
  fs.writeFileSync(manifestAbs, `${JSON.stringify(buildDraftManifest(repoRoot), null, 2)}\n`, "utf8");

  return {
    proposalPath: DISCOVERY_PROPOSAL_REL,
    targetArchitecturePath: TARGET_ARCHITECTURE_FILENAME,
    manifestPath: REL_MANIFEST,
  };
}

export function loadDiscoveryProposal(repoRoot: string): DiscoveryProposal | null {
  const abs = proposalPath(repoRoot);
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, "utf8")) as DiscoveryProposal;
}
