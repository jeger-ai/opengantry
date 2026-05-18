# Agent instructions (OpenGantry)

Before planning, editing code, or running substantive commands in this repository:

1. Read **`.gitagent/teacher/RULES.md`** — governance (SOD, trace mapping, risk tiers, dynamic TMVC, Rule 4.4).
2. Read **`.gitagent/foreman/MANIFEST.json`** — Foreman map (`schema_version`, per-skill `trust_threshold`, `tmvc_roots`, `forbidden_zones`, `path_risks`, `risk_keywords`).

Treat these as the **law + routing contract** for agent work. For orientation and workflow, see **`.gitagent/README.md`**.

## Developing this repo (mandatory dogfood)

OpenGantry development **MUST** use the full GXT stack — same as adopters. See **[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)**.

| Step | Command |
|------|---------|
| Setup | `npm ci && npm run build` · `git config core.hooksPath .githooks` · `export GAPMAN_TEACHER_EMAILS="$(git config user.email)"` |
| Readiness | `gapman doctor` |
| Scope work | `gapman triage "<intent>"` → `gapman legislate … --msn MSN-NNNN --skill-key gapman-ralph` (CLI) or `substrate-ralph` (substrate) |
| Worker env | `eval "$(gapman runtime env --mission .gitagent/missions/<file>.yaml)"` |
| Finish | Trace in `WORKER_LOG.md` · `gapman verify --mission …` |
| Pre-PR | `npm run validate` |

- **`src/cli/`** → skill **`gapman-ralph`** (TMVC `src/cli/`).
- **`.gitagent/`**, hooks, workflows** → Tier-3; Teacher mission + `[MSN-…]` commits required.
- Do **not** bypass hooks or skip verify for “internal” convenience.

For **`gapman`** command reference, see root **`README.md`** (gapman CLI section).

When legislating missions, review **`.gitagent/out-of-scope/`** for relevant ADRs (Teacher obligation per **RULES**).

If the user clearly scopes work to something that cannot affect OpenGantry (e.g. a typo in unrelated docs), still skim **RULES** and **MANIFEST** when the change could touch skills, missions, routing, or manifest sync.
