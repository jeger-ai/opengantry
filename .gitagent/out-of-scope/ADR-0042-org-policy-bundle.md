---
id: ADR-0042
title: Organization policy bundle (tighten-only floor)
status: ACTIVE
match_terms:
  - org policy
  - policy bundle
  - POLICY.pointer
  - gantry policy
  - tighten-only
  - banned_imports
  - mandatory_gates
  - config_floor
---

## Context

[ADR-0034](ADR-0034-hybrid-hub-spoke-metadata-plane.md) scoped org-wide visibility to a separate Hub and said: "no new `gantry policy` command tree and no HubSink network I/O in doctor." Adopters now need a **fail-closed org floor** (mandatory scans, banned libraries, signature tiers) that cannot be loosened by a local repo. A Hub HTTP policy server would violate ADR-0034 (spoke is sole enforcer; doctor stays offline).

## Decision

### Amends ADR-0034

The clause "no new `gantry policy` command tree" is **amended**. `gantry policy pull|status|diff` is a **spoke** command tree:

- **`gantry policy pull`** is the only network path (same pattern as `gantry arch fetch` per [ADR-0026](ADR-0026-arch-external-fetch.md)).
- **`gantry doctor`** and **`gantry verify`** read only from disk: the tracked pointer plus a gitignored cache. They MUST NOT open sockets.
- Hub remains consumer/aggregator. It MUST NOT push policy into the spoke at verify time.

`gantry doctor --policy <expected-digests.json>` remains the offline digest compare. When a bundle includes `expected_digests`, doctor folds those fields into the same check.

### Bundle + pointer

- Org law is a signed YAML bundle validated by [`.gitagent/planner/ORG-POLICY.schema.yaml`](../planner/ORG-POLICY.schema.yaml).
- Each spoke pins a bundle via tracked [`.gitagent/foreman/POLICY.pointer.json`](../../templates/.gitagent/foreman/POLICY.pointer.json): `{schema_version, source:{kind:"git", url, ref}, bundle_path, pinned_commit, bundle_sha256}`.
- The pointer is Planner-owned and **perimeter-protected**. Cache lives under `.gitagent/history/policy/` (gitignored).
- `gantry policy pull` clones the source at `pinned_commit` (or fetches `ref` then pins), verifies the commit against `signers[]`, hashes the bundle, and writes the cache. Verify fails closed on pointer/cache/sha mismatch (`GXT_POLICY_UNPINNED`, `GXT_POLICY_DRIFT`, `GXT_POLICY_SIGNATURE_INVALID`).

### Tighten-only merge

Effective policy is `merge(local, bundle)` where:

- sets (`mandatory_gates`, `banned_imports`, `forbidden_zones_add`, `perimeter_protected_add`) are **unioned**;
- risk tiers take the **maximum**;
- signature / telemetry / ledger tiers take the **stricter** of `{off, warn, require}` and `{hash_only, full}` (`hash_only` is stricter).

The bundle is a **floor**. It MUST NOT loosen local law. A local `receipt_signature: require` stays `require` even if the bundle says `warn`.

### Schema fields

- `mandatory_gates[]` — extra gates after the mission gate; adapters are explicit (`generic|eslint|tsc`).
- `banned_imports[]` — `{specifier, scope: changed|all}` (default `changed`); compiled to `gantry check-imports`.
- `producers` — map of KPI metric name → producer command. `kpi_thresholds[].metric` MUST name a key in `producers` (schema/CLI error otherwise).
- `config_floor` — `planner_signature`, `receipt_signature`, `ledger_signature`, `flight_telemetry.body_mode`, optional `break_glass.require_ledger_entry`.
- `manifest_constraints` — `forbidden_zones_add`, `path_risks_min`, `perimeter_protected_add`.
- `expected_digests` — optional; same shape as `ExpectedDigestsFile` (`0.1.0`).

Receipt schema stays **0.2.0**. Policy digests belong in [ADR-0043](ADR-0043-compliance-ledger-git-ref.md) ledger entries, not receipts ([ADR-0036](ADR-0036-receipt-v0-2-signed-attribution.md), [ADR-0037](ADR-0037-plane-deployment-and-ci-ingestion-contract.md)).

## Consequences

- CLI implementation is a follow-on `gantry`-skill mission. This record is the law.
- A missing pointer is not a failure (opt-in). A present pointer with a missing or drifted cache **is** a failure.
- Org policy repos (e.g. `jeger-ai/opengantry-policy`) are signed git sources, not a SaaS control plane.
