---
title: "Developing OpenGantry"
description: "Contributor guide for this repository: dogfood the full GXT stack with missions, hooks, gantry verify and npm run validate."
publish: false
---

# Developing OpenGantry (dogfood the full stack)

This repository **is** the GXT specimen. Contributors and agents MUST follow the same substrate, hooks, and `gantry` commands we ship to adopters — not a lighter internal process.

## One-time setup

```bash
npm ci
npm run build
git config core.hooksPath .githooks
gantry planner set "$(git config user.email)"
```

Confirm readiness:

```bash
gantry doctor
```

**Roadmap / open work:** [GitHub Issues](https://github.com/jeger-ai/opengantry/issues?q=is%3Aissue+is%3Aopen+label%3Abacklog) · [Project board #2](https://github.com/orgs/jeger-ai/projects/2) · Historical backlog: [`docs/archive/BACKLOG.md`](archive/BACKLOG.md) · Release history: [`docs/CHANGELOG.md`](CHANGELOG.md)

**Docs map:** [`docs/index.md`](index.md) · writing rules for `docs/`: [`docs/STYLE.md`](STYLE.md).

## Law + routing (before you edit)

1. [`.gitagent/planner/RULES.md`](../.gitagent/planner/RULES.md) — SOD, trace, TMVC, Rule 4.4, break-glass.
2. [`.gitagent/foreman/MANIFEST.yaml`](../.gitagent/foreman/MANIFEST.yaml) — skills, roots, forbidden zones.

### Specimen routing (this repository only)

**jeger-ai/opengantry** dogfoods through the **`gantry`** skill and TMVC `src/cli/` only. The specimen [`.gitagent/foreman/MANIFEST.yaml`](../.gitagent/foreman/MANIFEST.yaml) intentionally **diverges** from [`templates/.gitagent/foreman/MANIFEST.yaml`](../templates/.gitagent/foreman/MANIFEST.yaml): adopters still receive `ui`/`logic` skills and example app paths after `gantry init`, but this CLI-only repo does not list fictional `src/components/` or `src/lib/` roots.

MSN-enforced paths for commits and PR guards come from **fixed substrate paths** plus **every `tmvc_roots` entry in MANIFEST** (see `manifestMsnEnforcedPrefixes` in `src/cli/lib/trusted-automation.ts`; `gantry ci msn-range` applies it).

**Planner allowlist:** committed [`.gitagent/foreman/PLANNER.allowlist`](../.gitagent/foreman/PLANNER.allowlist) (team emails for CI git-proof). Personal overrides: `.gitagent/foreman/PLANNER.allowlist.local` (gitignored). Run `gantry planner show` to confirm.

**Where work belongs**

| Change | Skill (typical) | TMVC |
|--------|-----------------|------|
| `src/cli/**` (gantry) | `gantry` | `src/cli/` |
| App logic (if present) | `logic` | `src/lib/`, `src/utils/` |
| UI (if present) | `ui` | `src/components/`, `src/styles/` |
| `.gitagent/`, hooks, workflows | Planner + mission | Tier-3 — legislate first |

### CLI registrar conventions (`program-core.ts`, `program-workflow.ts`)

Commander `.action()` handlers MUST extract options from the **typed callback parameter** — never `this.opts()` (arrow handlers have no Command `this`).

| Pattern | When | Example |
|---------|------|---------|
| **Pass-through** | CLI flag names match the command `*Options` interface | `init`: `(options: InitOptions) => runInit(options)` |
| **Typed adapter** | Commander names differ or values need coercion | `start` (`--no-write` → `writeMission`), `verify` (`--reason` → `breakGlassReason`, `--scan-depth` string → number) |
| **Positional + options** | Variadic intent args | `(intentParts, options, _cmd)` — options is the second arg; join positionals before calling `run*` |

Numeric or transformed flags MUST coerce in `.option()` parsers or the command adapter — never blind pass-through. See `verifyOptionsFromCli` in `program-workflow.ts`.

## Mission graph (required for substantive work)

1. **Triage** — `gantry triage "<intent>"` (escalation → Planner legislates).
2. **Legislate** — `gantry legislate --from-intent "<intent>" --msn MSN-NNNN --skill-key gantry` (proposes a tighten-only `contract`, prompts `[a]/[e]/[q]` or take `--yes`; runs gap analysis; halts with one finding when operator answers are missing — use MCP `gxt_interrogate` or `--interrogation-file`). MCP: `gxt_propose_contract` → `gxt_draft_legislation` with `interrogation[]` + `contract`. Operator answers are quoted verbatim — never fabricated by agents.
3. **Planner commit** — subject **`[MSN-NNNN] …`**, author email in repo Planner allowlist, mission file under `.gitagent/missions/` included in the commit.
4. **Pin** — `gantry pin .gitagent/missions/<file>.yaml`. When pinned, `verify` / `scan` / `attest` / `runtime env` default to that mission and print `[gantry] Using pinned mission: …`. Run `gantry unpin` when switching MSNs.
5. **Executor scope** — `source scripts/gxt-runtime-env.sh` (uses pin) or `eval "$(gantry runtime env)"` when pinned.
6. **Record** — commit the work, then `gantry verify --mission .gitagent/missions/<file>.yaml --record` on the clean tree and commit `.gitagent/runs/MSN-NNNN.json` (RULES §3). Missions that still carry `trace_rows` append PASS quotes to repo-root `EXECUTOR_LOG.md` instead (see [example.verify.yaml](../.gitagent/missions/example.verify.yaml)).
7. **Verify** — `gantry verify` (pinned) or `gantry verify --mission .gitagent/missions/<file>.yaml`. Optional: `gantry verify --receipt` then `gantry receipt show`.

## Cursor session (this repo)

OpenGantry dogfoods GXT in Cursor. Other agents: [`docs/INTEGRATIONS.md`](INTEGRATIONS.md).

### One-time Cursor enablement

1. **Hooks on** — Cursor **Settings → Hooks** (project hooks from `.cursor/hooks.json` must be enabled).
2. **MCP on** — Cursor **Settings → MCP**. `.cursor/mcp.json` is byte-identical for this specimen and for adopters. The `command` is `./scripts/mcp-launcher.sh`. There is no parity exemption for that file. Do not point Cursor at a raw `node` binary. The launcher runs `node dist/cli/index.js mcp serve` when `dist/cli/index.js` exists (run `npm run build` in this repo); otherwise it runs `gantry mcp serve` from `PATH` (`@jeger-ai/opengantry@3.5.0+`). Reload MCP after changing `mcp.json`, the launcher, or the package.
3. **Repo setup** (same as above):

```bash
npm ci && npm run build
git config core.hooksPath .githooks
gantry planner set "$(git config user.email)"
gantry doctor
```

Restart Cursor after first clone if hooks do not appear (**Output → Hooks**).

### Per-feature closed graph

**Cursor MCP (preferred):**

1. For `gate_adapter: tsc|eslint` missions, Agent: `gxt_doctor` (optional `gate_adapter`, `adapter_baseline`) before legislation.
2. Agent: `gxt_propose_contract` → `gxt_interrogate` (answer findings) → `gxt_draft_legislation` with complete `interrogation[]` and the approved `contract` → human approves → `gxt_execute_legislation`.
3. Planner: run returned `suggested_human_action` (`git commit …`).
4. Agent: `gxt_check_signature` → `gxt_pin_mission` → executor edits → `gxt_verify`.

**CLI fallback:**

```bash
gantry triage "<intent>"
gantry legislate --from-intent "<intent>" --msn MSN-NNNN --skill-key gantry   # or substrate
# Planner: git commit -m "[MSN-NNNN] legislate …" including mission file

gantry pin .gitagent/missions/MSN-NNNN.<slug>.yaml
# New Agent chat → sessionStart injects GXT_TMVC_* + mission context automatically

source scripts/gxt-runtime-env.sh   # integrated terminal (same pinned mission)
# … Cursor Agent work in src/cli/ or legislated scope …
git commit -am "[MSN-NNNN] …"            # clean tree first
gantry verify --record   # writes .gitagent/runs/MSN-NNNN.json after a full pass
git add .gitagent/runs && git commit -m "[MSN-NNNN] Run record"

gantry verify            # uses pin; prints [gantry] Using pinned mission: …
gantry verify --receipt  # optional attestation receipt (gantry receipt show)
npm run validate
git push   # pre-push: gantry verify --pre-push on branch-changed missions
```

Validate MCP flow locally: `./scripts/validate-mcp-dogfood.sh`

### Substrate upgrade graph (adopters + dogfood)

Tier-3 lifecycle updates use the installed `gantry` package only (no remote fetch):

```bash
npm install @jeger-ai/opengantry@latest   # when a newer release exists
gantry upgrade plan --json          # preview file changes (stable schema_version 1)
gantry upgrade                     # stage managed_strict assets + draft MSN-900x mission YAML
# Review .gitagent/.upgrade-tmp/ diff; commit mission YAML only (tmp is gitignored)
git add .gitagent/missions/MSN-9001.upgrade-vX.Y.Z.yaml
git commit -m "[MSN-9001] approve substrate upgrade to vX.Y.Z"
gantry upgrade apply --mission .gitagent/missions/MSN-9001.upgrade-vX.Y.Z.yaml
# Legacy: gantry upgrade --apply --mission … and --dry-run still work
gantry doctor
```

MCP: `gxt_upgrade_plan` / `gxt_upgrade_apply` (same gates as CLI).

| Layer | Mechanism | OpenGantry repo |
|-------|-----------|-----------------|
| Context | `.cursor/rules/` + `AGENTS.md` + `sessionStart` hook | RULES + MANIFEST + pinned mission |
| Legislation | MCP `gxt_draft_legislation` / `gxt_execute_legislation` | Two-step chat approval before file write |
| Shell guard | `beforeShellExecution` (fallback) | Blocks casual writes to foreman / RULES; asks on raw `gantry legislate` |
| Terminal env | `gantry pin` + `source scripts/gxt-runtime-env.sh` (wraps `gantry runtime env`) | Sets `GXT_*` for integrated terminal |
| Process trap | `gantry runtime exec` | Headless Cursor CLI / CI only |

IDE Agent **Write/Edit** is advisory TMVC — stay within pinned mission scope; use `runtime exec` when you need manifest-enforced subprocess boundaries. See INTEGRATIONS **Enforcement boundary**.

## Registries, baseline and conformance (ADR-0052 step 1)

[ADR-0052](../.gitagent/out-of-scope/ADR-0052-rewrite-under-structural-law.md) puts the shape of this codebase under law. Step 1 (MSN-0281) adds three things; the evaluator that enforces them arrives in step 3.

| Artifact | What it is | Who edits it |
|----------|------------|--------------|
| `.gitagent/registry/*.yaml` | One entry per `GXT_*` error code, env name (`prefix`, `role`), subcommand, MCP tool and dependency (runtime and dev), each with `since` | Planner only, in a substrate mission: the directory is `perimeter_protected` and a `gantry` forbidden zone, so `cage check` fails a commit that edits it elsewhere; `gantry arch check` fails a build that uses an unregistered name |
| `ARCH_BASELINE.json` | Per-layer file, line and export counts for the layers of `TARGET_ARCHITECTURE.yaml`, plus the 800-line per-file ceiling | Machine-written by `gantry arch check --ratchet` (lower-only; `--allow-raise` in a Planner mission that raises a budget); `gantry arch check` fails when a count exceeds it |
| `test/conformance/` | Golden `--json` output, exit code and `[GXT_*]` stderr codes for every public subcommand on fixture repositories; `spawning-tests.yaml` classifies the unit tests that spawn a process | `npm run test:conformance` (in `dev-validate-core.sh` and `npm run validate`); re-record only with `CONFORMANCE_RECORD=1` inside a mission that says so |

Rules while the rewrite runs:

- A mission that introduces a new error code, env name, subcommand, MCP tool or dependency includes the registry entry in the legislation commit, with the MSN as `since`.
- A mission that changes CLI output updates the golden files in the same commit and names the change in its intent; a golden diff without that is a regression.
- `gantry arch check` (whole tree, in the gate) must pass: budgets, owners, registries, dependencies and duplicates. Lowering a count is fine and is locked in by `gantry arch check --ratchet` in a Planner mission, never automatically; a mission that must grow a layer runs `--ratchet --allow-raise` and says so in its intent.

## Packages (ADR-0052 step 2, ADR-0054)

| Package | Holds | Depends on |
|---------|-------|------------|
| `packages/core` | pure domain: `path-law` (ADR-0053: areas plus a rule table, `judgePath`, `tightenPathLaw`; the cage, mission scope and verify judge paths with it), `law` (the mission `Law`: a `PathLaw` plus import discipline, `evaluateImportSite`; `ArchLaw`, `evaluateLayerImport`, `evaluatePatternRules`), `exit-codes` (the exit-code table: OK, FAILURE, USAGE), `import-scanner`, `specifier`, `error-codes`, `user-error`, `canonical-json`, `path-glob`, `posix-path`, `manifest` (shape), `law-file`, `strict-yaml`, `run-record`, `trusted-automation`, `constants`, the shared types (`config`, `contract-types`, `gate-adapter`, `interrogation`, `mission-types`, `trace-status`) and the zod schemas | `zod` and `yaml` only (ADR-0054 decision 1) |
| `packages/git` | `git` (the adapter), `git-staged`, `msn-commits`, `repo-text`, `receipt-signing` (ssh or gpg signatures with the git signing key) | core |
| `packages/cage` | the cage runtime (15 modules: rules, snapshot, run, watch, check, suggest, journal, push guard, scope) | core, git |
| `packages/plane` | the org plane: `ledger-entry`, `ledger-chain`, `ledger-append`, `ledger-export`, `policy-types`, `policy-bundle`, `policy-resolve`, `policy-fetch`, `deps-slug`, `deps-fetch`, `deps-resolve`, `receipt-attribution`, `attestation-receipt`, `attestation-export`, `org-export-config`, `digests` | core, git |
| `packages/verify` | the standalone verify contract engine (ADR-0051): `contract`, `diff`, `checks`, `imports`, `python-imports`, `run` | core, git |

- Build: `npm run build` runs `tsc -b`; the packages compile into `dist/packages/<name>/src/`. They are not npm workspaces (`workspaces` lists the slim cage only), so adding one changes no lockfile.
- Import a package module as `#core/<module>.js`, `#git/<module>.js`, `#cage/<module>.js`, `#plane/<module>.js` or `#verify/<module>.js` (root `package.json` `imports`). Do not deep-import `dist/packages/*` and do not add a re-export facade under `src/cli/lib`; the last ones are gone (rewrite step 5e).
- Package tests live in `packages/<name>/tests/` and run with `npm run test:packages` (part of `npm test`).
- A path decision is made by `#core/path-law.js` (build a `PathLaw`, call `judgePath`); an import or layer decision by `#core/law.js` (`evaluateImportSite`, `evaluateLayerImport`, `evaluatePatternRules`). Do not add another matcher, classifier or rule loop in `src/cli`.
- A new module belongs in a package when it needs no `fs`, `git` or `child_process` (core) or is the git adapter (git); otherwise it stays in `src/cli` until its package exists.

## Zero-trust gates (sole trust boundary)

All code changes are **untrusted** — human-typed or IDE-generated. OpenGantry does not deterministically attribute offline IDE provenance. Security relies on **result-state checks** only:

| Check | When | Mechanism |
|-------|------|-----------|
| Mission gate | `gantry verify` | Mission `gate_command` + optional `gate_success_substring` + optional `gate_adapter` (`generic` default, `eslint`, `tsc` — ADR-0041). Optional phases: `policy` (ADR-0042), `dependencies` (ADR-0044). |
| Unit tests | gate / CI | `npm test` (`node:test`) |
| Compile / types | build / CI | `npm run build` (`tsc`) |
| Manifest shape | CI / pre-push | `gantry check` |
| Changed-code quality | PR / pre-push | `scripts/check-changed-code.sh` — complexity, import layers, line budgets on touched `src/cli/**/*.ts` |
| Banned imports | mission gate / repair | `gantry check-imports` |
| KPI thresholds | verify (optional) | `gantry scan` + mission `kpi_gate` |
| Perimeter (CI) | PR | `gantry perimeter --ci` on protected governance paths |
| Run record | verify | `.gitagent/runs/<MSN>.json` written by `gantry verify --record`; missions with `trace_rows` use verbatim quotes from `EXECUTOR_LOG.md` instead |

### Feature-mission adapter gates (ADR-0041)

After MSN-0193, whole-tree `src/cli` ESLint is green. Standard **gantry** feature missions MAY use a **single** explicit adapter for autonomous repair via `gantry context-feed --json`:

| Work | `gate_adapter` | `gate_command` |
|------|----------------|----------------|
| Types | `tsc` | `npx tsc --noEmit --pretty false` |
| Lint | `eslint` | `npm run lint:json` (`eslint --format json src/cli/**/*.ts`) |

Do **not** concatenate `tsc` and `eslint` in one `gate_command`. Routing is never inferred from the command string; one mission has one adapter. Typed adapters **fail closed** (`GXT_GATE_ADAPTER_MISCONFIG`) when `gate_command` contains unquoted `&&`, `||`, `;`, or line break — wrap sequences in a script or use `gate_adapter: generic`. `npm run lint` stays the human-readable formatter and is **not** adapter input.

Before pinning a `tsc` or `eslint` mission, run `gantry doctor` or MCP `gxt_doctor` (`gate_adapter`, `adapter_baseline`) (and `gantry doctor --adapter-baseline` / `adapter_baseline: true` for pre-existing debt). Preflight checks `npx` plus local `typescript`/`eslint` packages, `tsconfig.json` parseability, ESLint config, and that `lint:json` / the mission `gate_command` emit `eslint --format json`. Selection uses declared `gate_adapter` (or `--gate-adapter` / the MCP `gate_adapter` arg); doctor never sniffs `gate_command`.

PR CI remains **changed-file** ESLint (`scripts/check-changed-code.sh`). Whole-tree `lint:json` is a **mission** gate, not a validate/CI change. Jest/Vitest adapters require an ADR-0041 amendment before any CLI parser.

External IDE skill packs are **edge-only** (local, gitignored). They must not be wired into `.gitagent/` or shipped integration templates. Optional `[SKILL-EXEC]` lines in `EXECUTOR_LOG.md` are human triage context only — not verify evidence. See [`AGENTS.md`](../AGENTS.md) and [`.gitagent/planner/RUNTIME.md`](../.gitagent/planner/RUNTIME.md).

## Before push / PR

```bash
npm run validate
```

Runs **`dev-validate-core.sh`** (build, `gantry check`, `gantry ci upgrade-tmp`, tests, doctor, MCP dogfood, changed-code, `gantry ci msn-range` vs `origin/main`) then **`gantry ci verify-missions`** (full `gantry verify` on branch-changed missions). Mission gates SHOULD use `dev-validate-core.sh` only—not `npm run validate`—to avoid verify/gate recursion.

**Repo-only scripts:** OpenGantry specimen dev gates (`check-changed-code.sh`, `check-import-layers.mjs`, `dev-validate-core.sh`, and related helpers) live under `scripts/` but are **not** in the init asset catalog. [`scripts/gen-asset-catalog.mjs`](../scripts/gen-asset-catalog.mjs) enforces this via `REPO_ONLY_SCRIPTS` in [`scripts/lib/asset-catalog-static.mjs`](../scripts/lib/asset-catalog-static.mjs) — the generator fails if any repo-only script leaks into `templates/integrations/asset-catalog.json`.

| Script | Why repo-only |
|--------|----------------|
| `check-changed-code.sh` | Dogfood complexity/import-layer gate on PR diff |
| `check-import-layers.mjs` | Legacy import scanner; dogfood delegates to `gantry arch check` |
| `check-lib-cycles.mjs` | Specimen maintainability gate |
| `dev-validate-core.sh` / `dev-validate.sh` | Full validation superset for maintainers |
| `gen-asset-catalog.mjs` / `gen-dogfood.mjs` / `gen-version.mjs` | Build-time generators |
| `validate-mcp-dogfood.sh` | MCP integration dogfood harness |
| `release-gate-publish.sh` / `poll-npm-version.sh` | npm publish orchestration |

Adopters receive the runtime helpers from the init catalog, not the specimen-only gates above; the CI checks are `gantry ci` subcommands (ADR-0052 step 5b), so no validation script ships.

**Hooks (automatic when `core.hooksPath=.githooks`):** every tracked hook is a one-line shim that calls `gantry hook <name>` (ADR-0052 A8), so the logic is CLI code with tests, not shell.

- **pre-commit** — `gantry hook pre-commit`: `tmvc guard` on the staged index for the pinned mission (blocks when `gantry hooks install` armed strict mode or `GANTRY_TMVC_GUARD_STRICT=1`), then an advisory `contract check` over staged sources.
- **pre-push** — `gantry hook pre-push` reads the ref lines git passes on stdin: a ref deletion verifies nothing, a new branch compares with its upstream (then main, master, the parent), an update compares `remote..local`. Per range: `gantry verify --pre-push` for changed missions (legislative stubs pass after git-proof; a rowless mission with a run record is verified in full); advisory `gantry perimeter` when governance files change; `gantry check` if manifest/skills changed; the changed-code gate for touched `src/cli/**/*.ts` (specimen only, until step 5b folds it into the CLI).
- **post-checkout** — `gantry hook post-checkout`: `EXECUTOR_LOG.md` from the template on the first checkout of a feature branch.

## Releasing

A release is its own mission that bumps every version site (including `packages/opengantry-cage/package.json`) and turns the **Unreleased** entries into the release's: the list in `docs/reference/release-notes.md` and the upgrade notes in `docs/CHANGELOG.md` (MSN-0246, MSN-0256; release highlights moved to the release notes in MSN-0270). After it merges:

```bash
git tag -a v<version> <merge-commit> -m "OpenGantry v<version>"
git push origin v<version>
```

The tag runs [`npm-publish.yml`](../.github/workflows/npm-publish.yml), which publishes `@jeger-ai/opengantry` and then `@jeger-ai/opengantry-cage`. Each publish goes through `scripts/npm-publish-if-new.sh` and is skipped when that version is already on npm.

- **Authentication is npm trusted publishing (MSN-0259).** npm exchanges the job's GitHub OIDC token for a short-lived publish token and attaches provenance; the workflow holds no npm token or secret and needs npm 11.5.1 or newer, which it checks. Each package needs a trusted publisher on npmjs.com, under the package's settings: provider **GitHub Actions**, repository **`jeger-ai/opengantry`**, workflow **`npm-publish.yml`**. A package without one fails to publish with an auth error (`E404`, `ENEEDAUTH`, `E401` or `EOTP`), and the script names the missing setting; there is no token to fall back to.
- **Why a publish was refused (MSN-0261):** after the `::error::` hint, the job log lists npm's own trusted-publishing lines for that package (the `oidc` lines from npm's debug log, nothing else from it). `Failed token exchange request with body message: …` means npm refused the exchange: the package has no trusted publisher, or a field differs from the workflow (organization, repository, workflow file name, environment), and the message says which. `Skipped because incorrect permissions for id-token within GitHub workflow` means the job lacks `id-token: write`. `Successfully retrieved and set token` means authentication worked and the failure is elsewhere in npm's output. No `oidc` lines means npm did not attempt trusted publishing (not running in GitHub Actions, or npm older than 11.5.1).
- **New packages:** trusted publishing can only be configured for a package that exists, so the first version of a new package is published by hand (below), then the trusted publisher is added before the next release.
- **Once releases publish from CI:** set both packages to disallow tokens on npmjs.com and delete any `NPM_TOKEN` repository secret.
- **Partial release:** if one package published and the other failed, do not re-run the tag run (it uses the workflow file at the tagged commit) and never move the tag. Fix the cause, then start a run from `main` with the tag. It refuses unless the tag matches `package.json` and everything that gets published on `main` is identical to the tag; the package already on npm is skipped. Provenance for that run names the `main` commit it used.

