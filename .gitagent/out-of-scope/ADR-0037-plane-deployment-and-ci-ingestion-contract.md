---
id: ADR-0037
title: Plane deployment and CI ingestion contract
status: ACTIVE
match_terms:
  - plane
  - ingest
  - control plane
  - CI
  - github actions
  - pepper
  - signer_principal_kind
  - migration
  - break-glass
---

## Context

ADR-0034 and ADR-0036 defined the spoke export envelope and receipt v0.2.0 signed attribution. M1 requires proving the hash-chain ingestion loop with real CI receipts before M2 dashboard work. Three operational gaps block that proof:

1. No command path emits an ingestible envelope with `verify_status: passed|failed` from CI.
2. CI attribution degrades (detached HEAD, HTTPS vs SSH remote URLs, absent git identity) unless inputs are normalized and typed.
3. Plane deployment must not race schema migrations across rolling replicas.

Enterprise CISOs require customer-held pepper (zero-knowledge pseudonyms) and auditable records for bypassed gates.

## Decision

### Pepper custody (permanent)

- The **customer holds the pepper**. The control plane stores only HMACs (`signer_principal_hmac`, `repository_hash`, `branch_hmac`, `planner_stamp.author_email_hmac`).
- The plane **never** receives `GANTRY_ORG_PEPPER` or plaintext email/branch names.
- Audit queries use `WHERE signer_principal_hmac IN (...)` with HMACs computed client-side (dashboard SPA or local CLI) from the customer's pepper.

### Ingest wire contract

- **Endpoint:** `POST /api/v1/attestations/ingest`
- **Auth:** `Authorization: Bearer <plaintext-token>` (64-char hex; stored server-side as SHA-256 hash only).
- **Envelope:** `envelope_schema_version: "1.0.0"`, `payload_b64` (base64 of receipt JSON bytes), optional `signature`.
- **Receipt:** `schema_version: "0.2.0"`; max body 96 KiB, payload 64 KiB.
- **Success:** HTTP `202` with `{ status: "accepted"|"duplicate", ledger_seq, entry_hash, signature_verdict }`.
- **Errors:** `401` invalid token; `403` `org_id` mismatch between token and receipt payload; `400` validation/signature failure.
- **`verify_status` on the wire:** `passed` | `failed` only. `attest_only` is local-only and **never** ingested.
- **M1 signatures:** unsigned envelopes accepted (`signature_verdict: "unsigned"`). Signed CI receipts require `planectl key-enroll` and are deferred.

### Typed signer principal (schema change)

Git committer metadata is **never** an attribution source (unverified client input; often privacy-masked).

| Context | `signer_principal_kind` | Principal string (HMAC input) |
|---------|-------------------------|-------------------------------|
| Local CLI | `email` | `git config user.email` (trimmed, lowercased) |
| GitHub Actions CI | `github_actor` | `github:<user_id>:<login>` from `github.event.pull_request.user.id` / `.login` |

- New receipt field: `signer_principal_kind: "email" | "github_actor" | null` (null when `signer_principal_hmac` is absent).
- Env overrides: `GANTRY_SIGNER_PRINCIPAL`, `GANTRY_SIGNER_PRINCIPAL_KIND`.
- **Do not** use `github.actor` for authorship (run trigger ≠ PR author). **Do not** use `git log` committer email.
- Audit queries must hash candidates in the correct namespace per `signer_principal_kind`.

### Deterministic attribution inputs

- **Repository:** canonical `host/owner/repo` (strip scheme, normalize `git@host:` → `host/`, drop `.git`, lowercase). Override: `GANTRY_REPO_ID`.
- **Branch:** `GANTRY_BRANCH_NAME` when HEAD is detached (PR CI).
- **Agent:** `harness_mode: ci` when `CI=true`.

### Break-glass ingestibility

- `--break-glass` verify runs **must** still emit export envelopes when `--export` is requested.
- Bypass reason is recorded in receipt `error_code`. A bypassed gate with no ledger row is a failed SOC 2 control.

### Migration is deploy-time, not boot-time

- `ingestd` **never** runs schema migrations on startup.
- Migrations run as a one-shot `planectl migrate` (init container, compose `service_completed_successfully`, or release phase).
- `planectl migrate` uses `pg_advisory_lock` to serialize concurrent invocations.
- Migrations are embedded in the binary (`go:embed`); a `schema_migrations` table tracks applied versions.

### Spoke export path

- `gantry verify --export <file>` emits the hub envelope after verify phases complete (pass or fail).
- CI workflow: verify with `continue-on-error`, ingest envelope, then fail job if verify failed.

## Consequences

- MSN-0144 (plane) must accept `signer_principal_kind` before MSN-0145 (spoke) emits it.
- Go-only plane repo pays the Node substrate tax for `gantry verify` mission gates in CI.
- M2 dashboard principal lookup must branch on `signer_principal_kind`.
- Amends ADR-0036 (adds `signer_principal_kind`; CI identity rules).
