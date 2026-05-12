import { getRepoRoot } from "../lib/git.js";
import { loadManifest } from "../lib/manifest.js";
import { checkSkillManifestSync } from "../lib/skill-sync.js";

export function runStatus(): void {
  const root = getRepoRoot();
  const manifest = loadManifest(root);
  const sync = checkSkillManifestSync(root, manifest);
  console.log(`repo: ${root}`);
  console.log(`schema_version: ${manifest.schema_version}`);
  console.log(`manifest skills: ${sync.manifestKeys.join(", ") || "(none)"}`);
  console.log(`skills/*.md: ${sync.diskFiles.join(", ") || "(none)"}`);
  for (const w of sync.warnings) console.log(`warning: ${w}`);
  for (const e of sync.errors) console.log(`error: ${e}`);
  console.log(sync.ok ? "status: OK" : "status: FAILED");
  if (!sync.ok) process.exitCode = 1;
}