```bash
gh workflow run npm-publish.yml -f tag=v<version>
```

- **Emergency local publish** (no provenance): from a clean checkout of the tag, after `npm run build`, run `npm publish --access public` for the root package or add `--workspace @jeger-ai/opengantry-cage`. `publishConfig` no longer forces provenance, so this works outside CI; npm asks for two-factor approval in the browser or for `--otp <code>`.

## LLM evidence + KPI gate

Nondeterministic LLM checks produce **committed evidence**; merge stays deterministic:

1. Mission declares optional `llm_verifiers` + `kpi_gate` (see [`.gitagent/planner/MISSION.schema.yaml`](../.gitagent/planner/MISSION.schema.yaml)).
2. Executor runs **`gantry scan --mission …`** — each verifier command must print **JSON on stdout** (trailing whitespace/newlines tolerated). Success contract per verifier:
   - process exit code `0`
   - parseable JSON object with a non-empty `metrics` map (`Record<string, number | boolean>`)
   - optional `findings` array and `exit_code` field in JSON (fragment `exit_code` can raise report `exit_code` even when the process exits 0)
   - failed optional verifiers set `{id}::__verifier_ok: false` in the committed report; required verifiers fail the scan when the contract is not met
3. **`gantry verify`** runs shell `gate_command`, then evaluates `kpi_gate.thresholds` against [`.gitagent/kpi/MSN-NNNN.json`](../.gitagent/planner/KPI-REPORT.schema.yaml), then trace mapping.
4. KPI stale binding mirrors trace evidence: local warnings only; **`--pre-push`** / **`--ci`** fail-closed when TMVC drifts after the report commit.
5. **Advisory rubric findings** (`ARCHITECTURE_RUBRIC`, `PERFORMANCE_RUBRIC`) surface as `kpi_warnings` and structured `findings[]` on verify **PASS** — they never flip FAIL→PASS. See [ADR-0025](../.gitagent/out-of-scope/ADR-0025-architecture-rubric-judge.md) and [ADR-0035](../.gitagent/out-of-scope/ADR-0035-performance-rubric-judge.md). Example stub: [`examples/performance-judge/`](../examples/performance-judge/).
6. **`gantry register <dir>`** proposes skills from AST footprints; Planner still owns manifest edits (Rule 4.4).
7. **`gantry perimeter --ci`** in CI enforces verified signatures on protected paths (local mode is advisory).

