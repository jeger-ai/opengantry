# Developing OpenGantry (dogfood the full stack)

This repository **is** the GXT specimen. Contributors and agents MUST follow the same substrate, hooks, and `gapman` commands we ship to adopters — not a lighter internal process.

## One-time setup

```bash
npm ci
npm run build
git config core.hooksPath .githooks
gapman teacher set "$(git config user.email)"
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
3. **Teacher commit** — subject **`[MSN-NNNN] …`**, author email in repo Teacher allowlist, mission file under `.gitagent/missions/` included in the commit.
4. **Worker scope** — `source scripts/gxt-runtime-env.sh .gitagent/missions/<file>.yaml` (or `eval "$(gapman runtime env --mission …)"`) before agent/shell work.
5. **Trace** — append PASS quotes to repo-root `WORKER_LOG.md` (see [example.verify.yaml](../.gitagent/missions/example.verify.yaml)).
6. **Verify** — `gapman verify --mission .gitagent/missions/<file>.yaml`.

## Cursor session (this repo)

OpenGantry dogfoods GXT in Cursor. Other agents: [`docs/INTEGRATIONS.md`](INTEGRATIONS.md).

### One-time Cursor enablement

1. **Hooks on** — Cursor **Settings → Hooks** (project hooks from `.cursor/hooks.json` must be enabled).
2. **MCP on** — Cursor **Settings → MCP** (project server from `.cursor/mcp.json` → `gapman mcp serve`).
3. **Repo setup** (same as above):

```bash
npm ci && npm run build
git config core.hooksPath .githooks
gapman teacher set "$(git config user.email)"
gapman doctor
```

Restart Cursor after first clone if hooks do not appear (**Output → Hooks**).

### Per-feature closed loop

**Cursor MCP (preferred):**

1. Agent: `gxt_draft_legislation` → present draft → human approves in chat → `gxt_execute_legislation`.
2. Teacher: run returned `suggested_human_action` (`git commit …`).
3. Agent: `gxt_check_signature` → `gxt_pin_mission` → worker edits → `gxt_verify`.

**CLI fallback:**

```bash
gapman triage "<intent>"
gapman legislate "<intent>" --msn MSN-NNNN --skill-key gapman   # or substrate
# Teacher: git commit -m "[MSN-NNNN] legislate …" including mission file

scripts/gxt-pin-mission.sh .gitagent/missions/MSN-NNNN.<slug>.yaml
# New Agent chat → sessionStart injects GXT_TMVC_* + mission context automatically

source scripts/gxt-runtime-env.sh   # integrated terminal (same pinned mission)
# … Cursor Agent work in src/cli/ or legislated scope …
# Append gate evidence to WORKER_LOG.md

gapman verify --mission .gitagent/missions/MSN-NNNN.<slug>.yaml
npm run validate
git push   # pre-push: gapman verify --pre-push on branch-changed missions
```

Validate MCP flow locally: `./scripts/validate-mcp-dogfood.sh`

### Substrate upgrade loop (adopters + dogfood)

Tier-3 lifecycle updates use the installed `gapman` package only (no remote fetch):

```bash
npm install gapman@latest          # when a newer release exists
gapman upgrade                     # stage managed_strict assets + draft MSN-900x mission YAML
# Review .gitagent/.upgrade-tmp/ diff; commit mission YAML only (tmp is gitignored)
git add .gitagent/missions/MSN-9001.upgrade-vX.Y.Z.yaml
git commit -m "[MSN-9001] approve substrate upgrade to vX.Y.Z"
gapman upgrade --apply --mission .gitagent/missions/MSN-9001.upgrade-vX.Y.Z.yaml
gapman doctor
```

MCP: `gxt_upgrade_plan` / `gxt_upgrade_apply` (same gates as CLI).

| Layer | Mechanism | OpenGantry repo |
|-------|-----------|-----------------|
| Context | `.cursor/rules/` + `AGENTS.md` + `sessionStart` hook | RULES + MANIFEST + pinned mission |
| Legislation | MCP `gxt_draft_legislation` / `gxt_execute_legislation` | Two-step chat approval before file write |
| Shell guard | `beforeShellExecution` (fallback) | Blocks casual writes to foreman / RULES; asks on raw `gapman legislate` |
| Terminal env | `gxt-runtime-env.sh` / `gxt-pin-mission.sh` | Sets `GXT_*` for integrated terminal |
| Process trap | `gapman runtime exec` | Headless Cursor CLI / CI only |

IDE Agent **Write/Edit** is advisory TMVC — stay within pinned mission scope; use `runtime exec` when you need manifest-enforced subprocess boundaries. See INTEGRATIONS **Enforcement boundary**.

## Before push / PR

```bash
npm run validate
```

Runs build, `gapman check`, `validate-gxt.sh manifest`, unit tests, `gapman doctor`, changed-file ESLint/layers, and MSN subject check vs `origin/main`.

**Hooks (automatic when `core.hooksPath=.githooks`):**

- **pre-push** — `gapman verify --pre-push` for branch-changed missions (legislative stubs pass after git-proof); `gapman check` if manifest/skills changed; changed-code gate for touched `src/cli/**/*.ts`.
- **post-checkout** — scaffold `WORKER_LOG.md` on feature branches when missing.

## Definition of done (OpenGantry repo)

- [ ] Mission under `.gitagent/missions/` with Teacher `[MSN-…]` commit when GXT paths or behavior changed
- [ ] `WORKER_LOG.md` trace lines match mission PASS rows (or `gapman verify` on your mission passes)
- [ ] `npm run validate` passes
- [ ] Rule 4.4: manifest skill keys ↔ `skills/*.md` in the same change set when skills change
- [ ] `.gitagent/ARCHITECTURE.pointer.json` resolved and layer rules respected for `src/cli` edits
- [ ] When changing agent integration surfaces: bump `templates/integrations/compatibility.json` `verified_date` + recipe fragments in the same PR

## CI parity

Pull requests run [`.github/workflows/gxt-validate.yml`](../.github/workflows/gxt-validate.yml): `gapman check`, `gapman doctor`, tests, `validate-gxt.sh`, **changed-code quality** on PR diffs, and path-scoped MSN commit subjects. Local `npm run validate` is the full superset (includes changed-code + MSN vs `origin/main`) — run it before you open a PR.

## Troubleshooting verify / hooks

- Run the CLI from the repo root: `npm run gapman -- verify --mission .gitagent/missions/<file>.yaml` (after `npm run build`). Policy failures print a one-line error plus **`Fix:`** remediation hints — not stack traces.
- Set `GAPMAN_DEBUG=1` only when you need a stack trace for an unexpected error.
