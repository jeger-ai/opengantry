---
id: ADR-0022
title: MCP write-containment at gxt_* tool boundaries
status: ACTIVE
match_terms:
  - mcp
  - write-containment
  - gxt_
  - forbidden_zone
---

## Context

Issue #14 proposed a filesystem write proxy for MCP tools. `gxt_runtime_exec` already enforces forbidden-zone baselines around executor commands ([`src/cli/lib/runtime-exec.ts`](../../src/cli/lib/runtime-exec.ts)). MCP governance tools (`gxt_execute_legislation`, `gxt_pin_mission`, `gxt_upgrade_apply`) can mutate repo files without going through runtime exec.

## Decision

- **Enforcement lives at MCP tool boundaries**, not a global write proxy.
- New helper [`src/cli/lib/mcp-write-guard.ts`](../../src/cli/lib/mcp-write-guard.ts) validates repo-relative targets using manifest `tmvc_roots` and `forbidden_zones` (same semantics as [`tmvc-path.ts`](../../src/cli/lib/tmvc-path.ts)).
- Denials return structured **`GXT_MCP_WRITE_DENIED`** (`MCP_WRITE_DENIED` internally).
- **Mission writes** (`gxt_execute_legislation`, `gxt_pin_mission`) must stay under `.gitagent/missions/`.
- **Substrate upgrade apply** (`gxt_upgrade_apply`): each `upgrade_payload.planned_writes` path is authorized when the mission is Planner-stamped with `skill_key: substrate`. Forbidden-zone targets are allowed only when explicitly listed in `planned_writes` (Tier-3 carve-out).

## Consequences

- MCP cannot legislate or pin missions outside `.gitagent/missions/`.
- Upgrade apply cannot promote staged files into manifest forbidden zones unless the signed upgrade mission lists them in `planned_writes`.
- `gxt_runtime_exec` forbidden-zone enforcement remains unchanged and complementary.
