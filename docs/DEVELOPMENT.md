# Developing OpenGantry (dogfood the full stack)

This repository **is** the GXT specimen. Contributors and agents MUST follow the same substrate, hooks, and `gapman` commands we ship to adopters — not a lighter internal process.

## One-time setup

```bash
npm ci
npm run build
git config core.hooksPath .githooks
export GAPMAN_TEACHER_EMAILS="$(git config user.email)"
```

Confirm readiness:

```bash
gapman doctor
```

## Law + routing (before you edit)

1. [`.gitagent/teacher/RULES.md`](../.gitagent/teacher/RULES.md) — SOD, trace, TMVC, Rule 4.4, break-glass.
2. [`.gitagent/foreman/MANIFEST.json`](../.gitagent/foreman/MANIFEST.json) — skills, roots, forbidden zones.

**Where work belongs**

| Change | Skill (typical) | TMVC |
|--------|-----------------|------|
| `src/cli/**` (gapman) | `gapman` | `src/cli/` |
| App logic (if present) | `logic` | `src/lib/`, `src/utils/` |
| UI (if present) | `ui` | `src/components/`, `src/styles/` |
| `.gitagent/`, hooks, workflows | Teacher + mission | Tier-3 — legislate first |

## Mission loop (required for substantive work)

1. **Triage** — `gapman triage "<intent>"` (escalation → Teacher legislates).
2. **Legislate** — `gapman legislate "<intent>" --msn MSN-NNNN --skill-key gapman` (or `substrate` for substrate-only).
3. **Teacher commit** — subject **`[MSN-NNNN] …`**, author email in `GAPMAN_TEACHER_EMAILS`, mission file under `.gitagent/missions/` included in the commit.
4. **Worker scope** — `eval "$(gapman runtime env --mission .gitagent/missions/<file>.yaml)"` before agent/shell work.
5. **Trace** — append PASS quotes to repo-root `WORKER_LOG.md` (see [example.verify.yaml](../.gitagent/missions/example.verify.yaml)).
6. **Verify** — `gapman verify --mission .gitagent/missions/<file>.yaml`.

## Before push / PR

```bash
npm run validate
```

Runs build, `gapman check`, `validate-gxt.sh manifest`, unit tests, `gapman doctor`, changed-file ESLint/layers, and MSN subject check vs `origin/main`.

**Hooks (automatic when `core.hooksPath=.githooks`):**

- **pre-push** — `gapman verify` for branch-changed missions; `gapman check` if manifest/skills changed; changed-code gate for touched `src/cli/**/*.ts`.
- **post-checkout** — scaffold `WORKER_LOG.md` on feature branches when missing.

## Definition of done (OpenGantry repo)

- [ ] Mission under `.gitagent/missions/` with Teacher `[MSN-…]` commit when GXT paths or behavior changed
- [ ] `WORKER_LOG.md` trace lines match mission PASS rows (or `gapman verify` on your mission passes)
- [ ] `npm run validate` passes
- [ ] Rule 4.4: manifest skill keys ↔ `skills/*.md` in the same change set when skills change
- [ ] [docs/ARCHITECTURE.md](ARCHITECTURE.md) layer rules respected for `src/cli` edits

## CI parity

Pull requests run [`.github/workflows/gxt-validate.yml`](../.github/workflows/gxt-validate.yml): `gapman check`, tests, `validate-gxt.sh`, and **changed-code quality** on PR diffs. Local `npm run validate` should match before you open a PR.

## Troubleshooting verify / hooks

- Run the CLI from the repo root: `npm run gapman -- verify --mission .gitagent/missions/<file>.yaml` (after `npm run build`). Policy failures print a one-line error plus **`Fix:`** remediation hints — not stack traces.
- Set `GAPMAN_DEBUG=1` only when you need a stack trace for an unexpected error.
