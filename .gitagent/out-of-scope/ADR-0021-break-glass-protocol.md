---
id: ADR-0021
title: Break-glass protocol via verify --break-glass
status: ACTIVE
match_terms:
  - break-glass
  - bypass
  - hotfix
  - emergency
---

## Context

Issue #17 proposed `gantry bypass --break-glass <TICKET>` with an `AUDIT_LEDGER.md` immutable record. OpenGantry already ships break-glass on `gantry verify --break-glass` (RULES.md §6.2): `GXT_BYPASS_SECRET` matching `.gitagent/foreman/BYPASS.sha256`, forensic `refs/notes/gxt-bypass` git notes (or `--audit-commit` when notes cannot be pushed).

## Decision

- **The auditable break-glass protocol is `gantry verify --break-glass --reason "<text>"`** — not a separate bypass command.
- **The immutable ledger is git notes** (`refs/notes/gxt-bypass`), not `AUDIT_LEDGER.md`. CI and `validate-gxt.sh` accept commits with valid gxt-bypass notes on MSN-enforced paths.
- Issue #17's `AUDIT_LEDGER.md` / standalone bypass command design is **superseded** by this ADR.
- Break-glass does **not** disable `gantry runtime exec` forbidden-zone enforcement.

## Consequences

- Doctor warns when `BYPASS.sha256` is unprovisioned.
- SECURITY.md documents the runbook; adopters provision the anchor and push notes with the branch.
- Planner MUST review bypass usage post-incident per RULES.md §6.2.