See [ADR-0020](../.gitagent/out-of-scope/ADR-0020-kpi-llm-evidence-gate.md).

## Code repair (`verify --fix`, MSN-0047+)

Deterministic quarantine mutations for specific gate failures — an isolation layer, **not** a pass generator:

1. **`gantry verify --fix`** (interactive or `--non-interactive`) invokes a registered **code repair** when gate output matches a known failure:
   - **`GXT_BANNED_IMPORT_DETECTED`** — `gantry check-imports` stderr
   - **`GXT_IMPORT_LAYER_VIOLATION`** — `check-import-layers.mjs --json` structured report
2. The repair **quarantines** the offending import via TypeScript AST: removes the live `import` declaration, injects `GXT-SURGEON-QUARANTINE` markers and lazy Proxy roadblocks (no silent deletion).
3. On mutation, append **`[SURGEON-MUTATION] …`** to `EXECUTOR_LOG.md` (the marker keeps its historical name, like the `GXT-SURGEON-QUARANTINE` code markers, so existing logs and quarantined files stay recognizable), then **rerun the full verify pipeline with `--fix` disabled**.
4. Plain `gantry verify` (no `--fix`) remains fail-closed and never mutates TMVC.

**Language boundary:** verify core phases (`git_proof`, `gate`, `kpi`, `trace`) are language-agnostic. Native repairs require TypeScript in the adopter workspace (or gantry package root); unresolved `typescript` disables the repair paths only — core verify still runs.

