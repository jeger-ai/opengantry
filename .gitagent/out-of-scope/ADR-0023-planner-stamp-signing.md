---
id: ADR-0023
title: Optional Planner stamp commit signing
status: ACTIVE
match_terms:
  - planner
  - signature
  - gpg
  - signing
  - stamp
---

## Context

Issue #37 requested hardening Planner legislation stamps (`[MSN-XXXX]` commits). Today git-proof checks Planner allowlist email + mission file touch only ([`src/cli/lib/git-proof.ts`](../../src/cli/lib/git-proof.ts)).

## Decision

- Add optional **`planner_signature`** tier in [`.gitagent/config.json`](../../.gitagent/config.json): `off` (default), `warn`, `require`.
- When `warn` or `require`, verify inspects the Planner stamp commit via `git log --format=%G?`; **`G` and `U` are good**, other statuses are unsigned.
- `require` fails verify with **`GXT_PLANNER_STAMP_UNSIGNED`**; `warn` emits a warning only.
- `gantry doctor` reports the configured tier and HEAD Planner stamp signature status when applicable.
- Default remains **`off`** so CI/Cloud adopters without a signing agent are unaffected.

## Consequences

- Repositories opting into `require` must enable `commit.gpgsign` (or SSH signing) for Planner legislation commits.
- Email allowlist git-proof remains the baseline; signing is an additive tier.
