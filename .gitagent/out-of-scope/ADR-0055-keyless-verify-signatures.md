---
id: ADR-0055
title: Keyless verify signatures — Sigstore as an opt-in network path in verify
status: ACTIVE
match_terms:
  - sigstore
  - keyless
  - signature
  - sign
  - oidc
  - transparency log
  - network
---

# ADR-0055: Keyless verify signatures — Sigstore as an opt-in network path in verify

## Context

ADR-0051 decision 12 signs a standalone verify result with the key git signs commits with (`--sign`) and checks it against an `ssh-keygen` allowed-signers file (`--check-result --allowed-signers`). That needs a long-lived key on the machine that runs verify. In CI the job usually has none, and distributing one to every runner is the key-management problem keyless signing exists to remove. ADR-0051 listed Sigstore keyless signing as a follow-up.

ADR-0052 lists as a non-goal any network call in `core`, `git`, `cage`, `verify` or `missions`. Keyless signing cannot meet that: a Sigstore signature needs a certificate from Fulcio for the job's OIDC identity and an entry in the Rekor transparency log, and checking one needs the Sigstore trust root (TUF). The operator decided on 2026-10-21 that keyless signing ships in v4.0.0 as an explicit opt-in ("Optional, opt-in").

## Decision

1. **`--sign keyless`** (with `--contract` and `--out`) signs the result with Sigstore. The payload is the one `--sign` signs: the canonical JSON of the result without its `signature` field (`canonical_json_utf8`). The result's `signature` is `{ kind: "sigstore", payload_encoding: "canonical_json_utf8", bundle }`, the bundle holding the certificate, the signature and the transparency-log entry. `--sign` without a value keeps the git signing key.
2. **Identity is ambient, never interactive.** The OIDC token comes from `SIGSTORE_ID_TOKEN` or from a GitHub Actions job with `permissions: id-token: write`. Without either, verify stops with `GXT_VERIFY_SIGN_NO_IDENTITY` (exit 2) before any network call; a failure from Fulcio or Rekor is `GXT_VERIFY_SIGN_FAILED` (exit 2). Nothing is written in either case. No browser flow: verify runs unattended.
3. **`--check-result --certificate-identity <regexp>`** requires a keyless signature whose certificate identity (a workflow URI such as `^https://github\.com/org/repo/\.github/workflows/`, or an email address) matches, issued by `--certificate-oidc-issuer` (default `https://token.actions.githubusercontent.com`), with a transparency-log entry. The signer's identity is printed. `--allowed-signers` and `--certificate-identity` are exclusive: a result carries one signature, and each check reports the other kind as a problem.
4. **The network exception is this one path.** ADR-0052's non-goal stands for every default run and for every other command: verify loads the `sigstore` package lazily, only when a keyless signature is made or checked. The package is a runtime dependency of the CLI (registered in `.gitagent/registry/dependencies.yaml`); the slim verify package carries it the same way.
5. **The default stays offline.** A result signed keyless is still checked offline for everything except its signature: HEAD, base, contract digest, mode and a clean tree, as ADR-0051 says.

## Consequences

- A CI job can sign its verify result without a stored key, and anyone can later check which workflow signed it. The transparency log makes a signature public: the bundle reveals the repository and workflow identity, never the change's contents (the result is digest-only, ADR-0034).
- Checking a keyless signature needs the network for the trust root; behind a firewall it fails closed as a problem (exit 1).
- `sigstore` and its dependencies are in the install even for users who never sign keyless. Lazy loading keeps them out of every default run, not out of `node_modules`.
- Amends ADR-0052 (Non-goals: no network call in verify, except this opt-in path) and closes ADR-0051's Sigstore follow-up.