**Import-layer JSON contract:** `node scripts/check-import-layers.mjs --json <files…>` emits `{ schema_version, ok, violations[] }` with stable `rule_id` values. Repairs parse JSON only — not human stderr.

Implementation: [`src/cli/lib/repairs/`](../src/cli/lib/repairs/) registry, [`src/cli/lib/repair.ts`](../src/cli/lib/repair.ts) log and gate-report helpers, orchestration in `src/cli/lib/verify/verify-presenters.ts`.

**Release:** see [`CHANGELOG.md`](CHANGELOG.md) § Maintainers for npm publish and release-squash policy.

## Definition of done (OpenGantry repo)

- [ ] Mission under `.gitagent/missions/` with Planner `[MSN-…]` commit when GXT paths or behavior changed
- [ ] `EXECUTOR_LOG.md` trace lines match mission PASS rows (or `gantry verify` on your mission passes)
- [ ] `npm run validate` passes
- [ ] Rule 4.4: manifest skill keys ↔ `skills/*.md` in the same change set when skills change
- [ ] `.gitagent/ARCHITECTURE.pointer.yaml` resolved and layer rules respected for `src/cli` edits
- [ ] When changing agent integration surfaces: bump `templates/integrations/compatibility.json` `verified_date` + recipe fragments in the same PR

