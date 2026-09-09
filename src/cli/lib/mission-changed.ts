import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { isVerifiableMissionPath } from "./dirty-missions.js";
import { GantryUserError } from "./errors.js";
import { gitRevParse, gitRunOk } from "./git.js";

const MSN_TAG_RE = /\[(MSN-\d{4})\]/g;

export function resolveDefaultChangedBaseRef(repoRoot: string): string {
  for (const candidate of ["origin/main", "origin/master", "main", "master"] as const) {
    if (gitRevParse(repoRoot, candidate)) return candidate;
  }
  return "HEAD~1";
}

export type ChangedMissionsDiscovery =
  | {
      kind: "ok";
      missions: string[];
      uniqueMsns: string[];
      purityMsn: string | null;
      companionCount: number;
      baseSha: string;
      headSha: string;
    }
  | { kind: "contamination"; uniqueMsns: string[]; baseSha: string; headSha: string }
  | {
      kind: "purity_mismatch";
      purityMsn: string;
      missions: string[];
      uniqueMsns: string[];
      baseSha: string;
      headSha: string;
    };

function listUniqueMsnIds(repoRoot: string, baseSha: string, headSha: string): string[] {
  const r = gitRunOk(repoRoot, ["log", "--no-merges", "--format=%s", `${baseSha}..${headSha}`]);
  if (!r.ok) return [];
  const ids = new Set<string>();
  for (const line of r.stdout.split("\n")) {
    MSN_TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null = MSN_TAG_RE.exec(line);
    while (match !== null) {
      ids.add(match[1]!);
      match = MSN_TAG_RE.exec(line);
    }
  }
  return [...ids].sort();
}

function listChangedMissionFiles(repoRoot: string, baseSha: string, headSha: string): string[] {
  const r = gitRunOk(repoRoot, [
    "diff",
    "--name-only",
    "--diff-filter=ACMRT",
    `${baseSha}...${headSha}`,
  ]);
  if (!r.ok) return [];
  const out: string[] = [];
  for (const line of r.stdout.split("\n")) {
    const rel = line.trim().replace(/\\/g, "/");
    if (!rel || !isVerifiableMissionPath(rel)) continue;
    if (!fs.existsSync(path.join(repoRoot, rel))) continue;
    out.push(rel);
  }
  return [...new Set(out)].sort();
}

function filterByPurityMsn(missions: string[], purityMsn: string): string[] {
  const prefix = `${purityMsn}.`;
  return missions.filter((rel) => path.posix.basename(rel).startsWith(prefix));
}

export function discoverChangedMissions(
  repoRoot: string,
  options: { baseRef?: string; headRef?: string } = {},
): ChangedMissionsDiscovery {
  const baseRef = options.baseRef?.trim() || resolveDefaultChangedBaseRef(repoRoot);
  const headRef = options.headRef?.trim() || "HEAD";
  const baseSha = gitRevParse(repoRoot, baseRef);
  if (!baseSha) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      `${CLI_NAME} mission changed: invalid base ref: ${baseRef}`,
      undefined,
      2,
    );
  }
  const headSha = gitRevParse(repoRoot, headRef);
  if (!headSha) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      `${CLI_NAME} mission changed: invalid head ref: ${headRef}`,
      undefined,
      2,
    );
  }

  const uniqueMsns = listUniqueMsnIds(repoRoot, baseSha, headSha);
  if (uniqueMsns.length > 1) {
    return { kind: "contamination", uniqueMsns, baseSha, headSha };
  }

  const missions = listChangedMissionFiles(repoRoot, baseSha, headSha);
  if (uniqueMsns.length === 1) {
    const purityMsn = uniqueMsns[0]!;
    if (missions.length === 0) {
      return {
        kind: "ok",
        missions: [],
        uniqueMsns,
        purityMsn,
        companionCount: 0,
        baseSha,
        headSha,
      };
    }
    const filtered = filterByPurityMsn(missions, purityMsn);
    if (filtered.length === 0) {
      return { kind: "purity_mismatch", purityMsn, missions, uniqueMsns, baseSha, headSha };
    }
    return {
      kind: "ok",
      missions: filtered,
      uniqueMsns,
      purityMsn,
      companionCount: missions.length - filtered.length,
      baseSha,
      headSha,
    };
  }

  return {
    kind: "ok",
    missions,
    uniqueMsns,
    purityMsn: null,
    companionCount: 0,
    baseSha,
    headSha,
  };
}
