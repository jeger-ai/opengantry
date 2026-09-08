import { logInfo } from "../lib/cli-io.js";
import { emitCliJson, runUserCommand } from "../lib/command-boundary.js";
import { loadWorkspace } from "../lib/workspace.js";
import { parseMissionFile } from "../lib/missions/parser.js";
import { resolveMissionArg } from "../lib/mission-arg.js";
import { fetchMissionDependency } from "../lib/deps/deps-fetch.js";
import { checkMissionDependency } from "../lib/deps/deps-resolve.js";
import { maybeAppendLedger } from "../lib/ledger/ledger-append.js";
import { gitRun } from "../lib/git.js";
import fs from "node:fs";
import path from "node:path";

function loadMissionDeps(root: string, missionArg?: string) {
  const resolved = resolveMissionArg(root, missionArg);
  const mission = parseMissionFile(root, resolved.missionRel);
  return { mission, resolved };
}

export function runDepsFetch(opts: { mission?: string; json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const { mission } = loadMissionDeps(root, opts.mission);
    const refs = (mission.dependsOn ?? []).map((d) => fetchMissionDependency(root, d));
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
    const results = (mission.dependsOn ?? []).map((d) => checkMissionDependency(root, d));
    for (const r of results) {
      if (r.code === "ok") {
        maybeAppendLedger(root, {
          kind: "dependency_check",
          msn_id: mission.msnId ?? "MSN-0000",
          payload: { repo: r.repo, msn_id: r.msn_id, result: "ok" },
        });
      }
    }
    const failed = results.filter((r) => r.code !== "ok");
    if (opts.json) {
      emitCliJson({ status: failed.length === 0 ? "ok" : "failed", results });
      return;
    }
    for (const r of results) logInfo(`gantry deps check: ${r.repo} ${r.msn_id} ${r.code}`);
  });
}

export function runDepsStatus(opts: { mission?: string; json?: boolean }): void {
  runDepsCheck(opts);
}

export function runReleaseCheck(opts: { tag?: string; json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const tag = opts.tag?.trim();
    const range = tag ? `${tag}^..HEAD` : "HEAD";
    const diff = gitRun(root, ["diff", "--name-only", range, "--", ".gitagent/missions/"]);
    const files = diff.stdout.split("\n").map((s) => s.trim()).filter((s) => s.endsWith(".yaml") || s.endsWith(".yml"));
    const results: unknown[] = [];
    for (const rel of files) {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) continue;
      const mission = parseMissionFile(root, rel);
      for (const d of mission.dependsOn ?? []) {
        results.push(checkMissionDependency(root, d));
      }
    }
    if (opts.json) {
      emitCliJson({ status: "ok", results });
      return;
    }
    logInfo(`gantry release check: ${results.length} dependency check(s)`);
  });
}
