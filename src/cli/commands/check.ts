import { getRepoRoot } from "../lib/git.js";
import { loadManifest } from "../lib/manifest.js";
import { checkSkillManifestSync } from "../lib/skill-sync.js";

export function runCheck(): void {
  const root = getRepoRoot();
  const manifest = loadManifest(root);
  const sync = checkSkillManifestSync(root, manifest);
  for (const w of sync.warnings) console.error(`warning: ${w}`);
  if (!sync.ok) {
    for (const e of sync.errors) console.error(e);
    process.exitCode = 1;
    return;
  }
  console.log("gapman check: MANIFEST OK; skills/ in sync (Rule 4.4)");
}
