---
title: "Org control plane"
description: "Git-native organization controls: a tighten-only org policy floor, a digest-only compliance ledger with a SOC 2 export, run record export and cross-repo gates."
section: guides
order: 10
---

# Org control plane

Teams need local developer control and organization-wide auditability without uploading source trees or gate output to a vendor cloud. OpenGantry keeps execution on each repository (the **spoke**) and adds optional, Git-native organization controls. Nothing here needs a hosted hub.

| Layer | Owns | Notes |
|-------|------|-------|
| **Spoke** (each repository) | Missions, scope, cages, shell gates, offline `gantry verify`, doctor, run record export | The only fail-closed enforcer; no cloud required |
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

## Compliance ledger

With `ledger.mode: local` in `.gitagent/config.yaml`, verify, break-glass and policy pull append a digest-only entry to `refs/gxt/ledger`. Git parent links plus an embedded `prev_entry_hash` form the hash chain. A passing verify appends a `receipt` entry `{verify_status: passed, run_record_sha256}`; the digest is the sha256 of the canonical run record and is present when the mission has one. Entries carry no org id or repository hash, so appending needs no org configuration. Dependency checks are not appended; their results are in the verify output. Entries written before 4.0 keep their org fields and older payloads and still verify.

- Appends use compare-and-swap with bounded retries, so parallel CI jobs never fork the chain; running out of retries fails closed (`GXT_LEDGER_CAS_EXHAUSTED`).
- Unsigned entries are checksums, not proofs. `ledger.signature: require` demands signed commits.
- Entries never contain source or gate output.
- A break-glass bypass without a `break_glass` ledger row is a failed control.

`gantry ledger export --format soc2-pack` writes a directory with the chain JSON, the committed run records (`.gitagent/runs/*.json`), and a control mapping:

| Framework | Control | Ledger evidence |
|-----------|---------|-----------------|
| ISO 27001 A.5.3 | Segregation of duties | Planner stamp, mission YAML, verify entry |
| ISO 27001 A.8.15 | Logging and monitoring | `refs/gxt/ledger` entries and `EXECUTOR_LOG.md` quotes |
| ISO 27001 A.8.28 | Secure development | Scope and the policy floor (`mandatory_gates`, `banned_imports`) |
| ISO 42001 | AI boundaries and accountability | Mission `depends_on` and the interrogation record |
| SOC 2 CC7 | System operations and monitoring | Ledger chain verify and doctor ledger health |
| SOC 2 CC8 | Change management | Planner commit check, run records, and verify `receipt` or `verify_findings` entries |

## Cross-repository dependencies

A mission can declare `depends_on[]`: missions in other repositories of the same organization that must be verified first. `gantry deps fetch` is the only network path; verify's `dependencies` phase, `gantry deps check` and doctor read the fetched `refs/gxt/deps/<slug>` refs offline.

Same-org proof is the ability to fetch the dependency's ledger ref; that shows read access to the ref, not organization membership or authorization, so pair it with `require.signed` when the producer's identity matters. `require.signed: true` means the receipt entry's commit carries a good signature from a key you trust (`git log --format=%G?` is `G`; an untrusted or expired key fails) (configure `gpg.ssh.allowedSignersFile` or your GPG keyring for the producer's signers); unsigned or unverifiable is `GXT_DEPENDENCY_UNSIGNED`. Unfetched, unsatisfied, unsigned (when required) or stale entries fail closed (`GXT_DEPENDENCY_*`). `gantry deps check --since <tag>` holds a release until its dependencies are verified. Triggering other repositories' workflows is convenience glue, not enforcement. MCP: `gxt_deps_check`.

## Run records and telemetry

| Capability | Command or config | Notes |
|------------|-------------------|-------|
| Run record | `gantry verify --record`, then commit `.gitagent/runs/<MSN>.json` | The only receipt: the commit and tree the checks ran on, the gate's exit and output digest, the law digest. Inspect it in Git, and its ledger entries with `gantry ledger list` |
| Hash-only telemetry | `flight_telemetry.body_mode` in `.gitagent/config.yaml` (default `hash_only`) | Gate stream events keep `chunk_sha256` and `bytes`; `chunk_b64` only with `full` |
| Policy digest drift | `gantry doctor --policy <expected-digests.json>` | Offline comparison of manifest, architecture and config digests |
| Hub export | `gantry verify --export <file>` (with `--sign`: signed), as a CI artifact or ingest ([CI exporters and run record export](ci.md#run-record-export-to-a-control-plane)) | Envelope 2.0 over the canonical run record; a failed verify writes none |

Source trees, gate output bodies, credentials, draft-token keys and bypass secrets are never exported ([Security policy](../SECURITY.md#hybrid-hub-and-spoke-boundary)).

Design notes: [ADR-0034 hub and spoke](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0034-hybrid-hub-spoke-metadata-plane.md), [ADR-0042 org policy](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0042-org-policy-bundle.md), [ADR-0043 ledger](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0043-compliance-ledger-git-ref.md), [ADR-0044 cross-repo dependencies](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0044-cross-repo-mission-dependencies.md), [ADR-0061 one record](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0061-simplify-before-4-0.md).
