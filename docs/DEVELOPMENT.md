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

**Roadmap / open work:** [`docs/BACKLOG.md`](BACKLOG.md) · [Project board #2](https://github.com/orgs/jeger-ai/projects/2) · [Issues](https://github.com/jeger-ai/opengantry/issues?q=is%3Aissue+is%3Aopen+label%3Abacklog) ([v1.1](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fv1.1) · [tactical](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Ftactical) · [adoption](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fadoption) · [v1.2+](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fv1.2)).

## Law + routing (before you edit)

1. [`.gitagent/teacher/RULES.md`](../.gitagent/teacher/RULES.md) — SOD, trace, TMVC, Rule 4.4, break-glass.
2. [`.gitagent/foreman/MANIFEST.json`](../.gitagent/foreman/MANIFEST.json) — skills, roots, forbidden zones.

### Specimen routing (this repository only)

**jeger-ai/opengantry** dogfoods through the **`gapman`** skill and TMVC `src/cli/` only. The specimen [`.gitagent/foreman/MANIFEST.json`](../.gitagent/foreman/MANIFEST.json) intentionally **diverges** from [`templates/.gitagent/foreman/MANIFEST.json`](../templates/.gitagent/foreman/MANIFEST.json): adopters still receive `ui`/`logic` skills and example app paths after `gapman init`, but this CLI-only repo does not list fictional `src/components/` or `src/lib/` roots.

MSN-enforced paths for commits and PR guards come from **fixed substrate paths** plus **every `tmvc_roots` entry in MANIFEST** (see `scripts/gxt-manifest-lib.mjs`).

**Teacher allowlist:** committed [`.gitagent/foreman/TEACHER.allowlist`](../.gitagent/foreman/TEACHER.allowlist) (team emails for CI git-proof). Personal overrides: `.gitagent/foreman/TEACHER.allowlist.local` (gitignored). Run `gapman teacher show` to confirm.

**Where work belongs**

| Change | Skill (typical) | TMVC |
|--------|-----------------|------|
| `src/cli/**` (gapman) | `gapman` | `src/cli/` |
| App logic (if present) | `logic` | `src/lib/`, `src/utils/` |
| UI (if present) | `ui` | `src/components/`, `src/styles/` |
| `.gitagent/`, hooks, workflows | Teacher + mission | Tier-3 — legislate first |

### CLI registrar conventions (`program-core.ts`, `program-workflow.ts`)

Commander `.action()` handlers MUST extract options from the **typed callback parameter** — never `this.opts()` (arrow handlers have no Command `this`).

| Pattern | When | Example |
|---------|------|---------|
| **Pass-through** | CLI flag names match the command `*Options` interface | `init`: `(options: InitOptions) => runInit(options)` |
| **Typed adapter** | Commander names differ or values need coercion | `start` (`--no-write` → `writeMission`), `verify` (`--reason` → `breakGlassReason`, `--scan-depth` string → number) |
| **Positional + options** | Variadic intent args | `(intentParts, options, _cmd)` — options is the second arg; join positionals before calling `run*` |

Numeric or transformed flags MUST coerce in `.option()` parsers or the command adapter — never blind pass-through. See `verifyOptionsFromCli` in `program-workflow.ts`.

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
npm install @jeger-ai/opengantry@latest   # when a newer release exists
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

## Zero-trust gates (sole trust boundary)

All code changes are **untrusted** — human-typed or IDE-generated. OpenGantry does not deterministically attribute offline IDE provenance. Security relies on **result-state checks** only:

| Check | When | Mechanism |
|-------|------|-----------|
| Mission gate | `gapman verify` | Mission `gate_command` + optional `gate_success_substring` |
| Unit tests | gate / CI | `npm test` (`node:test`) |
| Compile / types | build / CI | `npm run build` (`tsc`) |
| Manifest shape | CI / pre-push | `gapman check`, `validate-gxt.sh manifest` |
| Changed-code quality | PR / pre-push | `scripts/check-changed-code.sh` — complexity, import layers, line budgets on touched `src/cli/**/*.ts` |
| Banned imports | mission gate / surgeon | `gapman check-imports` |
| KPI thresholds | verify (optional) | `gapman scan` + mission `kpi_gate` |
| Perimeter (CI) | PR | `gapman perimeter --ci` on protected governance paths |
| Trace mapping | verify | Verbatim quotes from `WORKER_LOG.md` for mission PASS rows |

External IDE skill packs are **edge-only** (local, gitignored). They must not be wired into `.gitagent/` or shipped integration templates. Optional `[SKILL-EXEC]` lines in `WORKER_LOG.md` are human triage context only — not verify evidence. See [`AGENTS.md`](../AGENTS.md) and [`.gitagent/teacher/RUNTIME.md`](../.gitagent/teacher/RUNTIME.md).

## Before push / PR

```bash
npm run validate
```

Runs **`dev-validate-core.sh`** (build, `gapman check`, `validate-gxt.sh manifest` via Node—no `jq`, tests, doctor, MCP dogfood, changed-code, MSN vs `origin/main`) then **`verify-pr-missions.sh`** (full `gapman verify` on branch-changed missions). Mission gates SHOULD use `dev-validate-core.sh` only—not `npm run validate`—to avoid verify/gate recursion.

**Repo-only scripts:** OpenGantry specimen dev gates (`check-changed-code.sh`, `check-import-layers.mjs`, `dev-validate-core.sh`, and related helpers) live under `scripts/` but are **not** in the init asset catalog. [`scripts/gen-asset-catalog.mjs`](../scripts/gen-asset-catalog.mjs) enforces this via `REPO_ONLY_SCRIPTS` — the generator fails if any repo-only script leaks into `templates/integrations/asset-catalog.json`.

**Hooks (automatic when `core.hooksPath=.githooks`):**

- **pre-push** — `gapman verify --pre-push` for branch-changed missions (legislative stubs pass after git-proof); `gapman check` if manifest/skills changed; advisory `gapman perimeter` when governance files change; changed-code gate for touched `src/cli/**/*.ts`.

## OpenGantry 2.0: LLM evidence + KPI gate

Nondeterministic LLM checks produce **committed evidence**; merge stays deterministic:

1. Mission declares optional `llm_verifiers` + `kpi_gate` (see [`.gitagent/teacher/MISSION.schema.yaml`](../.gitagent/teacher/MISSION.schema.yaml)).
2. Worker runs **`gapman scan --mission …`** — each verifier command must print **JSON on stdout** (trailing whitespace/newlines tolerated). Success contract per verifier:
   - process exit code `0`
   - parseable JSON object with a non-empty `metrics` map (`Record<string, number | boolean>`)
   - optional `findings` array and `exit_code` field in JSON (fragment `exit_code` can raise report `exit_code` even when the process exits 0)
   - failed optional verifiers set `{id}::__verifier_ok: false` in the committed report; required verifiers fail the scan when the contract is not met
3. **`gapman verify`** runs shell `gate_command`, then evaluates `kpi_gate.thresholds` against [`.gitagent/kpi/MSN-NNNN.json`](../.gitagent/teacher/KPI-REPORT.schema.yaml), then trace mapping.
4. KPI stale binding mirrors trace evidence: local warnings only; **`--pre-push`** / **`--ci`** fail-closed when TMVC drifts after the report commit.
5. **`gapman register <dir>`** proposes skills from AST footprints; Teacher still owns manifest edits (Rule 4.4).
6. **`gapman perimeter --ci`** in CI enforces verified signatures on protected paths (local mode is advisory).

See [ADR-0020](../.gitagent/out-of-scope/ADR-0020-kpi-llm-evidence-gate.md).

## Code Surgeon (`verify --fix`, MSN-0047+)

Deterministic quarantine mutations for specific gate failures — an isolation layer, **not** a pass generator:

1. **`gapman verify --fix`** (interactive or `--non-interactive`) invokes a registered **Code Surgeon** when gate output matches a known failure:
   - **`GXT_BANNED_IMPORT_DETECTED`** — `gapman check-imports` stderr
   - **`GXT_IMPORT_LAYER_VIOLATION`** — `check-import-layers.mjs --json` structured report (v2.1+)
2. Surgeon **quarantines** the offending import via TypeScript AST: removes the live `import` declaration, injects `GXT-SURGEON-QUARANTINE` markers and lazy Proxy roadblocks (no silent deletion).
3. On mutation, append **`[SURGEON-MUTATION] …`** to `WORKER_LOG.md`, then **rerun the full verify pipeline with `--fix` disabled**.
4. Plain `gapman verify` (no `--fix`) remains fail-closed and never mutates TMVC.

**Language boundary:** verify core phases (`git_proof`, `gate`, `kpi`, `trace`) are language-agnostic. Native surgeons require TypeScript in the adopter workspace (or gapman package root); unresolved `typescript` disables surgeon paths only — core verify still runs.

**Import-layer JSON contract:** `node scripts/check-import-layers.mjs --json <files…>` emits `{ schema_version, ok, violations[] }` with stable `rule_id` values. Surgeons parse JSON only — not human stderr.

Implementation: [`src/cli/lib/surgeons/`](../src/cli/lib/surgeons/) registry + orchestration in `surgeon-orchestration.ts` / `verify-present.ts`.

**Release (v2.1.0+):** bump `package.json` with `npm version <semver> --no-git-tag-version`; sync `opengantry_version` in [`templates/integrations/compatibility.json`](../templates/integrations/compatibility.json); run [`scripts/assert-cli-version-parity.sh`](../scripts/assert-cli-version-parity.sh); tag `v<semver>` for npm publish. Race-safe publish: draft GitHub release → push tag → block on [`npm-publish.yml`](../.github/workflows/npm-publish.yml) → [`scripts/poll-npm-version.sh`](../scripts/poll-npm-version.sh) → promote release live ([`scripts/release-gate-publish.sh`](../scripts/release-gate-publish.sh)).

## Definition of done (OpenGantry repo)

- [ ] Mission under `.gitagent/missions/` with Teacher `[MSN-…]` commit when GXT paths or behavior changed
- [ ] `WORKER_LOG.md` trace lines match mission PASS rows (or `gapman verify` on your mission passes)
- [ ] `npm run validate` passes
- [ ] Rule 4.4: manifest skill keys ↔ `skills/*.md` in the same change set when skills change
- [ ] `.gitagent/ARCHITECTURE.pointer.json` resolved and layer rules respected for `src/cli` edits
- [ ] When changing agent integration surfaces: bump `templates/integrations/compatibility.json` `verified_date` + recipe fragments in the same PR

## CI parity

Pull requests run [`.github/workflows/gxt-validate.yml`](../.github/workflows/gxt-validate.yml):

| Job | What it enforces |
|-----|------------------|
| `pr_governance` | PRs must target the integration branch (`main` here; `default_branch` in init template; override via repo variable `GXT_INTEGRATION_BRANCH`) — blocks stacked mission PRs |
| `manifest` | `gapman check`, `validate-gxt.sh manifest`, unit tests, `gapman doctor`, `gapman perimeter --ci` on PRs |
| `code_quality` | Changed-code gates (`check-changed-code.sh`) on PR diff |
| `msn_commits` | `[MSN-NNNN]` on commits touching MSN-enforced paths (substrate + MANIFEST `tmvc_roots`); checkout **PR head SHA** |
| `mission_verify` | Mission purity (one `[MSN-NNNN]` per `${base}..${head}`); full `gapman verify` on each mission file in `${base}...${head}` triple-dot diff; fails if protected paths change without a mission file |

Local `npm run validate` is the full superset (includes `verify-pr-missions.sh` + MSN vs `origin/main`). Run it before you open a PR.

`gapman init` ships [`scripts/verify-pr-missions.sh`](../scripts/verify-pr-missions.sh) when CI is enabled (v1.1+). Existing v1.0 installs: run `gapman upgrade apply` or re-init managed CI assets.

## Troubleshooting verify / hooks

- Run the CLI from the repo root: `npm run gapman -- verify --mission .gitagent/missions/<file>.yaml` (after `npm run build`). Policy failures print a one-line error plus **`Fix:`** remediation hints — not stack traces.
- Set `GAPMAN_DEBUG=1` only when you need a stack trace for an unexpected error.
