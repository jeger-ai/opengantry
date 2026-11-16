---
id: ADR-0021
title: Break-glass protocol via verify --break-glass
status: ACTIVE
match_terms:
  - break-glass
  - bypass
  - hotfix
  - emergency
---

## Context

Issue #17 proposed `gantry bypass --break-glass <TICKET>` with an `AUDIT_LEDGER.md` immutable record. OpenGantry already ships break-glass on `gantry verify --break-glass` (RULES.md §6.2): `GXT_BYPASS_SECRET` matching `.gitagent/foreman/BYPASS.sha256`, forensic `refs/notes/gxt-bypass` git notes (or `--audit-commit` when notes cannot be pushed).

## Decision

- **The auditable break-glass protocol is `gantry verify --break-glass --reason "<text>"`** — not a separate bypass command.
- **The immutable ledger is git notes** (`refs/notes/gxt-bypass`), not `AUDIT_LEDGER.md`. CI and `validate-gxt.sh` accept commits with valid gxt-bypass notes on MSN-enforced paths.
- Issue #17's `AUDIT_LEDGER.md` / standalone bypass command design is **superseded** by this ADR.
- Break-glass does **not** disable `gantry runtime exec` forbidden-zone enforcement.

## Consequences

- Doctor warns when `BYPASS.sha256` is unprovisioned.
- SECURITY.md documents the runbook; adopters provision the anchor and push notes with the branch.
- Planner MUST review bypass usage post-incident per RULES.md §6.2.

## Amendment: the anchor comes from the base commit (MSN-0381)

Issue #356 (ADR-0063 owner decision Q10) found that the anchor was read from the working tree, so a candidate could write `BYPASS.sha256` next to a secret it chose. `gantry verify --break-glass` now reads the anchor from the trusted base commit: the merge-base of `HEAD` with `origin/HEAD`. With any remote configured, `origin/HEAD` is required (missing: `BYPASS_BASE_UNKNOWN`, run `git fetch && git remote set-head origin --auto`); `origin/main` and local branches never stand in for it. Only a repository with no remote at all uses local `main` or `master`. A default branch that shares no history with `HEAD` refuses. Neither a working-tree edit nor a commit on the branch under review moves it. No base (`BYPASS_BASE_UNKNOWN`) or no anchor at the base (`BYPASS_NOT_CONFIGURED`) refuses. The secret, the note and the ledger row are unchanged.

Limits: without a remote, the base is the local default branch, which a same-user process can move with a commit there; with a remote, it can still rewrite `origin/HEAD` or the remote-tracking branch it names locally (PR #365 review round 2 removed the fallbacks that also let it delete those refs and use local `main`). Local break-glass is not a boundary against a same-user process without a proven sandbox. CI, judging the pull request's base, is. CI still accepts any well-formed `gxt-bypass` note; that check does not prove the secret was known (follow-up, addressed by the amendment below, which adds attribution, not a boundary).

## Amendment: CI counts only a Planner-signed note (MSN-0385)

CI accepted any well-formed `gxt-bypass` note, so a candidate that never knew the secret could write `{ v: 1, reason }` on its own commit. CI cannot check the secret without holding it, and a pull request's workflow can read repository secrets, so the note now carries proof of a key instead: version 2, naming the noted commit, the reason, the time, the mission and the signer, with an SSH signature (namespace `opengantry-break-glass`) over its canonical JSON without the signature. `gantry ci msn-range` counts it only when `.gitagent/foreman/PLANNER.signing.pub` at the base commit lists the signing key for the note's signer (the same allowed-signers file and pure ed25519 SSHSIG check as dependency approvals, ADR-0062). `gantry verify --break-glass` still requires the secret, then signs with git's SSH signing key; without one it refuses (`BYPASS_SIGNING_UNAVAILABLE`). A version 1 note no longer counts, with a message naming the reason. The audit commit (`--audit-commit`) is unchanged.

What the note is (PR #369 review round): attribution and an audit trail, not a boundary. It only waives the `[MSN-NNNN]` subject check, and any commit whose subject starts with `[MSN-NNNN]` passes that check without a note. The workflow and the verifier come from the repository: in an adopter repository the workflow runs from the pull request head, so a pull request that edits it, or the code it runs, changes what CI accepts. The boundary is branch protection plus human review of workflow and verifier changes. In this repository the `msn_commits` job builds the `gantry` that runs `ci msn-range` from the pull request's base commit, so a pull request cannot change the code that judges its own notes; the job definition itself still comes from the head and needs that review.

Limits: whoever holds a Planner key can sign a note for any commit; the secret is no longer what CI relies on. A Planner key readable by a same-user process is as reachable as the secret was. The key list is read from the pull request's base, so it is as trustworthy as the default branch.
