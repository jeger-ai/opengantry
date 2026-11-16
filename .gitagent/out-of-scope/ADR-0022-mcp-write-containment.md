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
- Reads: [ADR-0056](ADR-0056-agent-read-guard.md) keeps secret files out of the model's context at the agent's own tool boundary (Claude Code and Cursor hooks), still without a global proxy.

## Amendment: the draft-token key leaves the repository (MSN-0381)

Issue #356 (ADR-0063 owner decision Q10) found that the HMAC key behind `gxt_draft_legislation` / `gxt_execute_legislation` lived at `.gitagent/foreman/DRAFT_TOKEN.key`, readable by the agent's own user, so one agent could sign its own draft and skip the human approval step. The key and the replay ledger now live in one per-user file, `~/.opengantry/draft-token.json` (directory overridable with `GANTRY_STATE_DIR`, refused when relative or, resolved through links, inside the repository), written under a lock file with a unique owner token and an fsynced temporary file renamed into place. An existing lock is never taken over, however old (PR #365 review round 2: any takeover lets a paused holder write over its successor and replay a token); it refuses with `TOKEN_STATE_LOCKED`, naming the lock, which the operator deletes only when no gantry process runs. `gantry cage policy` denies the directory to the sandbox (`Read`, `Edit`, `denyRead`, `denyWrite`, credentials), including a `GANTRY_STATE_DIR` set when it runs, and also the physical path when a link (a linked home, stow, a linked override) makes it differ, since the key is written there.

- A legacy in-repo `DRAFT_TOKEN.key` is never trusted: while it exists, draft and execute refuse with `TOKEN_LEGACY_KEY` and tell the operator to delete it. Drafts it signed stay refused afterwards.
- A malformed state file refuses (`TOKEN_STATE_INVALID`) instead of reading as an empty ledger. Deleting it deletes the key, so an old draft cannot be replayed under a fresh one.
- Residual: the broker and gantry run as the same OS user (owner decision Q3). Without a proven harness sandbox the agent can read `~/.opengantry` and forge a draft, so this cell stays `unproven`; restoring an older copy of the file with the same key re-enables the drafts consumed since. Both need read or write access that the sandbox denies.
