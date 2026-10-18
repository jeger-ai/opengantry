// Facade (ADR-0052 step 5c-ii): the checks live in packages/plane; the ledger append stays here.
export { checkMissionDependency, dependencyCheckLedgerPayload, type DependencyCheckResult, type DependencyFailureCode } from "#plane/deps-resolve.js";
import { checkMissionDependencies as checkOnly, dependencyCheckLedgerPayload, type DependencyCheckResult } from "#plane/deps-resolve.js";
import { appendLedgerIfEnabled } from "../ledger/ledger-append.js";
import { msnIdOrDefault, type ParsedMission } from "#core/mission-types.js";

/** Check every depends_on row and append one aggregated ok ledger entry. */
export function checkMissionDependencies(root: string, mission: ParsedMission): DependencyCheckResult[] {
  const results = checkOnly(root, mission);
  const payload = dependencyCheckLedgerPayload(mission, results);
  if (payload) appendLedgerIfEnabled(root, "dependency_check", msnIdOrDefault(mission), payload);
  return results;
}
