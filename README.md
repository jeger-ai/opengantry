# OpenGantry

**Insurance for autonomous code** — OpenGantry helps teams **prevent unreviewed AI scope**, **block edits outside approved paths**, and **produce greppable audit evidence in plain Git**—without a proprietary runtime.

### What you get in production

- **Review before run:** workers do not complete the loop until a human-approved mission defines scope, gates, and trace rows.
- **No silent governance edits:** hooks and `gapman verify` fail closed on law, manifest, and mission paths without a Teacher `[MSN-XXXX]` commit.
- **Audit in Git:** `git log --grep='MSN-0042'` plus `WORKER_LOG.md` quotes that verifiers must cite verbatim.

**Protocol (implementers):** under the hood, **GXT (Git-native eXecution and Trace)** binds law, Foreman routing, deterministic gates, and trace mapping to `WORKER_LOG.md`. This repository is both the **specimen** and the **template**. Run **`gapman init`** (or **`gapman init --tutorial`**) in your repo and adapt it.

## Install

Requires **Node.js 24+**.

```bash
npm install -g @jeger-ai/opengantry
gapman init --tutorial
```

Or without a global install:

```bash
npx @jeger-ai/opengantry init --tutorial
```

Developing this repository from source: `npm ci && npm run build` — see [gapman CLI](#gapman-cli) and [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Why teams adopt this

| Outcome | How OpenGantry delivers it |
|---------|---------------------------|
| **Lower onboarding friction** | `gapman init --tutorial`, `gapman onboarding`, `gapman start "<intent>"`, `gapman status --json` |
| **No unreviewed agent scope** | Teacher reviews mission YAML **before** `runtime env` / worker execution; TMVC roots + forbidden zones enforce paths |
| **Audit-ready evidence** | `[MSN-XXXX]` commit subjects; verifier PASS requires a verbatim quote from `WORKER_LOG.md` |
| **Faster recovery from failure** | Stable `GXT_*` error codes, `gapman verify --fix`, role output via `--audience worker\|teacher\|verifier` |

**Protocol maturity:** substrate law **v0.5.0**; **`gapman` v1.0.0** — enterprise onboarding, contextual output, first-run tutorial. See [.gitagent/teacher/RUNTIME.md](.gitagent/teacher/RUNTIME.md).

## v1.0 adoption release

`v1.0.0` productizes the specimen: first-run tutorial, global `--audience` output modes, and docs framed for enterprise adoption. Use [`docs/ADOPTION.md`](docs/ADOPTION.md) for the ordered runbook.

| Release | Highlights |
|---------|------------|
| **v0.9.0** | `gapman start`, `verify --fix`, `status --json`, `onboarding`, GXT error codes |
| **v1.0.0** | `gapman init --tutorial`, global `--audience` / `GXT_AUDIENCE`, adoption-first README + runbook |

## What you get

| Idea | Where it lives |
|------|----------------|
| **Law** (SOD, trace mapping, risk tiers, TMVC, manifest sync) | [`.gitagent/teacher/RULES.md`](.gitagent/teacher/RULES.md) |
| **Routing map** (skills, roots, forbidden zones, path risks) | [`.gitagent/foreman/MANIFEST.json`](.gitagent/foreman/MANIFEST.json) |
| **Foreman** (cheap, manifest-only triage) | [`.gitagent/foreman/SOUL.md`](.gitagent/foreman/SOUL.md) |
| **Worker Runtime Contract** (env exports for IDE agents / scripts) | [`.gitagent/teacher/RUNTIME.md`](.gitagent/teacher/RUNTIME.md) |
| **Bootstrap** (zero-friction substrate install) | `gapman init` + packaged [`templates/`](templates/) |
| **Architecture pointer** (where agents find code layout) | [`.gitagent/ARCHITECTURE.pointer.json`](.gitagent/ARCHITECTURE.pointer.json), [ARCHITECTURE-DISCOVERY.md](.gitagent/teacher/ARCHITECTURE-DISCOVERY.md) |
| **Work order + commit receipt** | YAML via `gapman legislate` + [`.gitagent/teacher/MISSION.example.yaml`](.gitagent/teacher/MISSION.example.yaml); Markdown reference: [`.gitagent/teacher/MISSION.template.md`](.gitagent/teacher/MISSION.template.md), [`.gitagent/teacher/commit-template.md`](.gitagent/teacher/commit-template.md) |
| **gapman CLI** | `npm install -g @jeger-ai/opengantry` or `npx @jeger-ai/opengantry` — see [gapman](#gapman-cli) |
| **Full orientation + workflow diagram** | [`.gitagent/README.md`](.gitagent/README.md) |

Core behaviors in plain language:

- **Git-native missions:** commit subjects use **`[MSN-XXXX]`** so history is greppable (`git log --grep='MSN-0042'`).
- **Auditable execution log:** verifier PASS requires quotes from **`WORKER_LOG.md`** (process control paired with SOD and deterministic gates).
- **Risk tiers:** cheap automation where safe; stricter human paths for sensitive areas.
- **Approved edit paths:** work under declared **tmvc_roots**; **forbidden zones** are hard stops; out-of-scope access needs a logged **context request**.
- **Honest limits:** trace mapping is **not cryptographic proof**—it records what ran under your reviewed mission (see [`.gitagent/teacher/RULES.md`](.gitagent/teacher/RULES.md)).

## Start here (5 minutes)

```bash
gapman init --tutorial    # or: gapman init && gapman onboarding
gapman teacher set "$(git config user.email)"
gapman start "Your first change" --msn MSN-0001 --skill-key <manifest-key>
# Teacher: review mission scope/gates, then commit [MSN-0001] including the mission file
git log --grep='MSN-' --oneline
```

### Human handbrake

If you do **not** review the **mission** under `.gitagent/missions/` **before** the worker runs, the trace records **what you allowed to happen**—not a substitute for intent checks. You still sign off on scope, TMVC roots, and the deterministic gate.

## Using this outside the OpenGantry repo

Treat the following as a **portable kit** you can drop into any Git repository (app, library, or monorepo).

### Enforcement boundary

**Prevents unreviewed edits where it matters.** IDE Agent Write/Edit is advisory TMVC; hard boundaries live in `runtime exec`, `gapman verify`, and hooks.

| Tier | Mechanism | Enterprise control |
|------|-----------|-------------------|
| **Process-boundary** | `gapman runtime exec` | Agent cannot touch forbidden paths during orchestrated runs |
| **Deterministic hook** | Cursor `beforeShellExecution`, pre-push verify | Shell/hook writes to governance files require mission + verify |
| **Advisory** | IDE rules, `AGENTS.md`, sessionStart context | IDE suggestions alone do not count as approval |

Per-tool recipes: [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) (see **Enforcement boundary**).

### 1. Bootstrap with `gapman init` (recommended)

From a built OpenGantry tree (or after copying the `gapman` CLI + `templates/` into your toolchain):

```bash
npm ci && npm run build   # in the OpenGantry repo, or use a globally linked gapman
gapman init --tutorial    # recommended first run; or gapman init (wizard / --yes)
gapman teacher set "$(git config user.email)"             # repo-local (recommended)
gapman doctor
git config core.hooksPath .githooks
```

`gapman init` bootstraps a target git repository from packaged templates:

- **TTY:** interactive wizard (`@clack/prompts`) — select IDE/agent integrations, doc path, skills preset, hooks, CI, architecture pointer.
- **Non-TTY / CI:** auto-applies default profile (core + Cursor + hooks + CI) — no hang.
- **`--yes`:** default profile without prompts. **`--dry-run`:** print planned writes.
- **Flags:** `--ides cursor,claude-code`, `--docs-path`, `--skills minimal|specimen`, `--no-hooks`, `--no-ci`, `--arch-source`, `--arch-location`.

Asset lifecycles:

- `scaffold_only` files (for example `MANIFEST.json`, `RULES.md`, `skills/*.md`, IDE pointer files) are created when missing and preserved when customized.
- `managed_strict` runtime assets (workflow, validate script, hooks, schema/rules pointers) prompt before overwrite in an interactive terminal; use `--force` to skip the prompt.

Init also composes **`docs/INTEGRATIONS.md`** (or your chosen path) from `templates/integrations/compatibility.json`, scaffolds **`.gitagent/ARCHITECTURE.pointer.json`**, and installs runtime scripts (`gxt-runtime-env.sh`, `gxt-pin-mission.sh`, …). Store local tokens for protected architecture sources with **`gapman arch cred set`** (stdin only; git-ignored under `.gitagent/history/credentials/`).

After `init`, customize your manifest and skills, then legislate. See [`docs/ADOPTION.md`](docs/ADOPTION.md) for the exact ordered runbook.

### 2. Customize for your project

- Edit **[`.gitagent/foreman/MANIFEST.json`](.gitagent/foreman/MANIFEST.json)**  
  Set `path_risks`, `risk_keywords`, and each skill's `tmvc_roots`, `forbidden_zones`, and `trust_threshold` to match **your** directories and risk appetite.
- Align **[`.gitagent/teacher/RULES.md`](.gitagent/teacher/RULES.md)** with your review policy (tiers, who counts as "human audit", merge gates).
- Point **deterministic gates** in missions at **your** stack (`npm test`, `pytest`, `cargo test`, etc.).
- Store mission files you intend to **`gapman verify`** under **`.gitagent/missions/`** and configure **Teacher allowlist** per repo (`gapman teacher set`, `.gitagent/foreman/TEACHER.allowlist.local`, or `git config gapman.teacherEmails`).

**Concrete gate example** (YAML fields in a mission file; adjust paths and commands):

```yaml
gate_command: "npm test -- src/components/Button.test.tsx"
gate_success_substring: "Tests:       1 passed"
```

The gate is whatever command **fails closed** for your repo (lint, typecheck, integration suite). One explicit command beats a vague "run tests somewhere." Primary reference: [`.gitagent/teacher/MISSION.example.yaml`](.gitagent/teacher/MISSION.example.yaml). Markdown missions remain supported (`gapman verify` parses both); [`.gitagent/teacher/MISSION.template.md`](.gitagent/teacher/MISSION.template.md) is a human-readable reference, not the `legislate` default.

### gapman CLI

Requires **Node.js 24+** (Active LTS line). Published as **`@jeger-ai/opengantry`** on npm; the `gapman` binary is registered via `package.json` `bin` (see [`package.json`](package.json)). From source: `npm ci && npm run build` → `dist/cli/index.js`.

**Developing OpenGantry:** dogfood the full stack — [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) (missions, hooks, verify, `npm run validate`). Layer rules: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Adopters: [`docs/ADOPTION.md`](docs/ADOPTION.md).

**Adoption path:**

| Step | Command | Outcome |
|------|---------|---------|
| Onboard | `gapman init --tutorial` or `gapman onboarding` | Feel Teacher stamp + verify loop (~3 min) |
| Scope + approve | `gapman start` → Teacher `[MSN-…]` commit | Unreviewed stub cannot pass full verify |
| Prove work | `gapman verify` | Gate + log quotes + greppable history |

**Global output:** `gapman --audience worker\|teacher\|verifier\|platform <cmd>` (or `GXT_AUDIENCE=verifier` in CI — silence unless `[GXT_*]` errors).

| Command | Purpose |
|--------|---------|
| `gapman init` | Bootstrap substrate + IDE packs + hooks + CI. `--tutorial` runs guided first loop after scaffold. |
| `gapman upgrade` | Plan substrate updates from the installed package (stages to `.gitagent/.upgrade-tmp/`, drafts upgrade mission YAML). `gapman upgrade --apply --mission …` after Teacher `[MSN-…]` commit. |
| `gapman check` | Validate `MANIFEST.json` shape + **Rule 4.4** sync: every `manifest.skills` key must have `skills/<key>.md`, with no orphan skill files. |
| `gapman status` | GXT readiness dashboard (`--json`, `--verbose`, `--audience worker\|teacher\|verifier\|platform`). |
| `gapman start "<intent>"` | Goal-first orchestration: triage → legislate stub → runtime next steps (`--msn`, `--skill-key`, `--json`). |
| `gapman onboarding` | Interactive walkthrough of the strict mission loop (no relaxed checks). |
| `gapman doctor` | Active readiness check (manifest, Teacher email, bypass secret match, hooks, architecture pointer, integration staleness). Warnings exit 0. `--audience` tailors next steps. |
| `gapman triage "<intent>"` | Foreman-style routing ([`SOUL.md`](.gitagent/foreman/SOUL.md)). `--json` for machine output (may include non-binding `adr_hints` from [`.gitagent/out-of-scope/`](.gitagent/out-of-scope/README.md)). `--emit-mission --msn MSN-0007` writes `.gitagent/missions/ACTIVE_MISSION.md` by default on **DIRECT_EXECUTION** only. |
| `gapman teacher show\|set` | Repo-local Teacher git-proof allowlist (`.gitagent/foreman/TEACHER.allowlist.local`; avoids global `GAPMAN_TEACHER_EMAILS` leaking across projects). |
| `gapman legislate "<intent>" --msn MSN-0007` | Emit stub **YAML** mission under `.gitagent/missions/` with explicit MSN (`--skill-key` when triage would escalate; `--gate-command` / `--gate-success-substring` for one-click handoff). Teacher still **`git commit`**-legislates from an allowlisted email. |
| `gapman mission validate --file <path>` | Validate a mission `.md` or `.yaml` (YAML checked against [`.gitagent/teacher/MISSION.schema.yaml`](.gitagent/teacher/MISSION.schema.yaml)). |
| `gapman mission snapshot --file <path>` | Write start-state JSON under `.gitagent/history/` (git HEAD, branch, dirty flag, manifest hash, hashes of files under the mission skill's `tmvc_roots`). |
| `gapman runtime env --mission <path>` | Worker Runtime Contract: emit `GXT_REPO_ROOT`, `GXT_MISSION_FILE`, `GXT_MSN_ID`, `GXT_SKILL_KEY`, `GXT_TMVC_ROOTS`, `GXT_FORBIDDEN_ZONES`, `GXT_WORKER_LOG`. Default: POSIX `export …` lines; `--json` for scripts. [.gitagent/teacher/RUNTIME.md](.gitagent/teacher/RUNTIME.md). |
| `gapman runtime exec --mission <path> -- <cmd…>` | Run worker command with mission env, telemetry capture, and forbidden-zone scan (strongest TMVC trap). |
| `gapman mcp serve` | Stdio MCP server exposing `gxt_*` tools (legislation, pin, runtime env, verify with `fix_hints`, `gxt_start_orchestration`, exec). Configure via `.cursor/mcp.json`. |
| `gapman verify --mission <path>` | Teacher-approved mission commit + gate + trace. **`--fix`** guided repair. CI: `--audience verifier` (errors only). Failures emit **`GXT_*`** codes. |
| `gapman arch pointer` | Print architecture pointer summary for agents (`.gitagent/ARCHITECTURE.pointer.json`). |
| `gapman arch cred status\|set\|unset` | Git-ignored credential slots for authenticated external architecture sources (secrets via stdin only). |
| `gapman metrics [--json] [--ref main]` | Git-native governance rollup (stream-parsed). See [`docs/ADOPTION.md`](docs/ADOPTION.md). |

**Who can approve missions (Teacher allowlist):** only allowlisted identities can legislate missions that verify accepts. Precedence:

1. `.gitagent/foreman/TEACHER.allowlist` (+ optional gitignored `.local` merge)
2. `git config gapman.teacherEmails "a@x.com,b@y.com"`
3. `GAPMAN_TEACHER_EMAILS` env (CI escape hatch only)
4. implicit `git config user.email` when nothing else is set

Use **`gapman teacher set "$(git config user.email)"`** after clone — do not rely on a global shell export when you work across multiple projects.

### Worker Runtime quickstart

Agents (Cursor, Junie, local scripts) should not guess TMVC roots — read them from **`gapman runtime env`**.

Each `--mission` path must refer to **an existing mission file** (ENOENT means the YAML or Markdown mission is missing). Split these into separate shell steps if you paste from docs.

```bash
npm ci && npm run build

# Existing mission (tracked example — swap for yours after Teacher legislates it):
eval "$(node dist/cli/index.js runtime env --mission .gitagent/missions/example.verify.yaml)"

# Or machine-readable JSON for a wrapper script:
node dist/cli/index.js runtime env --mission .gitagent/missions/example.verify.yaml --json

# Headless / CI — strongest TMVC trap:
node dist/cli/index.js runtime exec --mission .gitagent/missions/example.verify.yaml -- <your-agent-command>
```

Inspect `GXT_TMVC_ROOTS`, `GXT_FORBIDDEN_ZONES`, and `GXT_WORKER_LOG`; write forensic trace quotes to **`WORKER_LOG.md`** (or `--worker-log` at verify time), then **`gapman verify`** as usual.

**Legislate a stub mission (Teacher edits + commits — then wire `runtime env` to that file path):**

```bash
node dist/cli/index.js legislate "Fix login spinner on checkout — ui" --msn MSN-0007 --skill-key ui
# Teacher: tune gate/trace rows; git commit -m "[MSN-0007] legislate …" including the mission file
# eval "$(node dist/cli/index.js runtime env --mission .gitagent/missions/MSN-0007.<slug>.yaml)"
```

Details and variable semantics: [.gitagent/teacher/RUNTIME.md](.gitagent/teacher/RUNTIME.md).

### 3. Wire agents (and optionally CI)

- **[`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)** — closed-loop agent integrations (enforcement boundary, remote handoff, per-tool recipes for Cursor, Claude Code, OpenAI Codex CLI, OpenCode, Junie, Antigravity, Cline, Aider, OpenHands). Installed by `gapman init`.
- **[`AGENTS.md`](AGENTS.md)** tells agents to read **RULES** + **MANIFEST** before acting.
- **[`.cursor/rules/opengantry-gxt-substrate.mdc`](.cursor/rules/opengantry-gxt-substrate.mdc)** does the same for Cursor with `alwaysApply: true`.
- **CI:** this repo includes **[`.github/workflows/gxt-validate.yml`](.github/workflows/gxt-validate.yml)**:
  - **gapman:** `npm ci` / `npm run build`, then `gapman check`, `gapman doctor`, and unit tests.
  - **Manifest (jq parity):** validates [`.gitagent/foreman/MANIFEST.json`](.gitagent/foreman/MANIFEST.json) via [`scripts/validate-gxt.sh`](scripts/validate-gxt.sh) `manifest`.
  - **Changed-code quality (PR only):** ESLint complexity, import layers, line budgets on touched `src/cli/**/*.ts`.
  - **MSN (PR only, path-scoped):** on **pull_request** only, any **non-merge** commit in the PR range that touches `.gitagent/`, repo-root `WORKER_LOG.md`, `.githooks/`, or [`.github/workflows/gxt-validate.yml`](.github/workflows/gxt-validate.yml) must have a subject starting with **`[MSN-NNNN]`** (four digits). Other paths (e.g. root `README.md` only) do not trigger this check.
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

High level: **Foreman** routes → **Teacher** authors a mission when needed → **Worker** executes inside TMVC and writes **`WORKER_LOG.md`** → **deterministic gate** runs → **Verifier** maps passes to the log → commits follow **`[MSN-XXXX]`** + receipt template.

Details and the workflow diagram: **[`.gitagent/README.md`](.gitagent/README.md)**.

### Advanced: manual vendoring

If you cannot run `gapman init`, copy at least:

- `.gitagent/` (entire tree)
- `skills/` (optional in minimal vendoring, but **required** for Rule 4.4: one `skills/<skill-key>.md` per manifest skill — enforced by `gapman check`)
- `.githooks/` (optional: creates an empty repo-root `WORKER_LOG.md` when you check out a feature branch)
- `AGENTS.md` (or merge its bullets into your existing agent instructions)
- Optionally `.cursor/rules/opengantry-gxt-substrate.mdc` if you use Cursor

Add to your **`.gitignore`** (if not already present):

```gitignore
# OpenGantry local forensic bulk (optional)
.gitagent/history/
```

**Empty `WORKER_LOG.md` on branch checkout:** after copying, point Git at the vendored hooks once per clone (`git config core.hooksPath .githooks`). On branch checkouts **other than** `main` or `master`, if `WORKER_LOG.md` is missing at the repo root, [`.githooks/post-checkout`](.githooks/post-checkout) copies [`.gitagent/teacher/WORKER_LOG.template.md`](.gitagent/teacher/WORKER_LOG.template.md) into place. It **never overwrites** an existing file.

## Staying in sync

**Primary path (npm):** install or update the CLI package, then apply bundled substrate changes in your repo:

```bash
npm install @jeger-ai/opengantry@latest
gapman upgrade
# Review .gitagent/.upgrade-tmp/; Teacher-commit the upgrade mission YAML
gapman upgrade --apply --mission .gitagent/missions/MSN-9001.upgrade-vX.Y.Z.yaml
gapman doctor
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
curl -fsSL -o .gitagent/teacher/MISSION.example.yaml \
  https://raw.githubusercontent.com/jeger-ai/opengantry/main/.gitagent/teacher/MISSION.example.yaml
```

Always **review the diff** before commit; never bulk-overwrite a customized `MANIFEST.json`.

## OpenGantry Ledger — how GXT fits the landscape

| Pattern | Typical shape | Audit / production readiness |
|---------|----------------|------------------------------|
| **GXT / OpenGantry** | Git-native missions, manifest routing, deterministic gates, auditable log mapped to **`WORKER_LOG.md`**, human `[MSN-XXXX]` approval + SOD ([`RULES.md`](.gitagent/teacher/RULES.md)) | **Can we find every AI-governed change?** Greppable missions. **Can we prove what was checked?** Gate output + log quotes. **Can agents edit compliance files silently?** Hooks + verify fail closed. |
| Agent "swarm" / choreography layers | Orchestrates model calls across services; emphasizes throughput and parallelism | Strong on **coverage** of tasks; lineage and per-change evidence depends on tooling above the swarm |
| Unstructured desktop assistants | Reactive help in-editor or OS-wide; informal plans | Lightweight for exploration; weakest default for **reproducible** production sign-off without additional discipline |

GXT deliberately trades "always-on improvisation" for a **narrow, inspectable envelope**: Foreman chooses a skill footprint, Teachers legislate commits, Workers stay inside TMVC (or Context Request → accept/reject), and Verifiers bind PASS claims to log quotes.

## Relationship to this repository

**jeger-ai/opengantry** is the **canonical reference tree** for **GXT** (manifest `schema_version` **v0.5.0** law + **`gapman` v1.0.0** CLI). Fork it, run `gapman init` in your repo, vendor the `.gitagent/` folder, or cherry-pick files—there is no published runtime "install" step.

## Security

Supported versions and how to report vulnerabilities: [`SECURITY.md`](SECURITY.md).

## License

OpenGantry is licensed under the **Apache License, Version 2.0**. See [`LICENSE`](LICENSE). Attribution and copyright notice: [`NOTICE`](NOTICE).
