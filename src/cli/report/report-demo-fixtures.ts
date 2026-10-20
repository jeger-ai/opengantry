import type { OverviewTimelineRow } from "./report-overview-projector.js";

/** Fictional marketing/demo fixtures — never real adopter mission IDs. */
export const DEMO_REPO_NAME = "acme-payments";
export const DEMO_SCHEMA_VERSION = "0.5.0";
export const DEMO_PINNED_MISSION =
  ".gitagent/missions/MSN-0042.add-webhook-retry-backoff.yaml";
export const DEMO_NEXT_STEP =
  "gantry verify --mission .gitagent/missions/MSN-0042.add-webhook-retry-backoff.yaml";

export const DEMO_TIMELINE: OverviewTimelineRow[] = [
  {
    msn_id: "MSN-0042",
    first_seen_ms: Date.parse("2026-08-28T09:12:00.000Z"),
    last_seen_ms: Date.parse("2026-09-02T12:00:00.000Z"),
    pinned: true,
    href: "/mission/MSN-0042",
    verify_status: "PASS",
  },
  {
    msn_id: "MSN-0041",
    first_seen_ms: Date.parse("2026-08-27T14:30:00.000Z"),
    last_seen_ms: Date.parse("2026-09-02T12:05:00.000Z"),
    pinned: false,
    href: "/mission/MSN-0041",
    verify_status: "FAIL",
  },
  {
    msn_id: "MSN-0040",
    first_seen_ms: Date.parse("2026-08-26T11:00:00.000Z"),
    last_seen_ms: Date.parse("2026-09-02T12:10:00.000Z"),
    pinned: false,
    href: "/mission/MSN-0040",
    verify_status: "ABORT",
  },
  {
    msn_id: "MSN-0039",
    first_seen_ms: Date.parse("2026-08-25T16:45:00.000Z"),
    last_seen_ms: Date.parse("2026-09-02T11:50:00.000Z"),
    pinned: false,
    href: "/mission/MSN-0039",
    verify_status: "PASS",
  },
  {
    msn_id: "MSN-0038",
    first_seen_ms: Date.parse("2026-08-24T10:20:00.000Z"),
    last_seen_ms: Date.parse("2026-08-30T09:15:00.000Z"),
    pinned: false,
    href: "/mission/MSN-0038",
    verify_status: null,
  },
];
