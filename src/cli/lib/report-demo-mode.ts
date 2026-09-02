import path from "node:path";
import { readJsonOrNull } from "./atomic-fs.js";
import {
  DEMO_NEXT_STEP,
  DEMO_PINNED_MISSION,
  DEMO_REPO_NAME,
  DEMO_SCHEMA_VERSION,
  DEMO_TIMELINE,
} from "./report-demo-fixtures.js";
import type { OverviewViewModel } from "./report-overview-projector.js";

export const REL_REPORT_DEMO_FLAG = ".gitagent/tmp/report-demo.json" as const;

export function isReportDemoMode(root: string): boolean {
  const abs = path.join(root, REL_REPORT_DEMO_FLAG);
  const parsed = readJsonOrNull<{ active?: boolean }>(abs);
  return parsed?.active === true;
}

export function applyReportDemoOverview(model: OverviewViewModel): OverviewViewModel {
  return {
    ...model,
    repo_name: DEMO_REPO_NAME,
    schema_version: DEMO_SCHEMA_VERSION,
    pinned_mission: DEMO_PINNED_MISSION,
    verify_readiness: "ready",
    readiness_summary: "ready",
    blockers: [],
    next_step: DEMO_NEXT_STEP,
    timeline: DEMO_TIMELINE,
  };
}

export function withReportDemoOverlay(
  project: (root: string) => OverviewViewModel,
): (root: string) => OverviewViewModel {
  return (root: string) => {
    const model = project(root);
    return isReportDemoMode(root) ? applyReportDemoOverview(model) : model;
  };
}

/** @deprecated Use withReportDemoOverlay at the command/server boundary. */
export function maybeApplyDemoOverview(root: string, model: OverviewViewModel): OverviewViewModel {
  return isReportDemoMode(root) ? applyReportDemoOverview(model) : model;
}
