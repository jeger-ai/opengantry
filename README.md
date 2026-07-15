# OpenGantry

**OpenGantry is a platform for Autonomous Repository Engineering** — AI-assisted product delivery where every material agent change is scoped before execution, verified by deterministic gates, and traceable in Git before merge.

It is **not** a real-time conversational agent wrapper. Use OpenGantry when you need auditable, mission-scoped repository work with explicit Planner approval and forensic trace.

> **Not [Gantry.io](https://gantry.io)?** **Open Source Gantry** is the **`gantry` CLI** for **local-first**, **vendor-neutral**, **git-native governance** in your repository — not a hosted observability dashboard. If you are looking for infrastructure monitoring, see [Gantry.io](https://gantry.io).

Use OpenGantry when you need:

- **Agent-assisted product delivery without silent scope creep:** keep velocity while forcing explicit mission scope and path boundaries.
- **Evidence for regulated or security-sensitive change control:** keep verifiable proofs in Git (`[MSN-XXXX]`, deterministic gate outputs, trace quotes).
- **A reusable governance layer across many repos:** apply one Git-native workflow instead of building custom policy glue per project.

### What you get in production

- **Review before run:** executors do not complete the loop until a human-approved mission defines scope, gates, and trace rows.
- **No silent governance edits:** hooks and `gantry verify` fail closed on law, manifest, and mission paths without a Planner `[MSN-XXXX]` commit.
- **Audit in Git:** `git log --grep='MSN-0042'` plus `EXECUTOR_LOG.md` quotes that verifiers must cite verbatim.

**Protocol (implementers):** under the hood, **GXT (Git-native eXecution and Trace)** binds law, Foreman routing, deterministic gates, and trace mapping to `EXECUTOR_LOG.md`. This repository is both the **specimen** and the **template**. Run **`gantry init`** (or **`gantry init --tutorial`**) in your repo and adapt it.

## Gantry CLI — local-first governance

**Open Source Gantry** ships as the **Gantry CLI** (`npm install -g @jeger-ai/opengantry`). Governance runs **in your repo** — missions, deterministic gates, and **Gantry Git hook** enforcement (`.githooks/`, IDE hooks) — without routing agent work through a vendor cloud dashboard.

| Goal | Read first |
|------|------------|
| **Install + first mission** | [Install](#install) → [`docs/ADOPTION.md`](docs/ADOPTION.md) → [`docs/KATA.md`](docs/KATA.md) |
| **Gantry CLI command reference** | [gantry CLI](#gantry-cli) |
| **Git hooks + enforcement** | [Enforcement boundary](#enforcement-boundary) · [`docs/ADOPTION.md`](docs/ADOPTION.md) § Prevent unreviewed edits |
| **Wire IDE agents** | [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) |

## Install

Requires **Node.js 24+**.

```bash
npm install -g @jeger-ai/opengantry
gantry init --tutorial
```

Or without a global install:

```bash
npx @jeger-ai/opengantry init --tutorial
```

Developing this repository from source: `npm ci && npm run build` — see [gantry CLI](#gantry-cli) and [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

*Want to see the ROI? Run `npm run examples:benchmark` to compare an orchestrator specimen (improvised agent glue) against OpenGantry's TMVC protocol.* (Requires clone + `npm run build` — see [`docs/ADOPTION.md`](docs/ADOPTION.md).)

## Documentation map (start here)

| Goal | Read first |
|------|------------|
| **Gantry CLI + local governance** | [Gantry CLI — local-first governance](#gantry-cli--local-first-governance) → [gantry CLI](#gantry-cli) |
| **Adopt in your repo (5 min)** | This README → [`docs/ADOPTION.md`](docs/ADOPTION.md) → [`docs/KATA.md`](docs/KATA.md) |
| **See benchmark ROI (3 min)** | [`examples/benchmark-agent/`](examples/benchmark-agent/) → [`docs/ADOPTION.md`](docs/ADOPTION.md) |
| **Wire IDE agents** | [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) |
| **Contribute / dogfood** | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) |
| **Governance law + workflow** | [`.gitagent/README.md`](.gitagent/README.md) · [`.gitagent/planner/RULES.md`](.gitagent/planner/RULES.md) |
| **Roadmap / open work** | [`docs/BACKLOG.md`](docs/BACKLOG.md) |
| **Compliance framing** | [`docs/COMPLIANCE-ISO.md`](docs/COMPLIANCE-ISO.md) |
| **Ephemeral virtualization (stretch)** | [`docs/ADR-EPHEMERAL-VIRTUALIZATION.md`](docs/ADR-EPHEMERAL-VIRTUALIZATION.md) |

## Why teams adopt this

| Outcome | How OpenGantry delivers it |
|---------|---------------------------|
| **Lower onboarding friction** | `gantry init --tutorial`, `gantry onboarding`, `gantry start "<intent>"`, `gantry status --json` |
| **No unreviewed agent scope** | Planner reviews mission YAML **before** `runtime env` / executor execution; TMVC roots + forbidden zones enforce paths |
| **Audit-ready evidence** | `[MSN-XXXX]` commit subjects; verifier PASS requires a verbatim quote from `EXECUTOR_LOG.md` |
| **Regulated / ISO-aligned workflows** | SOD, mission authorization, and Git-native trace — see [`docs/COMPLIANCE-ISO.md`](docs/COMPLIANCE-ISO.md) (27001 change control, 42001 AI governance) |
| **Faster recovery from failure** | Stable `GXT_*` error codes, `gantry verify --fix`, role output via `--audience executor\|planner\|verifier` |

**Protocol maturity:** substrate law **v0.5.0**; **`gantry` v2.6.0** — unified CLI naming (`gantry` primary; legacy `gapman` alias). Current npm publish: **v2.6.0**. See [.gitagent/planner/RUNTIME.md](.gitagent/planner/RUNTIME.md).

## Release timeline (latest first)

Current npm release in this repository: **`gantry` v2.6.0**. Use [`docs/ADOPTION.md`](docs/ADOPTION.md) for the ordered runbook.

| Release | Highlights |
|---------|------------|
| **v2.6.0** | Defensive profile completion — presets + severity tiers (ADR-0029), file-scope / churn / test-to-code guards ([#88](https://github.com/jeger-ai/opengantry/issues/88)–[#91](https://github.com/jeger-ai/opengantry/issues/91)), init onboarding ([#86](https://github.com/jeger-ai/opengantry/issues/86)) |
| **v2.5.0** | Adopter-ready cage — generic `arch check` roots ([#114](https://github.com/jeger-ai/opengantry/issues/114)), `TARGET_ARCHITECTURE.yaml` init scaffold ([#115](https://github.com/jeger-ai/opengantry/issues/115)), schema 0.2.0 ([#116](https://github.com/jeger-ai/opengantry/issues/116)), defensive profile + net LOC guard ([#87](https://github.com/jeger-ai/opengantry/issues/87), [#90](https://github.com/jeger-ai/opengantry/issues/90)) |
| **v2.4.0** | Architecture cage — `gantry arch fetch` ([#34](https://github.com/jeger-ai/opengantry/issues/34)), `verify --format sarif\|junit` ([#36](https://github.com/jeger-ai/opengantry/issues/36)), `TARGET_ARCHITECTURE.yaml` + `gantry arch check` ([#15](https://github.com/jeger-ai/opengantry/issues/15)), `ARCHITECTURE_RUBRIC` advisory judge ([#16](https://github.com/jeger-ai/opengantry/issues/16)) |
| **v2.3.1** | **Breaking:** Planner/Executor rename ([#110](https://github.com/jeger-ai/opengantry/issues/110)) — `gantry planner`, `.gitagent/planner/`, `EXECUTOR_LOG.md`, `GXT_PLANNER_*` / `GXT_EXECUTOR_*` env vars (no aliases). ADR-gated cage: MCP write guard ([#14](https://github.com/jeger-ai/opengantry/issues/14)), break-glass ADR ([#17](https://github.com/jeger-ai/opengantry/issues/17)), optional `planner_signature` tier ([#37](https://github.com/jeger-ai/opengantry/issues/37)) |
| **v2.3.0** | Cage hardening — `gen:dogfood` ([#105](https://github.com/jeger-ai/opengantry/issues/105)), typed `kpiKind` ([#103](https://github.com/jeger-ai/opengantry/issues/103)), audience-tagged start ([#104](https://github.com/jeger-ai/opengantry/issues/104)), doctor EXECUTOR_LOG checks ([#38](https://github.com/jeger-ai/opengantry/issues/38)), TS/mjs parity ([#106](https://github.com/jeger-ai/opengantry/issues/106)), verify failure contract ([#102](https://github.com/jeger-ai/opengantry/issues/102)), legislate forbidden-zone warn ([#35](https://github.com/jeger-ai/opengantry/issues/35)); removed deprecated `upgrade --apply`/`--dry-run` parent flags |
| **v2.2.5** | Quality remediation — recursive test glob ([#99](https://github.com/jeger-ai/opengantry/issues/99)), dead verify code prune ([#100](https://github.com/jeger-ai/opengantry/issues/100)–[#101](https://github.com/jeger-ai/opengantry/issues/101)), mechanical cleanups ([#107](https://github.com/jeger-ai/opengantry/issues/107)) |
| **v2.2.4** | Unified gantry naming cutover ([#94](https://github.com/jeger-ai/opengantry/issues/94)); docs positioning — Gantry.io disambiguation, long-tail SEO (`Open Source Gantry`, `Gantry CLI`, `Gantry Git hook`), vendor-neutral local governance framing ([#95](https://github.com/jeger-ai/opengantry/issues/95)–[#97](https://github.com/jeger-ai/opengantry/issues/97)) |
| **v2.2.3** | Declarative `trusted_automation` policy in `.gitagent/config.json` — repository-legislated bot maintenance bypass with `max_net_loc <= 5` ([#92](https://github.com/jeger-ai/opengantry/issues/92)) |
| **v2.2.2** | Time-to-Scaffold benchmark — `npm run examples:benchmark`, measured LOC matrix, adoption discovery ([#79](https://github.com/jeger-ai/opengantry/issues/79)) |
| **v2.2.1** | Thermo remediation — unified `NormalizedVerifyFailure` contract across JSON/human/context-feed; race-safe remediation snapshot writes; canonical `verify-presentation` entrypoint |
| **v2.2.0** | `gantry context-feed`, `gantry audit-rigor`, `virtual_capture` ephemeral virtualization ([#68](https://github.com/jeger-ai/opengantry/issues/68)), product positioning, docs quality ([#66](https://github.com/jeger-ai/opengantry/issues/66)–[#69](https://github.com/jeger-ai/opengantry/issues/69), [#76](https://github.com/jeger-ai/opengantry/issues/76)) |
| **v2.1.0** | Import-layer Code Surgeon (`check-import-layers.mjs --json`, AST quarantine, `GXT_IMPORT_LAYER_VIOLATION`); workspace-resolved optional TypeScript for surgeons |
| **v2.0.0** | `gantry scan` + KPI gate, `register`, `check-imports`, `perimeter`; BYO `llm_verifiers`; KPI stale binding on `--pre-push`/`--ci` |
| **v1.1.2** | Verify pipeline close-out (MSN-0034–0035); typed verify phases, trace status at parse boundary |
| **v1.1.1** | Lib/command boundary, unified `runVerifyCore`, typed remediation, CommandReporter, mission YAML emitter |
| **v1.1.0** | Stale trace evidence, mission purity PR lock, CI target lock, `verify --json`, doctor substrate drift warn |
| **v1.0.0** | `gantry init --tutorial`, global `--audience` / `GXT_AUDIENCE`, adoption-first README + runbook |
| **v0.9.0** | `gantry start`, `verify --fix`, `status --json`, `onboarding`, GXT error codes |

## What you get

| Idea | Where it lives |
|------|----------------|
| **Law** (SOD, trace mapping, risk tiers, TMVC, manifest sync) | [`.gitagent/planner/RULES.md`](.gitagent/planner/RULES.md) |
| **Routing map** (skills, roots, forbidden zones, path risks) | [`.gitagent/foreman/MANIFEST.json`](.gitagent/foreman/MANIFEST.json) |
| **Foreman** (cheap, manifest-only triage) | [`.gitagent/foreman/SOUL.md`](.gitagent/foreman/SOUL.md) |
| **Executor Runtime Contract** (env exports for IDE agents / scripts) | [`.gitagent/planner/RUNTIME.md`](.gitagent/planner/RUNTIME.md) |
| **Bootstrap** (zero-friction substrate install) | `gantry init` + packaged [`templates/`](templates/) |
| **Architecture pointer** (where agents find code layout) | [`.gitagent/ARCHITECTURE.pointer.json`](.gitagent/ARCHITECTURE.pointer.json), [ARCHITECTURE-DISCOVERY.md](.gitagent/planner/ARCHITECTURE-DISCOVERY.md) |
| **Work order + commit receipt** | YAML via `gantry legislate` + [`.gitagent/planner/MISSION.example.yaml`](.gitagent/planner/MISSION.example.yaml); Markdown reference: [`.gitagent/planner/MISSION.template.md`](.gitagent/planner/MISSION.template.md), [`.gitagent/planner/commit-template.md`](.gitagent/planner/commit-template.md) |
| **gantry CLI** | `npm install -g @jeger-ai/opengantry` or `npx @jeger-ai/opengantry` — see [gantry](#gantry-cli) |
| **Full orientation + workflow diagram** | [`.gitagent/README.md`](.gitagent/README.md) |

Core behaviors in plain language:

- **Git-native missions:** commit subjects use **`[MSN-XXXX]`** so history is greppable (`git log --grep='MSN-0042'`).
- **Auditable execution log:** verifier PASS requires quotes from **`EXECUTOR_LOG.md`** (process control paired with SOD and deterministic gates).
- **Risk tiers:** cheap automation where safe; stricter human paths for sensitive areas.
- **Approved edit paths:** work under declared **tmvc_roots**; **forbidden zones** are hard stops; out-of-scope access needs a logged **context request**.
- **Honest limits:** trace mapping is **not cryptographic proof**—it records what ran under your reviewed mission (see [`.gitagent/planner/RULES.md`](.gitagent/planner/RULES.md)).

## Start here (5 minutes)

```bash
gantry init --tutorial    # or: gantry init && gantry onboarding
gantry planner set "$(git config user.email)"
gantry start "Your first change" --msn MSN-0001 --skill-key <manifest-key>
# Planner: review mission scope/gates, then commit [MSN-0001] including the mission file
git log --grep='MSN-' --oneline
```

### Human handbrake

If you do **not** review the **mission** under `.gitagent/missions/` **before** the executor runs, the trace records **what you allowed to happen**—not a substitute for intent checks. You still sign off on scope, TMVC roots, and the deterministic gate.

## Using this outside the OpenGantry repo

Treat the following as a **portable kit** you can drop into any Git repository (app, library, or monorepo).

### Enforcement boundary

**Prevents unreviewed edits where it matters.** IDE Agent Write/Edit is advisory TMVC; hard boundaries live in `runtime exec`, `gantry verify`, and hooks.

| Tier | Mechanism | Enterprise control |
|------|-----------|-------------------|
| **Process-boundary** | `gantry runtime exec` | Agent cannot touch forbidden paths during orchestrated runs |
| **Deterministic hook** | Cursor `beforeShellExecution`, pre-push verify | Shell/hook writes to governance files require mission + verify |
| **Advisory** | IDE rules, `AGENTS.md`, sessionStart context | IDE suggestions alone do not count as approval |

Per-tool recipes: [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) (see **Enforcement boundary**).

### 1. Bootstrap with `gantry init` (recommended)

From a built OpenGantry tree (or after copying the `gantry` CLI + `templates/` into your toolchain):

```bash
npm ci && npm run build   # in the OpenGantry repo, or use a globally linked gantry
gantry init --tutorial    # recommended first run; or gantry init (wizard / --yes)
gantry planner set "$(git config user.email)"             # repo-local (recommended)
gantry doctor
git config core.hooksPath .githooks
```

`gantry init` bootstraps a target git repository from packaged templates:

- **TTY:** interactive wizard (`@clack/prompts`) — select IDE/agent integrations, doc path, skills preset, hooks, CI, architecture pointer.
- **Non-TTY / CI:** auto-applies default profile (core + Cursor + hooks + CI) — no hang.
- **`--yes`:** default profile without prompts. **`--dry-run`:** print planned writes.
- **Flags:** `--ides cursor,claude-code`, `--docs-path`, `--skills minimal|specimen`, `--no-hooks`, `--no-ci`, `--arch-source`, `--arch-location`.

Asset lifecycles:

- `scaffold_only` files (for example `MANIFEST.json`, `RULES.md`, `skills/*.md`, IDE pointer files) are created when missing and preserved when customized.
- `managed_strict` runtime assets (workflow, validate script, hooks, schema/rules pointers) prompt before overwrite in an interactive terminal; use `--force` to skip the prompt.

Init also composes **`docs/INTEGRATIONS.md`** (or your chosen path) from `templates/integrations/compatibility.json`, scaffolds **`.gitagent/ARCHITECTURE.pointer.json`**, and installs runtime scripts (`gxt-runtime-env.sh`, `gxt-pin-mission.sh`, …). Store local tokens for protected architecture sources with **`gantry arch cred set`** (stdin only; git-ignored under `.gitagent/history/credentials/`).

After `init`, customize your manifest and skills, then legislate. See [`docs/ADOPTION.md`](docs/ADOPTION.md) for the exact ordered runbook.

### 2. Customize for your project

- Edit **[`.gitagent/foreman/MANIFEST.json`](.gitagent/foreman/MANIFEST.json)**  
  Set `path_risks`, `risk_keywords`, and each skill's `tmvc_roots`, `forbidden_zones`, and `trust_threshold` to match **your** directories and risk appetite.
- Align **[`.gitagent/planner/RULES.md`](.gitagent/planner/RULES.md)** with your review policy (tiers, who counts as "human audit", merge gates).
- Point **deterministic gates** in missions at **your** stack (`npm test`, `pytest`, `cargo test`, etc.).
- Store mission files you intend to **`gantry verify`** under **`.gitagent/missions/`** and configure **Planner allowlist** per repo (`gantry planner set`, `.gitagent/foreman/PLANNER.allowlist.local`, or `git config gantry.plannerEmails`).

**Concrete gate example** (YAML fields in a mission file; adjust paths and commands):

```yaml
gate_command: "npm test -- src/components/Button.test.tsx"
gate_success_substring: "Tests:       1 passed"
```

The gate is whatever command **fails closed** for your repo (lint, typecheck, integration suite). One explicit command beats a vague "run tests somewhere." Primary reference: [`.gitagent/planner/MISSION.example.yaml`](.gitagent/planner/MISSION.example.yaml). Markdown missions remain supported (`gantry verify` parses both); [`.gitagent/planner/MISSION.template.md`](.gitagent/planner/MISSION.template.md) is a human-readable reference, not the `legislate` default.

### gantry CLI

The **Gantry CLI** (`gantry`) is the primary interface for **Open Source Gantry** — local, vendor-neutral, git-native governance in your repository.

Requires **Node.js 24+** (Active LTS line). Published as **`@jeger-ai/opengantry`** on npm; the `gantry` binary is registered via `package.json` `bin` (see [`package.json`](package.json)). The legacy `gapman` command remains a compatibility alias (**deprecated** — will be removed in a future major release). Config namespaces: `GANTRY_*` env vars and `git config gantry.*` (legacy `GAPMAN_*` / `gapman.*` values are still read silently, also deprecated). From source: `npm ci && npm run build` → `dist/cli/index.js`.

**Developing OpenGantry:** dogfood the full stack — [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) (missions, hooks, verify, `npm run validate`). Layer rules: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Adopters: [`docs/ADOPTION.md`](docs/ADOPTION.md). Roadmap: [`docs/BACKLOG.md`](docs/BACKLOG.md) · [Project board](https://github.com/orgs/jeger-ai/projects/2).

**Adoption path:**

| Step | Command | Outcome |
|------|---------|---------|
| Onboard | `gantry init --tutorial` or `gantry onboarding` | Feel Planner stamp + verify loop (~3 min) |
| Scope + approve | `gantry start` → Planner `[MSN-…]` commit | Unreviewed stub cannot pass full verify |
| Prove work | `gantry verify` | Gate + log quotes + greppable history |

**Global output:** `gantry --audience executor\|planner\|verifier\|platform <cmd>` (or `GXT_AUDIENCE=verifier` in CI — silence unless `[GXT_*]` errors).

| Command | Purpose |
|--------|---------|
| `gantry init` | Bootstrap substrate + IDE packs + hooks + CI. `--tutorial` runs guided first loop after scaffold. |
| `gantry upgrade` | Plan substrate updates (`gantry upgrade plan` / `--dry-run` for preview JSON). Stage with `gantry upgrade`; `gantry upgrade apply --mission …` after Planner commit. |
| `gantry check` | Validate `MANIFEST.json` shape + **Rule 4.4** sync: every `manifest.skills` key must have `skills/<key>.md`, with no orphan skill files. |
| `gantry status` | GXT readiness dashboard (`--json`, `--verbose`, `--audience executor\|planner\|verifier\|platform`). |
| `gantry start "<intent>"` | Goal-first orchestration: triage → legislate stub → runtime next steps (`--msn`, `--skill-key`, `--json`). |
| `gantry onboarding` | Interactive walkthrough of the strict mission loop. Blocks on corrupt configured integration state; allows pristine uninitialized repos. |
| `gantry doctor` | Active readiness check (manifest, Planner email, bypass secret match, hooks, architecture pointer, integration staleness). Warnings exit 0. `--audience` tailors next steps. |
| `gantry triage "<intent>"` | Foreman-style routing ([`SOUL.md`](.gitagent/foreman/SOUL.md)). `--json` for machine output (may include non-binding `adr_hints` from [`.gitagent/out-of-scope/`](.gitagent/out-of-scope/README.md)). `--emit-mission --msn MSN-0007` writes `.gitagent/missions/ACTIVE_MISSION.md` by default on **DIRECT_EXECUTION** only. |
| `gantry planner show\|set` | Repo-local Planner git-proof allowlist (`.gitagent/foreman/PLANNER.allowlist.local`; avoids global `GANTRY_PLANNER_EMAILS` leaking across projects). |
| `gantry legislate "<intent>" --msn MSN-0007` | Emit stub **YAML** mission under `.gitagent/missions/` with explicit MSN (`--skill-key` when triage would escalate; `--gate-command` / `--gate-success-substring` for one-click handoff). Planner still **`git commit`**-legislates from an allowlisted email. |
| `gantry mission validate --file <path>` | Validate a mission `.md` or `.yaml` (YAML checked against [`.gitagent/planner/MISSION.schema.yaml`](.gitagent/planner/MISSION.schema.yaml)). |
| `gantry mission snapshot --file <path>` | Write start-state JSON under `.gitagent/history/` (git HEAD, branch, dirty flag, manifest hash, hashes of files under the mission skill's `tmvc_roots`). |
| `gantry runtime env --mission <path>` | Executor Runtime Contract: emit `GXT_REPO_ROOT`, `GXT_MISSION_FILE`, `GXT_MSN_ID`, `GXT_SKILL_KEY`, `GXT_TMVC_ROOTS`, `GXT_FORBIDDEN_ZONES`, `GXT_EXECUTOR_LOG`. Default: POSIX `export …` lines; `--json` for scripts. [.gitagent/planner/RUNTIME.md](.gitagent/planner/RUNTIME.md). |
| `gantry runtime exec --mission <path> -- <cmd…>` | Run executor command with mission env, telemetry capture, and forbidden-zone scan (strongest TMVC trap). |
| `gantry context-request --path <p…> --reason <text>` | Append a PENDING Context Request to `EXECUTOR_LOG.md` (RULES §4 TMVC expansion). Uses pinned mission or `--mission`. `--stage-worker-log` opt-in stages the log. |
| `gantry tmvc guard [--strict]` | Pre-commit TMVC path guard: advisory warnings on staged paths outside mission `tmvc_roots` (stderr; exit 0). `--strict` or `GXT_TMVC_GUARD_STRICT=1` blocks. Skips when no pinned mission. |
| `gantry mcp serve` | Stdio MCP server exposing `gxt_*` tools (legislation, pin, runtime env, verify with `fix_hints`, `gxt_start_orchestration`, exec). `gxt_verify` uses the flat `--json` envelope — see [ADOPTION.md § MCP verify envelope](docs/ADOPTION.md). Configure via `.cursor/mcp.json`. |
| `gantry verify --mission <path>` | Teacher-approved mission commit + gate + trace. **`--json`** structured output (`status`, `phase`, `error_code`, `fix_hints`). **`--fix`** guided repair; when a **Code Surgeon** applies a quarantine mutation, logs `[SURGEON-MUTATION]` to `EXECUTOR_LOG.md` and reruns full verify with fix disabled (never auto-PASS). CI: `--audience verifier` (errors only). Failures emit **`GXT_*`** codes. Optional **`kpi_gate`** phase reads committed [KPI report](.gitagent/planner/KPI-REPORT.schema.yaml) (after gate, before trace). **`--ci`** / **`--pre-push`**: fail-closed on stale KPI evidence. |
| `gantry scan --mission <path>` | Run mission `llm_verifiers` (BYO commands) and write namespaced KPI report JSON for `kpi_gate`. |
| `gantry register <dir>` | AST discovery: propose skill scope from folder imports/exports (does not mutate `MANIFEST.json`). |
| `gantry check-imports <dir> --ban <spec…>` | Deterministic banned-import scan (usable as `gate_command`; no LLM). |
| `gantry perimeter [--base-ref <ref>] [--ci]` | Protected governance paths: local advisory; **`--ci`** requires verified commit signatures. |
| `gantry arch pointer` | Print architecture pointer summary for agents (`.gitagent/ARCHITECTURE.pointer.json`). |
| `gantry arch fetch` | Fetch `kind=external` architecture docs into a local cache (doctor stays offline). |
| `gantry arch check` | Evaluate `TARGET_ARCHITECTURE.yaml` import/layer rules for TypeScript paths under configured roots. |
| `gantry arch cred status\|set\|unset` | Git-ignored credential slots for authenticated external architecture sources (secrets via stdin only). |
| `gantry metrics [--json] [--ref main]` | Git-native governance rollup (`--json` includes `gxt_extension_metadata`). See [`docs/ADOPTION.md`](docs/ADOPTION.md). |
| `gantry context-feed [--json] [--clear]` | Read or atomically clear the latest verify remediation snapshot (`.gitagent/tmp/NEXT_REMEDIATION.json`) for IDE repair loops. |
| `gantry audit-rigor [--json] [--strict]` | Meta-governance audit: TypeScript strictness, coverage artifacts, MANIFEST wildcard hygiene. |

**Who can approve missions (Planner allowlist):** only allowlisted identities can legislate missions that verify accepts. Precedence:

1. `.gitagent/foreman/PLANNER.allowlist` (+ optional gitignored `.local` merge)
2. `git config gantry.plannerEmails "a@x.com,b@y.com"`
3. `GANTRY_PLANNER_EMAILS` env (CI escape hatch only)
4. implicit `git config user.email` when nothing else is set

Use **`gantry planner set "$(git config user.email)"`** after clone — do not rely on a global shell export when you work across multiple projects.

### Executor Runtime quickstart

Agents (Cursor, Junie, local scripts) should not guess TMVC roots — read them from **`gantry runtime env`**.

Each `--mission` path must refer to **an existing mission file** (ENOENT means the YAML or Markdown mission is missing). Split these into separate shell steps if you paste from docs.

```bash
npm ci && npm run build

# Existing mission (tracked example — swap for yours after Planner legislates it):
eval "$(node dist/cli/index.js runtime env --mission .gitagent/missions/example.verify.yaml)"

# Or machine-readable JSON for a wrapper script:
node dist/cli/index.js runtime env --mission .gitagent/missions/example.verify.yaml --json

# Headless / CI — strongest TMVC trap:
node dist/cli/index.js runtime exec --mission .gitagent/missions/example.verify.yaml -- <your-agent-command>
```

Inspect `GXT_TMVC_ROOTS`, `GXT_FORBIDDEN_ZONES`, and `GXT_EXECUTOR_LOG`; write forensic trace quotes to **`EXECUTOR_LOG.md`** (or `--executor-log` at verify time), then **`gantry verify`** as usual.

**Legislate a stub mission (Planner edits + commits — then wire `runtime env` to that file path):**

```bash
node dist/cli/index.js legislate "Fix login spinner on checkout — ui" --msn MSN-0007 --skill-key ui
# Planner: tune gate/trace rows; git commit -m "[MSN-0007] legislate …" including the mission file
# eval "$(node dist/cli/index.js runtime env --mission .gitagent/missions/MSN-0007.<slug>.yaml)"
```

Details and variable semantics: [.gitagent/planner/RUNTIME.md](.gitagent/planner/RUNTIME.md).

### 3. Wire agents (and optionally CI)

- **[`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)** — closed-loop agent integrations (enforcement boundary, remote handoff, per-tool recipes for Cursor, Claude Code, OpenAI Codex CLI, OpenCode, Junie, Antigravity, Cline, Aider, OpenHands). Installed by `gantry init`.
- **[`AGENTS.md`](AGENTS.md)** tells agents to read **RULES** + **MANIFEST** before acting.
- **[`.cursor/rules/opengantry-gxt-substrate.mdc`](.cursor/rules/opengantry-gxt-substrate.mdc)** does the same for Cursor with `alwaysApply: true`.
- **CI:** this repo includes **[`.github/workflows/gxt-validate.yml`](.github/workflows/gxt-validate.yml)**:
  - **PR governance (PR only):** mission PRs must target the **default branch** (`main` in this repo; `github.event.repository.default_branch` in init template, overridable via `GXT_INTEGRATION_BRANCH`) — prevents stacked mission merges.
  - **gantry:** `npm ci` / `npm run build`, then `gantry check`, `gantry doctor`, and unit tests.
  - **Manifest (jq parity):** validates [`.gitagent/foreman/MANIFEST.json`](.gitagent/foreman/MANIFEST.json) via [`scripts/validate-gxt.sh`](scripts/validate-gxt.sh) `manifest`.
  - **Changed-code quality (PR only):** ESLint complexity, import layers, line budgets on touched `src/cli/**/*.ts`.
  - **MSN (PR only, path-scoped):** on **pull_request** only, any **non-merge** commit in the PR range that touches `.gitagent/`, repo-root `EXECUTOR_LOG.md`, `.githooks/`, or [`.github/workflows/gxt-validate.yml`](.github/workflows/gxt-validate.yml) must have a subject starting with **`[MSN-NNNN]`** (four digits). Other paths (e.g. root `README.md` only) do not trigger this check.
  - **Mission purity (PR only):** [`scripts/verify-pr-missions.sh`](scripts/verify-pr-missions.sh) requires exactly one `[MSN-NNNN]` in `${base}..${head}` commit subjects before full `gantry verify` on changed missions.
- **Local (full stack):** [`scripts/dev-validate.sh`](scripts/dev-validate.sh) / `npm run validate` — superset of CI (includes changed-code + MSN vs `origin/main`).

```bash
npm ci && npm run build
node dist/cli/index.js check
node dist/cli/index.js doctor
./scripts/validate-gxt.sh manifest
./scripts/validate-gxt.sh msn origin/main HEAD   # after: git fetch origin
# or full local stack:
npm run validate
```

### 4. Run the loop (human + models)

High level: **Foreman** routes → **Planner** authors a mission when needed → **Worker** executes inside TMVC and writes **`EXECUTOR_LOG.md`** → **deterministic gate** runs → **Verifier** maps passes to the log → commits follow **`[MSN-XXXX]`** + receipt template.

Details and the workflow diagram: **[`.gitagent/README.md`](.gitagent/README.md)**.

### Advanced: manual vendoring

If you cannot run `gantry init`, copy at least:

- `.gitagent/` (entire tree)
- `skills/` (optional in minimal vendoring, but **required** for Rule 4.4: one `skills/<skill-key>.md` per manifest skill — enforced by `gantry check`)
- `.githooks/` (optional: creates an empty repo-root `EXECUTOR_LOG.md` when you check out a feature branch)
- `AGENTS.md` (or merge its bullets into your existing agent instructions)
- Optionally `.cursor/rules/opengantry-gxt-substrate.mdc` if you use Cursor

Add to your **`.gitignore`** (if not already present):

```gitignore
# OpenGantry local forensic bulk (optional)
.gitagent/history/
```

**Empty `EXECUTOR_LOG.md` on branch checkout:** after copying, point Git at the vendored hooks once per clone (`git config core.hooksPath .githooks`). On branch checkouts **other than** `main` or `master`, if `EXECUTOR_LOG.md` is missing at the repo root, [`.githooks/post-checkout`](.githooks/post-checkout) copies [`.gitagent/planner/EXECUTOR_LOG.template.md`](.gitagent/planner/EXECUTOR_LOG.template.md) into place. It **never overwrites** an existing file. Keep formatters off `EXECUTOR_LOG.md` — see [docs/ADOPTION.md](docs/ADOPTION.md) (formatter guard under stale trace evidence).

## Staying in sync

**Primary path (npm):** install or update the CLI package, then apply bundled substrate changes in your repo:

```bash
npm install @jeger-ai/opengantry@latest
gantry upgrade
# Review .gitagent/.upgrade-tmp/; Planner-commit the upgrade mission YAML
gantry upgrade apply --mission .gitagent/missions/MSN-9001.upgrade-vX.Y.Z.yaml
gantry doctor
```

See [`docs/ADOPTION.md`](docs/ADOPTION.md) and [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#substrate-upgrade-loop-adopters--dogfood).

**Alternative — vendor `.gitagent/` without npm** (no Node required in the host repo):

**Option A — `git subtree` (good if you vendored `.gitagent/` with subtree in the first place)**

```bash
git remote add opengantry-upstream https://github.com/jeger-ai/opengantry.git  # once
git fetch opengantry-upstream
git subtree pull --prefix=.gitagent opengantry-upstream main --squash
```

Resolve conflicts carefully: **keep your** `MANIFEST.json` edits; **merge in** upstream changes to shared files like `RULES.md` or templates.

**Option B — side-by-side clone + copy**

```bash
git clone https://github.com/jeger-ai/opengantry.git /tmp/opengantry && \
  diff -ru .gitagent /tmp/opengantry/.gitagent | less
# Then selectively copy files you want (e.g. RULES.md) without overwriting your manifest.
```

**Option C — `curl` / raw URLs (surgical, fragile)**

Fetch a single file from `main` when you only want the latest template text:

```bash
curl -fsSL -o .gitagent/planner/MISSION.example.yaml \
  https://raw.githubusercontent.com/jeger-ai/opengantry/main/.gitagent/planner/MISSION.example.yaml
```

Always **review the diff** before commit; never bulk-overwrite a customized `MANIFEST.json`.

## OpenGantry Ledger — how GXT fits the landscape

| Pattern | Typical shape | Audit / production readiness |
|---------|----------------|------------------------------|
| **GXT / OpenGantry** | Git-native missions, manifest routing, deterministic gates, auditable log mapped to **`EXECUTOR_LOG.md`**, human `[MSN-XXXX]` approval + SOD ([`RULES.md`](.gitagent/planner/RULES.md)) | **Autonomous Repository Engineering** — scoped missions, not always-on chat. Greppable missions + gate output + log quotes. **Local-first**, **vendor-neutral** governance engine in your repo. |
| Cloud observability / agent dashboards | Hosted UI for metrics, traces, or agent session visibility | Strong for **fleet visibility**; per-repo change authorization and Git-native audit artifacts are typically layered separately |
| Agent "swarm" / choreography layers | Orchestrates model calls across services; emphasizes throughput and parallelism | Strong on **coverage** of tasks; lineage and per-change evidence depends on tooling above the swarm |
| Unstructured desktop assistants | Reactive help in-editor or OS-wide; informal plans | Lightweight for exploration; weakest default for **reproducible** production sign-off without additional discipline |

GXT deliberately trades "always-on improvisation" for a **narrow, inspectable envelope**: Foreman chooses a skill footprint, Teachers legislate commits, Executors stay inside TMVC (or Context Request → accept/reject), and Verifiers bind PASS claims to log quotes.

## Relationship to this repository

**jeger-ai/opengantry** is the **canonical reference tree** for **GXT** (manifest `schema_version` **v0.5.0** law + **`gantry` v2.6.0** CLI). Install the CLI with `npm install -g @jeger-ai/opengantry`, or fork this repo and run `gantry init` in your project.

## Security

Supported versions and how to report vulnerabilities: [`SECURITY.md`](SECURITY.md).

## License

OpenGantry is licensed under the **Apache License, Version 2.0**. See [`LICENSE`](LICENSE). Attribution and copyright notice: [`NOTICE`](NOTICE).
