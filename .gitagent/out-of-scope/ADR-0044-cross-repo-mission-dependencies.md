---
id: ADR-0044
title: Cross-repository mission dependencies via fetched ledger refs
status: ACTIVE
match_terms:
  - depends_on
  - cross-repo
  - dependency
  - gantry deps
  - release check
  - repository_hash
---

## Context

A mission in repo A often must not release until repo B's mission has a passing, signed attestation (microservice boundary). Neither the spoke nor the Hub currently models this edge. A Hub registry would violate [ADR-0034](ADR-0034-hybrid-hub-spoke-metadata-plane.md) (spoke sole enforcer; no Hub SaaS in this repo) and would make `gantry doctor` / `gantry verify` network-dependent.

[ADR-0043](ADR-0043-compliance-ledger-git-ref.md) already distributes digest-only entries on `refs/gxt/ledger`. That ref is the dependency proof channel.

## Decision

### Mission field

`MISSION.schema.yaml` gains optional `depends_on[]`:

```yaml
depends_on:
  - repo: github.com/org/backend   # canonical host/owner/repo or URL
    ref: refs/gxt/ledger           # default
    msn_id: MSN-0100
    require:
      verify_status: passed
      signed: true
      max_age_days: 14             # optional
    expected_repository_hash: ""   # optional pin
```

Mirrored byte-identically to `templates/` and `examples/iii-integration/` copies.

### Same-org proof (offline)

The consumer recomputes `repository_hash` for `depends_on.repo` with **its own** `GANTRY_ORG_PEPPER` (customer-held; [ADR-0036](ADR-0036-receipt-v0-2-signed-attribution.md)) and requires equality with the dependency entry's `repository_hash`. Shared pepper ⇒ same org. Mismatch → `GXT_DEPENDENCY_ORG_MISMATCH`. No Hub registry.

### Fetch vs check

- **`gantry deps fetch`** is the only network path: `git fetch <url> <ref>:refs/gxt/deps/<slug>` (ADR-0026 pattern).
- **`gantry deps check`**, **`gantry verify`** (new `dependencies` phase, after `policy`, before `gate`), and **`gantry doctor`** walk **local** refs only.
- Unfetched → `GXT_DEPENDENCY_UNFETCHED`. Failed/missing requirement → `GXT_DEPENDENCY_UNSATISFIED`. Unsigned when `require.signed` → `GXT_DEPENDENCY_UNSIGNED`. Older than `max_age_days` → `GXT_DEPENDENCY_STALE`.

Each satisfied check MAY append a `dependency_check` ledger entry ([ADR-0043](ADR-0043-compliance-ledger-git-ref.md)).

### Release tag gate

`gantry release check --tag <v>` evaluates `depends_on` for missions changed since the previous tag. This is the "before a release tag can be cut" gate. Cross-repo **trigger** (start work in B when A finishes) is advisory CI glue only (`repository_dispatch` / `workflow_dispatch` after `ledger push`) — not enforcement.

### CI

`gxt-validate.yml` MAY run `gantry deps fetch` with a read-only token before verify. Ledger refs are digest-only and safe to grant read access across teams.

## Consequences

- CLI implementation is a follow-on `gantry`-skill mission.
- Plane-side cross-repo status APIs are deferred.
- A frontend repo can prove a backend mission passed, signed, and is same-org without a SaaS hub.
