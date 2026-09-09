import fs from "node:fs";
import path from "node:path";
import { logInfo, setExitCode } from "../lib/cli-io.js";
import { emitCliJson, runUserCommand } from "../lib/command-boundary.js";
import { loadWorkspace } from "../lib/workspace.js";
import { parseMissionFile } from "../lib/missions/parser.js";
import { resolveMissionArg } from "../lib/mission-arg.js";
import { fetchMissionDependency } from "../lib/deps/deps-fetch.js";
import {
  checkMissionDependencies,
  type DependencyCheckResult,
} from "../lib/deps/deps-resolve.js";
import { gitRun } from "../lib/git.js";

function loadMissionDeps(root: string, missionArg?: string) {
  const resolved = resolveMissionArg(root, missionArg);
  const mission = parseMissionFile(root, resolved.missionRel);
  return { mission, resolved };
}

export function reportDependencyResults(
  results: DependencyCheckResult[],
  opts: { json?: boolean; headline: string },
): void {
  const failed = results.filter((r) => r.code !== "ok");
  if (opts.json) {
    emitCliJson({ status: failed.length === 0 ? "ok" : "failed", results });
  } else if (results.length === 0) {
    logInfo(`${opts.headline}: 0 dependency check(s)`);
  } else {
    for (const r of results) logInfo(`${opts.headline}: ${r.repo} ${r.msn_id} ${r.code}`);
  }
  if (failed.length > 0) setExitCode(1);
}

export function runDepsFetch(opts: { mission?: string; json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const { mission } = loadMissionDeps(root, opts.mission);
    const refs = mission.dependsOn.map((d) => fetchMissionDependency(root, d));
    if (opts.json) {
      emitCliJson({ status: "ok", refs });
      return;
    }
    logInfo(`gantry deps fetch: ${refs.length} ref(s)`);
  });
}

export function runDepsCheck(opts: { mission?: string; json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const { mission } = loadMissionDeps(root, opts.mission);
    reportDependencyResults(checkMissionDependencies(root, mission), {
      json: opts.json,
      headline: "gantry deps check",
    });
  });
}

export function runReleaseCheck(opts: { tag?: string; json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const tag = opts.tag?.trim();
    const range = tag ? `${tag}^..HEAD` : "HEAD";
    const diff = gitRun(root, ["diff", "--name-only", range, "--", ".gitagent/missions/"]);
    const files = diff.stdout.split("\n").map((s) => s.trim()).filter((s) => s.endsWith(".yaml") || s.endsWith(".yml"));
    const results: DependencyCheckResult[] = [];
    for (const rel of files) {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) continue;
      const mission = parseMissionFile(root, rel);
      results.push(...checkMissionDependencies(root, mission));
    }
    reportDependencyResults(results, { json: opts.json, headline: "gantry release check" });
  });
}