## CI parity

Pull requests run [`.github/workflows/gxt-validate.yml`](../.github/workflows/gxt-validate.yml):

| Job | What it enforces |
|-----|------------------|
| `pr_governance` | PRs must target the integration branch (`main` here; `default_branch` in init template; override via repo variable `GXT_INTEGRATION_BRANCH`) — blocks stacked mission PRs |
| `manifest` | `gantry check`, unit tests, `gantry doctor`, `gantry perimeter --ci` on PRs |
| `code_quality` | Changed-code gates (`check-changed-code.sh`) on PR diff |
| `msn_commits` | `[MSN-NNNN]` on commits touching MSN-enforced paths (substrate + MANIFEST `tmvc_roots`); or valid `gxt-bypass` note; or repository `trusted_automation` policy (`gantry ci trusted-automation --commit <sha>`); runs as `gantry ci msn-range` |
| `mission_verify` | Mission purity (one `[MSN-NNNN]` per `${base}..${head}`); full `gantry verify` on each mission file in triple-dot diff; fails if protected paths change without a mission file unless `trusted_automation` policy passes (`gantry ci trusted-automation --base … --head …`); runs as `gantry ci verify-missions`. Installs the iii integration example's dependencies first when `examples/iii-integration/package-lock.json` exists, as does `gxt-attest-ingest.yml`, so mission gates that run its offline validator work (MSN-0263) |

