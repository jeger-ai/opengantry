---
id: ADR-0026
title: External architecture pointer HTTP fetch
status: ACTIVE
match_terms:
  - architecture
  - external
  - arch fetch
  - pointer
---

## Context

Issue #34: `kind: external` exists in [`.gitagent/ARCHITECTURE.pointer.json`](../ARCHITECTURE.pointer.json) but the CLI had no HTTP client — agents had to manually follow URLs. Credentials are stored via `gantry arch cred set` but were unused by CLI fetch logic.

## Decision

- Add **`gantry arch fetch`** as a convenience command (not an enforcement gate).
- **`gantry doctor` stays validation-only** — no network I/O in doctor checks.
- Fetch uses `loadArchitecturePointer` + `loadArchitectureCredential` for `access.credential_slot`; supports bearer, api_key, basic, and custom header kinds.
- On missing credentials or fetch failure, emit a structured fallback pointing at `ARCHITECTURE-DISCOVERY.md` (from `discovery.skill`).

## Consequences

- Agents and humans can pipe fetched docs to stdout or `--json` without leaving the CLI.
- Enforcement remains mission TMVC + verify gates; fetch does not affect PASS/FAIL.
