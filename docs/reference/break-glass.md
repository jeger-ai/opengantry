---
title: "Break-glass"
description: "Emergency verify bypass for production incidents: secret-gated, recorded as a git note, and reviewed afterwards. Not for routine bot fixes."
section: reference
order: 4
---

# Break-glass

Production emergencies happen, and a silent policy bypass is worse than an explicit, auditable one. Break-glass lets `gantry verify` pass without the Planner commit, the gate and the evidence when a hotfix cannot wait. It is not a substitute for mission review.

## Set it up once

```bash
printf '%s' 'your-team-secret' | sha256sum | awk '{print $1}' > .gitagent/foreman/BYPASS.sha256
```

Commit only the hash, to the default branch. Never commit the plaintext secret.

Whoever runs break-glass also needs an ed25519 SSH signing key that `.gitagent/foreman/PLANNER.signing.pub` on the default branch lists for their `user.email`, set as git's signing key (`git config gpg.format ssh`, `git config user.signingkey ~/.ssh/id_ed25519.pub`). CI counts only a note signed with such a key.

## Use it

```bash
export GANTRY_BYPASS_SECRET='your-team-secret'
gantry verify --break-glass --reason "Production auth down: hotfix session cookie" \
  --mission .gitagent/missions/MSN-0001.<slug>.yaml
git push origin refs/notes/gxt-bypass
```

- Authorization requires `GANTRY_BYPASS_SECRET` to match `.gitagent/foreman/BYPASS.sha256` as committed at the base commit: the merge-base of `HEAD` with `origin/HEAD`. With any remote configured, `origin/HEAD` is required: when it is missing, verify refuses with `BYPASS_BASE_UNKNOWN` (run `git fetch && git remote set-head origin --auto`) and never falls back to `origin/main` or a local branch. Only a repository with no remote at all uses local `main` or `master`. A default branch that shares no history with `HEAD` refuses. The working tree's copy and commits on your branch are ignored. No base or no anchor there refuses. A commit subject alone can never authorize a bypass.
- **Limit:** locally this is not a boundary against a process running as your user. Such a process can rewrite the remote-tracking refs (`origin/HEAD` and the branch it names), or in a repository without a remote commit to `main`, and so choose the anchor. CI is not the boundary either: the boundary is branch protection plus human review of workflow and verifier changes (below, and the design notes).
- Verify writes a forensic record as a git note on `refs/notes/gxt-bypass`: version 2, naming the commit, the reason and the signer (your `user.email`), SSH-signed with your git signing key (namespace `opengantry-break-glass`). Without an SSH signing key it refuses with `BYPASS_SIGNING_UNAVAILABLE` and writes no note; with a key that `PLANNER.signing.pub` at the default branch tip (`origin/HEAD`) does not list, it warns that CI will refuse the note. The warning checks the default branch; CI checks the pull request's actual base, which differs for a pull request that targets another branch. Pass `--audit-commit` when notes cannot be pushed. Push the notes with the branch.
- Pull request CI (`gxt-validate.yml`) fetches `refs/notes/*` and accepts a commit that touches mission-enforced paths without an `[MSN-NNNN]` subject only when that commit carries a note that verifies: version 2, naming that commit, and signed by a key that `PLANNER.signing.pub` at the pull request's base lists for the note's signer. CI holds no secret; the signature names who broke the glass.
- **The signed note is attribution and an audit trail, not a boundary.** It only waives the subject check, and a subject proves nothing: any commit whose subject starts with `[MSN-NNNN]` passes that check without a note. The workflow and the code that checks the note also come from the repository, so a pull request that edits them can change what CI accepts.
- **Your boundary is branch protection plus human review** of every change to the workflows (`.github/workflows/`) and to the verifier. The adopter workflow that `gantry init` installs runs from the pull request head: the PR's own copy of the workflow decides which steps run, although it installs the published `gantry`. Protect the default branch and require review (for example CODEOWNERS) for workflow paths. OpenGantry's own CI also builds the checking `gantry` from the pull request's base commit, but the pull request still supplies the commit range, its notes, `.gitagent/config.yaml` (the trusted-automation rules) and `MANIFEST.yaml` that the check reads.
- **Notes written before this check** (version 1, unsigned) no longer count; CI names the reason. Re-run `gantry verify --break-glass` on that commit with your signing key and push the notes again.
- With the compliance ledger enabled, a bypass without a `break_glass` ledger row is a failed control ([Org control plane](../guides/org-control-plane.md#compliance-ledger)).
- The Planner reviews every bypass after the incident.

## What it does not do

- It never disables `gantry runtime exec` forbidden-zone enforcement.
- It is not for routine bot autofixes from code scanning, Snyk or Dependabot. Configure [trusted automation](../concepts/enforcement-boundary.md#trusted-automation) for those.

Design notes: [ADR-0021 break-glass protocol](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0021-break-glass-protocol.md).