Pull requests and pushes to `main` also run [`.github/workflows/cage-macos.yml`](../.github/workflows/cage-macos.yml): the job `cage (macos-latest)` runs every cage suite and the slim `@jeger-ai/opengantry-cage` tests on macOS, because the cage's users mostly run it there and every other job runs on Ubuntu (MSN-0265). It has no path filter so it reports on every PR; make it a required status check on `main`. It is repository-only and not shipped by `gantry init` or `upgrade`.

Local `npm run validate` is the full superset (includes `gantry ci verify-missions` + `gantry ci msn-range` vs `origin/main`). Run it before you open a PR.

`gantry init` ships the workflow when CI is enabled; it calls `gantry ci msn-range` and `gantry ci verify-missions` (ADR-0052 step 5b). Existing installs: run `gantry upgrade apply` or re-init managed CI assets.

## Troubleshooting verify / hooks

- Run the CLI from the repo root: `npm run gantry -- verify --mission .gitagent/missions/<file>.yaml` (after `npm run build`). Policy failures print a one-line error plus **`Fix:`** remediation hints — not stack traces.
- Set `GANTRY_DEBUG=1` only when you need a stack trace for an unexpected error.
- **Build output (MSN-0273):** `tsc` never deletes outputs, so a renamed or deleted `src/<path>.ts` used to leave `dist/<path>.js` behind: `npm test` ran stale compiled tests (a shared checkout counted 10 extra) and a hand `npm publish` would ship stale modules, since the package publishes `dist/`. `npm run build` now runs `scripts/prune-dist.mjs` right after `tsc`, which removes only compiled files whose source is gone and the directories that leaves empty. It deliberately does not wipe `dist/` first: when several sessions share a checkout, an empty `dist/` breaks every hook, test run or MCP server using it mid-build. The slim package build keeps only its two outputs. `./scripts/npm-pack-check.sh` fails on a tarball file without a source; `PACK_CHECK_SKIP_BUILD=1 ./scripts/npm-pack-check.sh` checks the current `dist/` without rebuilding, which is what a publish from this working copy would ship.
- **Gates and linked worktrees (MSN-0266):** git sets `GIT_DIR` for hooks run in a linked worktree (a plain checkout gets none). Before MSN-0266 the pre-push gate inherited it, and `npm test` fixtures that ran git in temp dirs acted on the real repository: on 2026-10-15 they set `core.bare=true`, a Fixture identity, fixture planner emails and `commit.gpgsign=false` in `.git/config`, committed fixture commits onto the branch, and pushed to `origin` (a fixture root commit over `main`, plus `evil-branch`). The gate runner, the streaming gate runner, `gitChildEnv`, the test preload and the slim package test helpers now drop `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES` and `GIT_NAMESPACE`; `src/cli/tests/gate-git-env.test.ts` replays the incident. Pushing from a linked worktree is safe again once your checkout includes this fix. If a push from a worktree ever leaves `git status` failing with "must be run in a work tree", check `.git/config` for `core.bare`, a Fixture `user.*` and stray `gantry.planneremails` before anything else.

