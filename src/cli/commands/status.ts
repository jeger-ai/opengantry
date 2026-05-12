import { logInfo, setExitCode } from "../lib/cli-io.js";
import { loadWorkspaceWithSkillSync } from "../lib/workspace.js";

export function runStatus(): void {
  const { root, manifest, skillSync } = loadWorkspaceWithSkillSync();
  logInfo(`repo: ${root}`);
  logInfo(`schema_version: ${manifest.schema_version}`);
  logInfo(`manifest skills: ${skillSync.manifestKeys.join(", ") || "(none)"}`);
  logInfo(`skills/*.md: ${skillSync.diskFiles.join(", ") || "(none)"}`);
  for (const w of skillSync.warnings) logInfo(`warning: ${w}`);
  for (const e of skillSync.errors) logInfo(`error: ${e}`);
  logInfo(skillSync.ok ? "status: OK" : "status: FAILED");
  if (!skillSync.ok) setExitCode(1);
}
