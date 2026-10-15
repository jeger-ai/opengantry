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

Commit only the hash. Never commit the plaintext secret. `gantry doctor` checks whether `GXT_BYPASS_SECRET` matches the anchor when the variable is set.

## Use it

```bash
export GXT_BYPASS_SECRET='your-team-secret'
gantry verify --break-glass --reason "Production auth down: hotfix session cookie" \
  --mission .gitagent/missions/MSN-0001.<slug>.yaml
git push origin refs/notes/gxt-bypass
```

- Authorization requires `GXT_BYPASS_SECRET` to match `.gitagent/foreman/BYPASS.sha256`. A commit subject alone can never authorize a bypass.
- Verify writes a forensic record as a git note on `refs/notes/gxt-bypass`. Pass `--audit-commit` when notes cannot be pushed. Push the notes with the branch.
- Pull request CI accepts governance-touching commits that carry a valid bypass note.
- With the compliance ledger enabled, a bypass without a `break_glass` ledger row is a failed control ([Org control plane](../guides/org-control-plane.md#compliance-ledger)).
- The Planner reviews every bypass after the incident.

## What it does not do

- It never disables `gantry runtime exec` forbidden-zone enforcement.
- It is not for routine bot autofixes from code scanning, Snyk or Dependabot. Configure [trusted automation](../concepts/enforcement-boundary.md#trusted-automation) for those.

Design notes: [ADR-0021 break-glass protocol](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0021-break-glass-protocol.md).
