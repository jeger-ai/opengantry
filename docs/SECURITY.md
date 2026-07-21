# Security Policy

OpenGantry ships the **gantry** CLI and the **GXT substrate** (law, Foreman manifest, hooks, and integration templates). Security fixes are published from this repository and delivered through semver **gantry** releases; adopters apply substrate updates with `gantry upgrade` after updating their gantry dependency.

> **Deprecated alias:** the `gapman` npm bin still invokes the same CLI for one release cycle; prefer `gantry` in scripts and docs.

## Supported versions

Security fixes are provided **only for the latest release in the 3.x line** (current patch included). Older lines do not receive backports unless noted in a GitHub Security Advisory.

| Component | Supported | Unsupported |
|-----------|-----------|-------------|
| **gantry CLI** (`@jeger-ai/opengantry`, `package.json` version) | **3.x** (latest patch) | **2.x** and earlier |
| **Bundled substrate** (`opengantry_version` in `.gitagent/foreman/SUBSTRATE.version.json`, matching the gantry you installed) | Same as the **supported gantry** you run | Substrate older than the version bundled in your installed gantry (upgrade the package, then `gantry upgrade`) |
| **GXT law schema** (`MANIFEST.json` → `schema_version`) | **0.5.0** (current) | Earlier schema versions (migrate via supported gantry + `gantry upgrade`) |
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
- IDE or agent products themselves; integration recipes point to upstream docs ([`INTEGRATIONS.md`](INTEGRATIONS.md)).

## Reporting a vulnerability

**Please do not open public GitHub issues for undisclosed security problems.**

1. Use **[GitHub Private Vulnerability Reporting](https://github.com/jeger-ai/opengantry/security/advisories/new)** for this repository (preferred).
2. If reporting is unavailable, email the maintainers via the contact on the [GitHub organization profile](https://github.com/jeger-ai) and reference **OpenGantry / gantry**.

Include: affected component and version, reproduction steps, impact, and any suggested fix.

We aim to acknowledge reports within **5 business days** and to coordinate disclosure after a fix is available (typically via a GitHub Security Advisory and a patched **3.x** release).

## Upgrading for security fixes

1. Update gantry to the latest **3.x** (e.g. `npm install @jeger-ai/opengantry@latest` or rebuild from an updated clone of this repo).
2. Run `gantry upgrade plan`, review `.gitagent/.upgrade-tmp/`, Planner-commit the upgrade mission, then `gantry upgrade apply --mission …`.
3. Run `gantry doctor` and your usual `gantry verify` / CI checks.

## Hybrid hub and spoke boundary

OpenGantry separates **local execution** (CLI, cages, verify) from an optional future **metadata control plane**:

- **Default:** `flight_telemetry.body_mode` is `hash_only` — gate stream bodies are not written to `EXECUTOR_LOG.md` (`chunk_b64` omitted).
- **Receipts:** `gantry attest` / `gantry verify --receipt` write digest-only JSON under `.gitagent/history/receipts/` (git-ignored). Unsigned `receipt_sha256` is a checksum; SSH/GPG signatures (`receipt_signature` tier) make a receipt an attestation proof.
- **Policy drift:** `gantry doctor --policy <expected-digests.json>` compares working-tree digests offline — no network I/O in doctor.
- **Never via GXT export:** source trees, gate stdout bodies, credentials, draft-token keys, or bypass secrets.

See [ADR-0034](../.gitagent/out-of-scope/ADR-0034-hybrid-hub-spoke-metadata-plane.md).

## EU AI Act Articles 12 and 14 (capability mapping)

OpenGantry does **not** certify legal compliance. It produces Git-native artifacts that map cleanly onto common high-risk expectations around **automatic event logging** and **human oversight records**. Teams still need counsel for their own classification and residual obligations.

| Obligation theme | What OpenGantry produces | How |
|------------------|--------------------------|-----|
| **Art. 12 — logging / record-keeping** | Mission YAML, `[MSN-XXXX]` commits, verbatim `EXECUTOR_LOG.md` quotes, optional attestation receipts | Continuous architectural logging in Git; digests of MANIFEST / architecture / config; `gantry attest` / `gantry verify --receipt` |
| **Art. 14 — human oversight** | Planner legislation stamp, SOD (Planner ≠ Executor ≠ Verifier), signed receipt proofs | Humans legislate before execution; `gantry attest --sign` (or `receipt_signature` warn/require) attaches local SSH/GPG proof over `receipt_sha256` |

Signed receipts (`gantry attest --sign`) turn a digest checksum into a **local attestation proof** of verify outcome, mission identity, and policy digests — without uploading source. Unsigned receipts remain checksums only.

Start the mission loop now so the log already exists when someone asks for evidence.

## OpenGantry vs a standalone security proxy

Keep the roles distinct:

| Layer | Owns | Does not own |
|-------|------|--------------|
| **OpenGantry (this project)** | Deterministic DAG routing of work (missions, TMVC, forbidden zones), architecture cage (`TARGET_ARCHITECTURE.yaml` / perimeter), shell gates, forensic verify, attestation receipts | Runtime sandboxing of MCP tool binaries, skill-pack hash quarantine at invoke time, network egress firewalls for tool calls |
| **Execution firewall / skill sandbox (complement)** | Process isolation for untrusted tools, hash-pinning of MCP/skill payloads, tool-poisoning defenses | Mission legislation, Git-native architectural logging, Planner git-proof |

Use OpenGantry when you need **declared edit blast radius and citeable verify evidence**. Pair it with a standalone sandbox/hash-check proxy when the threat model is **tool poisoning or untrusted MCP execution**. They compose; neither replaces the other.

## Break-glass (emergency verify bypass)

When a production hotfix cannot wait for full git-proof + trace mapping:

1. Provision `.gitagent/foreman/BYPASS.sha256` (SHA-256 of team secret; never commit plaintext).
2. Set `GXT_BYPASS_SECRET` in the execution environment.
3. Run `gantry verify --break-glass --reason "<incident description>" --mission <path>` (optional `--audit-commit` if git notes cannot be pushed).
4. Push notes with the branch: `git push origin refs/notes/gxt-bypass`.
5. Planner reviews bypass usage post-incident (RULES.md §6.2, ADR-0021).

**Routine bot autofixes** (GitHub code scanning, Snyk, Dependabot source fixes) are **not** break-glass cases — configure [`trusted_automation`](ADOPTION.md) in `.gitagent/config.json` instead (`bounded_content` or `workflow_version_pin`).

See [`ADOPTION.md`](ADOPTION.md).

## Acknowledgments

We credit reporters who agree to be named when we publish advisories.
