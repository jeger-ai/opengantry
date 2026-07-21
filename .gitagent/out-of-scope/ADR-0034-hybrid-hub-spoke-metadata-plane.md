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
---

## Context

OpenGantry is positioned as a local-first execution engine (missions, TMVC, cages, verify). A future optional cloud control plane would provide org-wide governance visibility without hosting execution. Enterprise adopters require that source trees, gate stdout bodies, and credentials never leave the developer machine via GXT export paths.

## Decision

- **Local engine owns execution** — CLI, CI, MCP runtime, doctor (offline), and verify gates stay on the workstation.
- **Default flight telemetry is hash-only** — `flight_telemetry.body_mode` defaults to `hash_only`; stream events omit `chunk_b64` and retain `chunk_sha256` + `bytes`.
- **Attestation receipts** — `gantry attest` and `gantry verify --receipt` emit schema-stable JSON under `.gitagent/history/receipts/` (git-ignored). Payloads contain digests and outcomes only, never source file bodies.
- **Checksum vs proof** — `receipt_sha256` is a deterministic checksum. Optional local SSH/GPG signatures (`receipt_signature` tier) make a receipt an attestation proof; unsigned receipts MUST NOT be described as cryptographic proofs.
- **Policy drift via doctor** — `gantry doctor --policy <expected-digests.json>` compares working-tree digests offline; no new `gantry policy` command tree and no HubSink abstraction until a hub client exists.
- **Doctor stays offline** — no network I/O in doctor checks; future hub clients read receipt files from disk.

## Consequences

- Developers get privacy-preserving telemetry and exportable metadata hashes without a cloud dependency.
- A future `@jeger-ai/opengantry-hub-client` can ingest receipt files without changing the local enforcement model.
- Teams using `flight_telemetry.body_mode: full` accept local storage of gate stream bodies in `EXECUTOR_LOG.md`.
