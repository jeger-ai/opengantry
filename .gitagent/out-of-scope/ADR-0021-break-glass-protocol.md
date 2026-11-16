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

## Amendment: the anchor comes from the base commit (MSN-0381)

Issue #356 (ADR-0063 owner decision Q10) found that the anchor was read from the working tree, so a candidate could write `BYPASS.sha256` next to a secret it chose. `gantry verify --break-glass` now reads the anchor from the trusted base commit: the merge-base of `HEAD` with `origin/HEAD`, `origin/main` or `origin/master`, or, in a repository with no remote default branch, with local `main` or `master`. Neither a working-tree edit nor a commit on the branch under review moves it. No base (`BYPASS_BASE_UNKNOWN`) or no anchor at the base (`BYPASS_NOT_CONFIGURED`) refuses. The secret, the note and the ledger row are unchanged.

Limits: without a remote, the base is the local default branch, which a same-user process can move with a commit there; with a remote, it can still rewrite the remote-tracking ref locally. Local break-glass is not a boundary against a same-user process without a proven sandbox. CI, judging the pull request's base, is. CI still accepts any well-formed `gxt-bypass` note; that check does not prove the secret was known (follow-up).
