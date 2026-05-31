import fs from "node:fs";
import path from "node:path";
import { formatRepoRelative } from "./cli-io.js";

export function resolveMissionFilePath(repoRoot: string, missionFilePath: string): string {
  return path.isAbsolute(missionFilePath)
    ? path.resolve(missionFilePath)
    : path.join(repoRoot, missionFilePath.replace(/\\/g, path.sep));
}

export function findMissionPathByMsn(repoRoot: string, msnId: string): string | null {
  const missionsDir = path.join(repoRoot, ".gitagent", "missions");
  if (!fs.existsSync(missionsDir)) return null;
  const match = fs
    .readdirSync(missionsDir)
    .filter((f) => f.startsWith(`${msnId}.`) && f.endsWith(".yaml"))
    .sort()
    .at(-1);
  return match ? path.join(missionsDir, match) : null;
}

export function pinMissionFile(repoRoot: string, missionAbs: string): string {
  const rel = formatRepoRelative(repoRoot, missionAbs);
  const pinPath = path.join(repoRoot, ".gitagent", "missions", ".active-mission");
  fs.mkdirSync(path.dirname(pinPath), { recursive: true });
  fs.writeFileSync(pinPath, `${rel}\n`, "utf8");
  return rel;
}

export function resolveMissionFromCandidates(repoRoot: string, candidates: string[]): string | null {
  for (const c of candidates) {
    const trimmed = c.trim();
    if (!trimmed) continue;
    const abs = resolveMissionFilePath(repoRoot, trimmed);
    if (fs.existsSync(abs)) {
      return formatRepoRelative(repoRoot, abs);
    }
  }
  return null;
}
