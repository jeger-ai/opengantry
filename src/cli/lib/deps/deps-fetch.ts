import { gitRun } from "../git.js";
import { GantryUserError } from "../errors.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import type { MissionDependencySpec } from "../types.js";
import { assertSafeFetchRef, depsRefForRepo, gitUrlForRepo } from "./deps-slug.js";

/** Explicit network path (ADR-0026 / ADR-0044). Doctor and verify MUST NOT call this. */
export function fetchMissionDependency(root: string, dep: MissionDependencySpec): string {
  const destRef = depsRefForRepo(dep.repo);
  const srcRef = assertSafeFetchRef(dep.ref ?? "refs/gxt/ledger");
  const url = gitUrlForRepo(dep.repo);
  const r = gitRun(root, ["fetch", "--", url, `${srcRef}:${destRef}`]);
  if (!r.ok) {
    throw new GantryUserError(
      GXT_ERROR.DEPENDENCY_UNFETCHED,
      `gantry deps fetch failed for ${dep.repo}: ${r.stderr.trim()}`,
      "grant read access to refs/gxt/ledger or check the URL",
      1,
    );
  }
  return destRef;
}
