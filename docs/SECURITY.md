---
title: "Security policy"
description: "Supported versions, what counts as a vulnerability, how to report one privately, and how OpenGantry keeps records and human oversight."
section: reference
order: 7
---

# Security Policy

OpenGantry ships the **gantry** CLI and the **GXT substrate** (law, Foreman manifest, hooks, and integration templates). Security fixes are published from this repository and delivered through semver **gantry** releases; adopters apply substrate updates with `gantry upgrade` after updating their gantry dependency.

## Supported versions

Security fixes are provided **only for the latest release in the 4.x line** (current patch included). Older lines do not receive backports unless noted in a GitHub Security Advisory.

| Component | Supported | Unsupported |
|-----------|-----------|-------------|
| **gantry CLI** (`@jeger-ai/opengantry`, `package.json` version) | **4.x** (latest patch) | **3.x** and earlier |
| **Bundled substrate** (`opengantry_version` in `.gitagent/foreman/SUBSTRATE.version.json`, matching the gantry you installed) | Same as the **supported gantry** you run | Substrate older than the version bundled in your installed gantry (upgrade the package, then `gantry upgrade`) |
| **GXT law schema** (`MANIFEST.yaml` → `schema_version`) | **0.5.0** (current) | Earlier schema versions (migrate via supported gantry + `gantry upgrade`) |
| **Node.js runtime** (see `package.json` `engines`) | **24.x** and newer within `>=24` | Node 22 and below |

Check your installed versions:

```bash
node -v
gantry --version                    # or: node dist/cli/index.js --version
cat .gitagent/foreman/SUBSTRATE.version.json   # after gantry init / upgrade
```

## What we treat as in scope

- Vulnerabilities in **gantry** (CLI, MCP server, draft tokens, upgrade staging, git-proof, hooks helpers).
- Vulnerabilities in **default substrate assets** shipped under `templates/` and applied by `gantry init` / `gantry upgrade` (e.g. hooks, governance paths, bundled workflows).
- Issues that let an unapproved party bypass **Planner git-proof**, mission legislation, or deterministic verify gates **without** the repo owner's Git credentials and configured allowlist.

## Out of scope

- Security of **application code** in repositories that ran `gantry init` (your product, dependencies, and deployment are your responsibility).
- Misconfiguration (empty Planner allowlist, disabled hooks, committed secrets) unless gantry documents unsafe defaults.
- IDE or agent products themselves; integration recipes point to upstream docs ([Wire any agent](guides/agents.md)).

## Reporting a vulnerability

**Please do not open public GitHub issues for undisclosed security problems.**

