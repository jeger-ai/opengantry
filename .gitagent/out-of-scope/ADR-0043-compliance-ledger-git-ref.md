---
id: ADR-0043
title: Tamper-evident compliance ledger on refs/gxt/ledger
status: ACTIVE
match_terms:
  - ledger
  - refs/gxt/ledger
  - compliance ledger
  - soc2-pack
  - GXT-LEDGER
  - ledger_append
---

## Context

Receipts v0.2.0 ([ADR-0036](ADR-0036-receipt-v0-2-signed-attribution.md)) are gitignored checksums with optional SSH/GPG signatures. The Hub hash-chain ([ADR-0037](ADR-0037-plane-deployment-and-ci-ingestion-contract.md)) is optional and network-dependent. Enterprise adopters need a **spoke-local, distributable, tamper-evident** chain that CI can push and dependents can fetch without mutating the receipt schema (plane must accept schema changes first).

[ADR-0021](ADR-0021-break-glass-protocol.md) already uses a dedicated git ref (`refs/notes/gxt-bypass`) for forensic records. A second dedicated ref is the same pattern.

## Decision

### Orphan commit chain

- The ledger is `refs/gxt/ledger`: an orphan commit chain. Each commit tree contains `entry.json` (canonical JSON).
- Git parent linkage **is** the hash chain. `prev_entry_hash` is also embedded in `entry.json` so a rewritten ref is detectable without trusting the parent pointer alone.
- Commit subject: `[GXT-LEDGER] <entry_kind> <msn_id>`.
- Signing: `git commit -S` when `.gitagent/config.json` `ledger.signature` is `warn|require` (same `off|warn|require` enum as `receipt_signature`). Unsigned entries are checksums, not proofs ([ADR-0034](ADR-0034-hybrid-hub-spoke-metadata-plane.md) wording).

### Entry schema `1.0.0`

Required fields: `schema_version`, `entry_kind`, `org_id`, `repository_hash`, `msn_id`, `git_head`, `payload_sha256`, `payload`, `prev_entry_hash`, `issued_at`.

`entry_kind`: `receipt | verify_findings | break_glass | policy_pin | dependency_check`.

`payload` is digest-only:

- `receipt` — receipt body fields already allowed on the export path (no source, no gate stdout);
- `verify_findings` — `{failed_gate, findings_digest, fingerprints[]}`;
- `break_glass` — `{reason_sha256, error_code}`;
- `policy_pin` — `{policy_id, bundle_sha256, pinned_commit}`;
- `dependency_check` — `{repo, msn_id, require, result}`.

Receipt schema stays **0.2.0**. Policy and findings digests live here, not on the ingest envelope.

### CAS append (hard requirement)

`gantry ledger append` MUST:

1. Read tip of `refs/gxt/ledger` (empty = zeros for `prev_entry_hash`).
2. Build `entry.json` + commit-tree with that parent.
3. `git update-ref refs/gxt/ledger <new> <expected-old>`.
4. On rejection: re-read tip, re-chain `prev_entry_hash`, retry with **bounded attempts and jitter**.
5. Exhaustion → fail closed (`GXT_LEDGER_CAS_EXHAUSTED`). Parallel CI matrix jobs MUST NOT fork the chain.

Every git spawn takes an explicit repo `cwd`. Helpers MUST NOT resolve the developer's real `refs/gxt/ledger`.

### Append hooks and config

`.gitagent/config.json`:

```json
"ledger": { "mode": "off" | "local", "signature": "off" | "warn" | "require" }
```

Default `mode: off` (existing adopters unchanged). `strict_enterprise` preset turns `mode: local` on.

When `mode: local`, append after: `gantry verify` (pass or fail), `gantry attest`, break-glass audit path ([ADR-0021](ADR-0021-break-glass-protocol.md) — a bypass with no ledger row is a failed SOC 2 control), and `gantry policy pull` (`policy_pin`).

### Export

`gantry ledger export --format json|soc2-pack` writes the chain plus referenced local receipts and a control-mapping document derived from [`docs/COMPLIANCE-ISO.md`](../../docs/COMPLIANCE-ISO.md) (ISO 27001 A.5.3 / A.8.15 / A.8.28, ISO 42001, SOC 2 CC7 / CC8). Doctor checks tip reachability, last-N chain consistency, and unpushed count — **offline**.

CI template: after envelope export, `gantry ledger append --from-envelope` and `git push origin refs/gxt/ledger`. Ingest order from ADR-0037 is unchanged: verify → export → ingest → fail job if verify failed.

## Consequences

- CLI implementation is a follow-on `gantry`-skill mission.
- Plane ledger import is out of scope (Hub consumes envelopes; this ref is spoke-distributable).
- `gantry ledger push|fetch` are thin wrappers around `git push` / `git fetch` of `refs/gxt/ledger`.
