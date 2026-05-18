import YAML from "yaml";
import { MSN_ID_PATTERN } from "./constants.js";
import { gitRunOk } from "./git-repo.js";

const MISSIONS_PREFIX = ".gitagent/missions/";

function parseMsnFromYamlContent(content: string): string | null {
  try {
    const data = YAML.parse(content) as { msn_id?: string; msnId?: string };
    const raw = data.msn_id ?? data.msnId;
    if (typeof raw === "string" && MSN_ID_PATTERN.test(raw.trim())) return raw.trim();
  } catch {
    /* skip */
  }
  return null;
}

export function msnFromMissionPath(rel: string): string | null {
  const norm = rel.trim().replace(/\\/g, "/");
  if (!norm.startsWith(MISSIONS_PREFIX)) return null;
  if (!/\.(ya?ml|md)$/i.test(norm)) return null;
  const fromName = norm.match(/MSN-\d{4}/)?.[0];
  if (fromName && MSN_ID_PATTERN.test(fromName)) return fromName;
  return null;
}

export function listMissionMsnIdsAtRef(root: string, ref: string): Set<string> {
  const ids = new Set<string>();
  const tree = gitRunOk(root, ["ls-tree", "-r", "--name-only", ref, MISSIONS_PREFIX]);
  if (!tree.ok) return ids;

  for (const rel of tree.stdout.split("\n")) {
    const norm = rel.trim().replace(/\\/g, "/");
    if (!norm) continue;
    const fromName = msnFromMissionPath(norm);
    if (fromName) {
      ids.add(fromName);
      continue;
    }
    const show = gitRunOk(root, ["show", `${ref}:${norm}`]);
    if (!show.ok) continue;
    const parsed = parseMsnFromYamlContent(show.stdout);
    if (parsed) ids.add(parsed);
  }
  return ids;
}