## Smoke checklist (this repo)

1. `npm run build && npm test`
2. `./scripts/check-changed-code.sh origin/main HEAD` (when you changed `src/cli`)
3. `gantry doctor` → exit 0 with warnings allowed
4. Formatter drift: `gantry verify` passes without `--fuzzy-trace`
5. `gantry metrics --json` identical on two consecutive runs at same ref (including `gxt_extension_metadata`)

## Code quality (changed files only)

PRs run `./scripts/check-changed-code.sh <base> <head>` (also `npm run check:changed` locally against `origin/main`).

Deterministic **documentation** gates (repo-wide, not diff-scoped) run in `dev-validate-core`:

- `./scripts/assert-docs-deterministic.sh` — published doc inventory, `docs/index.md` link integrity, doc-surface legacy naming drift
- `./scripts/assert-no-stale-cli-naming.sh` — implementation-path legacy naming drift (`src/`, `scripts/`, hooks, examples)

- ESLint complexity and function length on touched `src/cli/**/*.ts`
- Import layer rules (`lib` must not import `commands`, etc.)
- File line budgets for non-grandfathered paths (see [docs/ARCHITECTURE.md](ARCHITECTURE.md))

**If CI fails:**

```bash
npm run lint -- path/to/changed.ts
./scripts/check-changed-code.sh origin/main HEAD
```
