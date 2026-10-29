import { EXIT_CODE } from "#core/exit-codes.js";
import fs from "node:fs";
import path from "node:path";
import { setExitCode } from "../output/cli-io.js";
import { runUserCommand, type CommandPresentation } from "../output/command-boundary.js";
import { loadWorkspace } from "#missions/workspace.js";
import { parseMissionFile } from "#missions/mission/parser.js";
import { resolveMissionArg } from "../flows/mission-arg.js";
import { fetchMissionDependency } from "#plane/deps-fetch.js";
import { checkMissionDependencies, type DependencyCheckResult } from "#plane/deps-resolve.js";
import { gitRun } from "#git/git.js";

function loadMissionDeps(root: string, missionArg?: string) {
  const resolved = resolveMissionArg(root, missionArg);
  const mission = parseMissionFile(root, resolved.missionRel);
  return { mission, resolved };
}

export function reportDependencyResults(
  results: DependencyCheckResult[],
  opts: { headline: string },
): CommandPresentation {
  const failed = results.filter((r) => r.code !== "ok");
  if (failed.length > 0) setExitCode(EXIT_CODE.FAILURE);
  const human =
    results.length === 0
      ? `${opts.headline}: 0 dependency check(s)`
      : results.map((r) => `${opts.headline}: ${r.repo} ${r.msn_id} ${r.code}`);
  return {
    json: { status: failed.length === 0 ? "ok" : "failed", results },
    human,
  };
}

export function runDepsFetch(opts: { mission?: string; json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const { mission } = loadMissionDeps(root, opts.mission);
    const refs = mission.dependsOn.map((d) => fetchMissionDependency(root, d));
    return { json: { status: "ok", refs }, human: `gantry deps fetch: ${refs.length} ref(s)` };
  });
}

export function runDepsCheck(opts: { mission?: string; since?: string; json?: boolean }): void {
  if (opts.since !== undefined) {
    runDepsCheckSince(opts.since, opts.json);
    return;
  }
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const { mission } = loadMissionDeps(root, opts.mission);
    return reportDependencyResults(checkMissionDependencies(root, mission), { headline: "gantry deps check" });
  });
}

/** `deps check --since <ref>`: every mission file changed since the ref (a release tag). */
function runDepsCheckSince(since: string, json: boolean | undefined): void {
  runUserCommand({ json }, () => {
    const { root } = loadWorkspace();
    const tag = since.trim();
    const range = tag ? `${tag}^..HEAD` : "HEAD";
    const diff = gitRun(root, ["diff", "--name-only", range, "--", ".gitagent/missions/"]);
    const files = diff.stdout.split("\n").map((s) => s.trim()).filter((s) => s.endsWith(".yaml") || s.endsWith(".yml"));
    const results: DependencyCheckResult[] = [];
    for (const rel of files) {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) continue;
      results.push(...checkMissionDependencies(root, parseMissionFile(root, rel)));
    }
    return reportDependencyResults(results, { headline: "gantry deps check" });
  });
}
