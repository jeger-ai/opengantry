# GitHub issue refinement

Backlog issues use a consistent body format for implementation readiness:

```markdown
## Problem
…context from codebase…

## Acceptance
- [ ] …

## Priority
**Blocker | Major | Minor | Low** — …

**Refs:** …
```

## Applying refinements

Issue bodies live in [`bodies/`](bodies/). Each file is named `{issue-number}.md` (three-digit zero-padded, e.g. `008.md`, `043.md`).

Maintainers with `issues: write` on the repo:

```bash
./scripts/apply-github-issue-refinements.sh          # all bodies in bodies/
./scripts/apply-github-issue-refinements.sh 23 27    # specific issues only
DRY_RUN=1 ./scripts/apply-github-issue-refinements.sh  # preview
```

Requires [`gh`](https://cli.github.com/) authenticated with issue edit permission.

## Last refinement pass

**Date:** 2026-06-10 (automation cron)

**Issues refined:** #8–#17, #23–#38 (26 open issues that lacked `## Problem`)

**Already refined (skipped):** #43–#58 (thermo-nuclear review pass, 2026-06-09/10)

**Source context:** `docs/BACKLOG.md`, `src/cli/`, `.gitagent/`, integration templates.
