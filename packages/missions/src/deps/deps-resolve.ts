// The checks live in packages/plane; this module adds the ledger append and reports how it went.
import { checkMissionDependencies, dependencyCheckLedgerPayload, type DependencyCheckResult } from "#plane/deps-resolve.js";
import { appendLedgerIfEnabled, type LedgerAppendOutcome } from "../ledger/ledger-append.js";
import { msnIdOrDefault, type ParsedMission } from "#core/mission-types.js";

interface RecordedDependencyCheck {
  results: DependencyCheckResult[];
  /** The aggregated ok entry's append; null when there was nothing to record. */
  ledger: LedgerAppendOutcome<"dependency_check"> | null;
}

/** Check every depends_on row and append one aggregated ok ledger entry. */
export function checkAndRecordMissionDependencies(root: string, mission: ParsedMission): RecordedDependencyCheck {
  const results = checkMissionDependencies(root, mission);
  const payload = dependencyCheckLedgerPayload(mission, results);
  const ledger = payload ? appendLedgerIfEnabled(root, "dependency_check", msnIdOrDefault(mission), payload) : null;
  return { results, ledger };
}
