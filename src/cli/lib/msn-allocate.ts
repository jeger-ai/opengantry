import fs from "node:fs";
import path from "node:path";
import { extractMsnIdFromMissionPath } from "./missions/parser.js";
import { gitLogSubjects } from "./git.js";
import { isValidMsnId } from "./missions/parser.js";

export const WORK_MSN_BAND_MAX = 8999;
export const UPGRADE_MSN_BAND_MIN = 9000;
export const UPGRADE_MSN_BAND_MAX = 9099;

export type MsnBand = "work" | "upgrade";

export interface CollectUsedMsnIdsOptions {
  band?: MsnBand | "all";
  includeGitHistory?: boolean;
}

function msnNumeric(id: string): number {
  return Number.parseInt(id.replace("MSN-", ""), 10);
}

function inWorkBand(num: number): boolean {
  return num >= 1 && num <= WORK_MSN_BAND_MAX;
}

function inUpgradeBand(num: number): boolean {
  return num >= UPGRADE_MSN_BAND_MIN && num <= UPGRADE_MSN_BAND_MAX;
}

function bandFilter(num: number, band: MsnBand | "all"): boolean {
  if (band === "all") return true;
  return band === "work" ? inWorkBand(num) : inUpgradeBand(num);
}

function collectMsnIdsFromGitHistory(repoRoot: string, band: MsnBand | "all"): Set<string> {
  const used = new Set<string>();
  const subjects = gitLogSubjects(repoRoot, "MSN-", 100);
  for (const line of subjects) {
    const m = /\[MSN-(\d{4})\]/.exec(line);
    if (!m) continue;
    const id = `MSN-${m[1]!}`;
    if (!isValidMsnId(id)) continue;
    const num = msnNumeric(id);
    if (bandFilter(num, band === "all" ? "all" : "work")) used.add(id);
  }
  return used;
}

export function collectUsedMsnIds(repoRoot: string, opts: CollectUsedMsnIdsOptions = {}): Set<string> {
  const band = opts.band ?? "all";
  const used = new Set<string>();
  const missionsDir = path.join(repoRoot, ".gitagent", "missions");
  if (fs.existsSync(missionsDir)) {
    for (const ent of fs.readdirSync(missionsDir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const abs = path.join(missionsDir, ent.name);
      const fromName = ent.name.match(/^(MSN-\d{4})/);
      if (fromName && isValidMsnId(fromName[1]!)) {
        const num = msnNumeric(fromName[1]!);
        if (bandFilter(num, band)) used.add(fromName[1]!);
      }
      try {
        const fromContent = extractMsnIdFromMissionPath(abs);
        if (fromContent && isValidMsnId(fromContent)) {
          const num = msnNumeric(fromContent);
          if (bandFilter(num, band)) used.add(fromContent);
        }
      } catch {
        // ignore malformed mission files
      }
    }
  }

  if (opts.includeGitHistory !== false && (band === "work" || band === "all")) {
    for (const id of collectMsnIdsFromGitHistory(repoRoot, band)) used.add(id);
  }

  return used;
}

export function allocateMsn(repoRoot: string, options: { band: MsnBand }): string {
  const used = collectUsedMsnIds(repoRoot, {
    band: options.band,
    includeGitHistory: options.band === "work",
  });

  if (options.band === "work") {
    let max = 0;
    for (const id of used) {
      const num = msnNumeric(id);
      if (num > max) max = num;
    }
    const next = max + 1;
    if (next > WORK_MSN_BAND_MAX) {
      throw new Error(
        `gantry: no MSN available in work band 1-${WORK_MSN_BAND_MAX} (upgrade band starts at ${UPGRADE_MSN_BAND_MIN})`,
      );
    }
    return `MSN-${String(next).padStart(4, "0")}`;
  }

  for (let n = UPGRADE_MSN_BAND_MIN; n <= UPGRADE_MSN_BAND_MAX; n++) {
    const id = `MSN-${String(n).padStart(4, "0")}`;
    if (!used.has(id)) return id;
  }
  throw new Error(
    `gantry upgrade: no MSN available in upgrade band ${UPGRADE_MSN_BAND_MIN}-${UPGRADE_MSN_BAND_MAX}`,
  );
}
