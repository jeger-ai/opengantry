---
id: ADR-0034
title: Hybrid Hub and Spoke metadata plane
status: ACTIVE
match_terms:
  - hub
  - spoke
  - attestation
  - receipt
  - hash_only
  - metadata plane
  - sole enforcer
  - git-note
---

## Context

OpenGantry is positioned as a local-first execution engine (missions, TMVC, cages, verify). A future optional cloud control plane would provide org-wide governance visibility without hosting execution. Enterprise adopters require that source trees, gate stdout bodies, and credentials never leave the developer machine via GXT export paths.

Missions and docs MUST keep a sharp boundary: the CLI spoke is the only fail-closed enforcer; Hub work MUST NOT land in this repository as SaaS/webhook backend code.

## Decision

- **Local engine is the sole fail-closed enforcer** — CLI, CI, MCP runtime, offline doctor, and `gantry verify` own cages and gates. A Hub MUST NOT override, replace, or soften local verify outcomes.
- **Default flight telemetry is hash-only** — `flight_telemetry.body_mode` defaults to `hash_only`; stream events omit `chunk_b64` and retain `chunk_sha256` + `bytes`.
- **Attestation receipts stay local and gitignored** — `gantry attest` and `gantry verify --receipt` emit schema-stable JSON under `.gitagent/history/receipts/` (git-ignored). Payloads contain digests and outcomes only, never source file bodies. Receipts MUST NOT be the default tracked tree path.
- **Checksum vs proof** — `receipt_sha256` is a deterministic checksum. Optional local SSH/GPG signatures (`receipt_signature` tier) make a receipt an attestation proof; unsigned receipts MUST NOT be described as cryptographic proofs.
- **Export vectors for Hub ingestion (spoke-owned)** — Hub consumes receipts via CI artifacts, PR attachments, or an optional future `gantry attest --git-note` (or equivalent). Export is an opt-in path out of the gitignored history dir; it does not embed proofs into every clone by default.
- **Policy drift via doctor** — `gantry doctor --policy <expected-digests.json>` compares working-tree digests offline; no new `gantry policy` command tree and no HubSink network I/O in doctor.
- **Doctor stays offline** — no network I/O in doctor checks; future hub clients read receipt files from disk or from an explicit export artifact/note.
- **Hub is consumer, aggregator, reporter** — cross-repo dashboards, hash→human policy resolution (Git at `git_head`), status-check / advisory ingestion, PDF exports, expected-digest distribution, and fleet KPI aggregation belong in a **separate** Hub repository. Hub status checks are advisory ingestion signals, not a second enforcement plane.
- **No Hub SaaS in `opengantry`** — webhook receivers, multi-tenant stores, and executive UIs MUST NOT ship in this CLI repo. A thin optional `@jeger-ai/opengantry-hub-client` that uploads already-written receipt files is allowed later without changing local enforcement.

## Consequences

- Developers get privacy-preserving telemetry and exportable metadata hashes without a cloud dependency.
- CISOs get meaning from Hub resolution against Git + org baselines, not from bloating the signed receipt.
- Future missions that blur spoke enforcement with Hub ingestion violate this ADR and MUST be re-scoped.
- Teams using `flight_telemetry.body_mode: full` accept local storage of gate stream bodies in `EXECUTOR_LOG.md`.
