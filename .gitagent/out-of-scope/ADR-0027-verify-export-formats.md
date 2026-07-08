---
id: ADR-0027
title: Verify SARIF and JUnit export formats
status: ACTIVE
match_terms:
  - sarif
  - junit
  - verify
  - export
  - enterprise
---

## Context

Issue #36: enterprise CI dashboards need machine-readable verify outcomes beyond grep of stdout. `gantry verify --json` already emits a stable envelope but is GXT-specific.

## Decision

- Add **`gantry verify --format json|sarif|junit`**; **`--json` remains an alias for `--format json`**.
- SARIF `ruleId` values use stable **`GXT_*` error codes** from failed payloads.
- JUnit groups testcases by verify **phase** (`git_proof`, `gate`, `kpi`, `trace`).
- Builders live in [`src/cli/lib/verify-export.ts`](../../src/cli/lib/verify-export.ts), fed from existing `VerifyResultPayload` / normalized failure contracts.

## Consequences

- CI can ingest SARIF/JUnit without parsing human verify logs.
- Schema covered by golden tests; JSON contract unchanged.
