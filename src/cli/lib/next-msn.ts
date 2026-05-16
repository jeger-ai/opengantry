import fs from "node:fs";
import path from "node:path";
import { MSN_ID_PATTERN } from "./constants.js";
import { extractMsnIdFromMissionPath } from "./mission-msn.js";

const REL_MISSIONS_DIR = ".gitagent/missions";

/** Consider `MSN-NNNN` in filename (any match). */
function considerMsnInString(s: string, maxRef: { n: number }): void {
  for (const m of s.matchAll(/MSN-\d{4}/g)) {
    const id = m[0]!;
    if (!MSN_ID_PATTERN.test(id)) continue;
    const num = parseInt(id.slice(4), 10);
    if (!Number.isNaN(num)) maxRef.n = Math.max(maxRef.n, num);
  }
}

/**
 * Allocates next Mission id MSn-NNNN by scanning `.gitagent/missions/` filenames and MSN ids inside mission files.
 * Returns `MSN-0000` when no missions directory or no MSN usage found (first allocation).
 */
export function allocateNextMsnId(repoRoot: string): string {
  const dir = path.join(repoRoot, REL_MISSIONS_DIR);
  const maxRef = { n: -1 };

  if (!fs.existsSync(dir)) {
    return formatMsn(maxRef.n + 1);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    considerMsnInString(ent.name, maxRef);

    if (!ent.isFile()) continue;
    const lower = ent.name.toLowerCase();
    if (!lower.endsWith(".md") && !lower.endsWith(".yaml") && !lower.endsWith(".yml")) continue;

    const abs = path.join(dir, ent.name);
    try {
      const idFromFile = extractMsnIdFromMissionPath(abs);
      if (idFromFile && MSN_ID_PATTERN.test(idFromFile)) {
        const num = parseInt(idFromFile.slice(4), 10);
        if (!Number.isNaN(num)) maxRef.n = Math.max(maxRef.n, num);
      } else {
        const bodyHead = fs.readFileSync(abs, "utf8").slice(0, 64_000);
        considerMsnInString(bodyHead, maxRef);
      }
    } catch {
      // ignore unreadable
    }
  }

  const next = maxRef.n + 1;
  if (next > 9999) {
    throw new Error(`gapman legislate: MSN overflow (max MSN-9999); archive or prune missions`);
  }
  return formatMsn(next);
}

function formatMsn(n: number): string {
  if (n < 0 || n > 9999) {
    throw new Error(`gapman legislate: invalid MSN slot ${String(n)}`);
  }
  return `MSN-${String(n).padStart(4, "0")}`;
}
