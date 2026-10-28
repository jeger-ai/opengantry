---
title: "Org control plane"
description: "Git-native organization controls: a tighten-only org policy floor, a digest-only compliance ledger with a SOC 2 export, receipts and cross-repo gates."
section: guides
order: 10
---

# Org control plane

Teams need local developer control and organization-wide auditability without uploading source trees or gate output to a vendor cloud. OpenGantry keeps execution on each repository (the **spoke**) and adds optional, Git-native organization controls. Nothing here needs a hosted hub.

| Layer | Owns | Notes |
|-------|------|-------|
| **Spoke** (each repository) | Missions, scope, cages, shell gates, offline `gantry verify`, doctor, receipt export | The only fail-closed enforcer; no cloud required |
| **Hub** (optional metadata plane) | Cross-repository dashboards, hash-to-human resolution, advisory status checks, PDF, expected-digest distribution | Consumer, aggregator and reporter only; never overrides spoke verify |

## Quick start

```bash
# 1. Pin a signed org policy repository (network). Doctor and verify stay offline afterwards.
gantry policy pull
gantry policy status --json
gantry policy diff

# 2. Enable the compliance ledger in .gitagent/config.yaml:
#    { "ledger": { "mode": "local", "signature": "warn" } }
gantry ledger verify --json
gantry ledger export --format soc2-pack --out .gitagent/history/ledger-export

# 3. Cross-repository gates: fetch the other repositories' refs before verify
gantry deps fetch --mission .gitagent/missions/MSN-0042.yaml
gantry deps check --mission .gitagent/missions/MSN-0042.yaml --json
gantry deps check --since v3.2.6
```

## Org policy floor

`.gitagent/foreman/POLICY.pointer.yaml` points at a signed org policy repository, and `gantry policy pull` caches the bundle under `.gitagent/history/policy/` (gitignored). The bundle is a **tighten-only floor**: sets are unioned, risk tiers take the maximum, and signature and telemetry tiers take the stricter value. It can never loosen local rules.

- `gantry policy pull` is the only network path. `gantry doctor` and `gantry verify` read the pointer and the cache only.
- A missing pointer means no org policy. A present pointer with a missing cache, a hash mismatch or an invalid signer fails closed (`GXT_POLICY_*`).
- Do not commit a filled `POLICY.pointer.yaml` until `gantry policy pull` has populated the cache.
- MCP: `gxt_policy_status` reads the effective policy without fetching.

## Compliance ledger

With `ledger.mode: local` in `.gitagent/config.yaml`, verify, attest, break-glass and policy pull append a digest-only entry to `refs/gxt/ledger`. Git parent links plus an embedded `prev_entry_hash` form the hash chain.

- Appends use compare-and-swap with bounded retries, so parallel CI jobs never fork the chain; running out of retries fails closed (`GXT_LEDGER_CAS_EXHAUSTED`).
- Unsigned entries are checksums, not proofs. `ledger.signature: require` demands signed commits.
- Entries never contain source or gate output.
- A break-glass bypass without a `break_glass` ledger row is a failed control.

`gantry ledger export --format soc2-pack` writes a directory with the chain JSON, the referenced local receipts, and a control mapping:

| Framework | Control | Ledger evidence |
|-----------|---------|-----------------|
| ISO 27001 A.5.3 | Segregation of duties | Planner stamp, mission YAML, verify entry |
| ISO 27001 A.8.15 | Logging and monitoring | `refs/gxt/ledger` entries and `EXECUTOR_LOG.md` quotes |
| ISO 27001 A.8.28 | Secure development | Scope and the policy floor (`mandatory_gates`, `banned_imports`) |
| ISO 42001 | AI boundaries and accountability | Mission `depends_on` and the interrogation record |
| SOC 2 CC7 | System operations and monitoring | Ledger chain verify and doctor ledger health |
| SOC 2 CC8 | Change management | Planner commit check and verify `receipt` or `verify_findings` entries |

## Cross-repository dependencies

A mission can declare `depends_on[]`: missions in other repositories of the same organization that must be verified first. `gantry deps fetch` is the only network path; verify's `dependencies` phase, `gantry deps check` and doctor read the fetched `refs/gxt/deps/<slug>` refs offline.

Same-org proof recomputes `repository_hash` for the dependency with your `GANTRY_ORG_PEPPER` and requires it to match; a mismatch is `GXT_DEPENDENCY_ORG_MISMATCH`. Unfetched, unsatisfied, unsigned (when required) or stale entries fail closed (`GXT_DEPENDENCY_*`). `gantry deps check --since <tag>` holds a release until its dependencies are verified. Triggering other repositories' workflows is convenience glue, not enforcement. MCP: `gxt_deps_check`.

## Receipts and telemetry

| Capability | Command or config | Notes |
|------------|-------------------|-------|
| Attestation receipts | `gantry attest`, `gantry verify --receipt` | Digest-only JSON under `.gitagent/history/receipts/` (gitignored); verify prints `wrote <path>` |
| Signed receipts | `receipt_signature` tier, `--sign` or `--sign-receipt` | SSH or GPG detached signature over `receipt_sha256`; an unsigned receipt is a checksum, not a proof |
| Inspect receipts | `gantry receipt list`, `gantry receipt show [MSN\|path]` | Read-only local view |
| Hash-only telemetry | `flight_telemetry.body_mode` in `.gitagent/config.yaml` (default `hash_only`) | Gate stream events keep `chunk_sha256` and `bytes`; `chunk_b64` only with `full` |
| Policy digest drift | `gantry doctor --policy <expected-digests.json>` | Offline comparison of manifest, architecture and config digests |
| Hub export | CI artifact or pull request attachment ([CI exporters and receipts](ci.md#receipt-export-to-a-control-plane)) | Spoke-owned; not a tracked receipt tree |

Source trees, gate output bodies, credentials, draft-token keys and bypass secrets are never exported ([Security policy](../SECURITY.md#hybrid-hub-and-spoke-boundary)).

Design notes: [ADR-0034 hub and spoke](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0034-hybrid-hub-spoke-metadata-plane.md), [ADR-0042 org policy](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0042-org-policy-bundle.md), [ADR-0043 ledger](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0043-compliance-ledger-git-ref.md), [ADR-0044 cross-repo dependencies](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0044-cross-repo-mission-dependencies.md).