1. Use **[GitHub Private Vulnerability Reporting](https://github.com/jeger-ai/opengantry/security/advisories/new)** for this repository (preferred).
2. If reporting is unavailable, email the maintainers via the contact on the [GitHub organization profile](https://github.com/jeger-ai) and reference **OpenGantry / gantry**.

Include: affected component and version, reproduction steps, impact, and any suggested fix.

We aim to acknowledge reports within **5 business days** and to coordinate disclosure after a fix is available (typically via a GitHub Security Advisory and a patched **3.x** release).

## Upgrading for security fixes

1. Update gantry to the latest **3.x** (e.g. `npm install @jeger-ai/opengantry@latest` or rebuild from an updated clone of this repo).
2. Preview with `gantry upgrade plan`, stage the upgrade and review `.gitagent/.upgrade-tmp/`, Planner-commit the upgrade mission, then run `gantry upgrade apply --mission …` ([Install § Upgrade the substrate](start/install.md#upgrade-the-substrate)).
3. Run `gantry doctor` and your usual `gantry verify` / CI checks.

## Hybrid hub and spoke boundary

OpenGantry separates **local execution** (CLI, cages, verify) from an optional future **metadata control plane**:

- **Sole enforcer:** `gantry verify` on the spoke is fail-closed. Hub never overrides local outcomes.
- **Default:** `flight_telemetry.body_mode` is `hash_only` — gate stream bodies are not written to `EXECUTOR_LOG.md` (`chunk_b64` omitted). Events keep `chunk_sha256` + `bytes` so you can prove what ran without storing raw stdout.
- **Run record:** the committed `.gitagent/runs/<MSN>.json` (written by `gantry verify --record`) is the only receipt: digests of the gate output and the enforced law, bound to a commit and tree. The ledger's `receipt` entries name it by `run_record_sha256`.
- **Export for Hub:** `gantry verify --export` writes envelope 2.0 over the canonical run record, after a pass only; `--sign` adds an SSH/GPG signature over those bytes.
- **Policy drift:** `gantry policy diff` compares the org bundle's `expected_digests` with the working tree offline and fails with `GXT_POLICY_DRIFT` on a mismatch.
- **Hub role:** consumer / aggregator / reporter (dashboards, hash→human resolve, advisory status checks, PDF). SaaS/webhook backends belong in a separate Hub repo, not this CLI.
- **Never via GXT export:** source trees, gate stdout bodies, credentials, draft-token keys, or bypass secrets.


## Automatic record-keeping and human oversight

OpenGantry does **not** certify legal compliance. It produces Git-native artifacts for **automatic record-keeping** and **human oversight** of agent work. Teams still need counsel for their own obligations.

### Automatic record-keeping

| Artifact | What it records | What it deliberately omits |
|----------|-----------------|----------------------------|
| Mission YAML + `[MSN-XXXX]` commits | Declared scope, gate command, Planner legislation | Application secrets; free-form chat transcripts |
| `EXECUTOR_LOG.md` quotes | Verbatim gate/trace evidence verifiers must cite | By default, full gate stream bodies (`hash_only`) |
| Hash-only flight telemetry | `chunk_sha256` + byte counts for gate streams | Raw prompt corpora, file bodies, `chunk_b64` stdout |
| Run records | Mission identity, head and tree, gate exit and output digest, law digest | Source trees, gate output |

### Cryptographic attestation

| Mode | Meaning |
|------|---------|
| **Run record** | Committed digests of what ran on which tree; its integrity rests on Git history and review, not a signature |
| **Signed export envelope** (`gantry verify --export … --sign`) | SSH/GPG detach-sign over the canonical run record — proof that this key exported that record |

### Human oversight cages

Oversight is structural, not a chat approval checkbox:

| Control | Role |
|---------|------|
| **Planner legislation** | A human (allowlisted email) commits mission YAML before execution |
| **SOD** | Planner ≠ Executor ≠ Verifier |
| **TMVC + forbidden zones + hooks** | Agents cannot silently edit substrate or leave declared roots |
| **`gantry verify`** | Deterministic fail-closed gate + trace mapping before merge |
| **`gantry policy diff`** | Offline digest drift check of the org bundle's `expected_digests` against MANIFEST / architecture / config |

Start the mission graph now so the trail already exists when someone asks for evidence.

## OpenGantry vs a standalone security proxy

Keep the roles distinct — defense in depth, not product overlap:

| Layer | Owns | Does not own |
|-------|------|--------------|
| **OpenGantry (this project)** | Deterministic routing of work (missions, TMVC, forbidden zones), architecture cage (`TARGET_ARCHITECTURE.yaml` / perimeter), shell gates, forensic verify, run records | Runtime sandboxing of MCP tool binaries, skill-pack hash quarantine at invoke time, network egress firewalls for tool calls |
| **Execution firewall / skill sandbox (complement)** | Process isolation for untrusted tools, hash-pinning of MCP/skill payloads, tool-poisoning defenses | Mission legislation, Git-native architectural logging, Planner git-proof |

Use OpenGantry when you need **declared edit blast radius and citeable verify evidence**. Pair it with a standalone sandbox/hash-check proxy when the threat model is **tool poisoning or untrusted MCP execution**. They compose; neither replaces the other.

## Break-glass (emergency verify bypass)

When a production hotfix cannot wait for full git-proof + trace mapping:

1. Provision `.gitagent/foreman/BYPASS.sha256` (SHA-256 of team secret; never commit plaintext).
2. Set `GANTRY_BYPASS_SECRET` in the execution environment.
3. Run `gantry verify --break-glass --reason "<incident description>" --mission <path>` (optional `--audit-commit` if git notes cannot be pushed).
4. Push notes with the branch: `git push origin refs/notes/gxt-bypass`.
5. Planner reviews bypass usage post-incident ([Break-glass](reference/break-glass.md)).

**Routine bot autofixes** (GitHub code scanning, Snyk, Dependabot source fixes) are **not** break-glass cases — configure [`trusted_automation`](concepts/enforcement-boundary.md#trusted-automation) in `.gitagent/config.yaml` instead (`dependency_update`, `bounded_content` or `workflow_version_pin`).

## Acknowledgments

We credit reporters who agree to be named when we publish advisories.

Design notes: [ADR-0021 break-glass protocol](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0021-break-glass-protocol.md), [ADR-0034 hub and spoke](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0034-hybrid-hub-spoke-metadata-plane.md), [ADR-0061 one record](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0061-simplify-before-4-0.md).
