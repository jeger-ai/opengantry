---
id: ADR-0036
title: Attestation receipt v0.2.0 signed attribution and hub export
status: ACTIVE
match_terms:
  - receipt
  - attestation
  - v0.2.0
  - signed attribution
  - hub export
  - pepper
  - zero-knowledge
  - control plane
---

## Context

ADR-0034 scoped the Hub as a consumer of hash-only spoke metadata. Receipt schema `0.1.0` signs only `receipt_sha256` (a hex digest), leaving repository attribution, branch, and agent state outside the cryptographic proof. A compromised CI runner can relabel a valid signed receipt onto another repository within the same org. Server-side canonical JSON re-serialization across Go and Node is fragile.

Enterprise control-plane ingestion requires tamper-evident attribution inside the signed payload, raw-byte verification on the Hub, and pseudonymized identity fields (no plaintext developer email or branch names in export paths).

## Decision

- **Receipt schema `0.2.0`** — bumps `schema_version`. Signed payload includes `org_id`, `repository_hash`, `branch_hmac`, `branch_class`, `git_tree_sha`, `pepper_version`, `agent`, and existing digest fields. Drops `mission_rel` and `planner_stamp.subject`. Replaces plaintext emails with HMAC fields.
- **Sign canonical UTF-8 bytes** — SSH/GPG signatures cover the canonical JSON of the receipt body (all fields except `signature`). `signature.payload_encoding` is `canonical_json_utf8`. `receipt_sha256` remains a convenience checksum (SHA-256 of canonical body without `receipt_sha256` and `signature`, same as v0.1.0 rule).
- **Hub export envelope** — `gantry attest --export` writes `{ envelope_schema_version, payload_b64, signature }` where `payload_b64` is the exact signed byte string. The Hub hashes and verifies those bytes without re-serializing.
- **Org export config is out-of-band** — `org_id`, pepper, and `pepper_version` come from `GANTRY_ORG_*` env vars or gitignored `.gitagent/foreman/ORG.export.local`. They MUST NOT live in `.gitagent/config.json` (digested into receipts).
- **Branch privacy** — branch names are HMAC'd; `branch_class` (`default` | `non_default`) preserves coverage metrics without leaking proprietary nouns.
- **Amends ADR-0034** — export vector is `--export` detached envelope (not only pretty-printed receipt files). Hub verifies signed attribution; spoke remains sole fail-closed enforcer.

## Consequences

- Control Plane M1 can verify signatures over raw bytes with no Go/Node canonicalization interop.
- Receipts are org-scoped (pepper + `org_id` required for v0.2.0).
- Per-rule PASS/FAIL and AST node hashes remain deferred to schema `0.3.0` (M2 drift telemetry).
- v0.1.0 receipts remain readable locally; new attestations emit v0.2.0 only.
