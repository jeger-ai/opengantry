# OpenGantry

**OpenGantry** is a **reference implementation** of the **GXT (Git-native eXecution and Trace) protocol**: a small, version-controlled **substrate** for running AI-assisted engineering with explicit law, routing, and audit trails—without a proprietary runtime.

This repository is both the **specimen** and the **template**. You do not need to depend on OpenGantry as a published package; run **`gapman init`** in your repo (or vendor the substrate manually) and adapt it.

**Protocol maturity:** substrate law is labeled **v0.5.0** (pre-1.0): useful for real teams, honest about what is still evolving. **`gapman` v0.8.1** is the current CLI — bootstrap, readiness checks, architecture pointers, and orchestrated worker runs on top of the v0.7.0 Worker Runtime Contract (`runtime env`, `legislate`). See [.gitagent/teacher/RUNTIME.md](.gitagent/teacher/RUNTIME.md).

## v0.8.1 specimen release

`v0.8.1` is the current GitHub specimen of the governance substrate and `gapman` CLI. This repository remains `private: true` for package publishing; validate distribution layout with `npm pack` and run the adopter flow locally. Use [`docs/ADOPTION.md`](docs/ADOPTION.md) for the ordered runbook and smoke checklist.

| Release | Highlights |
|---------|------------|
| **v0.7.0** | `gapman runtime env`, `gapman legislate` (YAML mission scaffolding) |
| **v0.8.0** | Context-aware **Fix:** hints, auto fuzzy trace (line-drift resolution), scoped **pre-push** verify for legislative stubs |
| **v0.8.1** | `gapman init` interactive wizard, `gapman doctor`, `gapman metrics`, `gapman arch pointer` / `arch cred`, integration compat manifest, `gapman runtime exec` orchestration |

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
| **gapman CLI** | `npm ci && npm run build` then `npx gapman` or `node dist/cli/index.js` — see [gapman](#gapman-cli) |
| **Full orientation + workflow diagram** | [`.gitagent/README.md`](.gitagent/README.md) |

Core behaviors in plain language:

- **Forensic trace:** verifier "pass" is tied to quotes from **`WORKER_LOG.md`**, not vibes alone. That log is **authored by the worker**—so trace mapping is a **process control**, not cryptographic proof. It works when you pair it with **SOD**, **deterministic gates**, and **tier-appropriate human review** (see [`.gitagent/teacher/RULES.md`](.gitagent/teacher/RULES.md)).
- **Risk tiers:** cheap automation where safe; stricter human or multi-model paths for sensitive areas.
- **Dynamic TMVC:** work happens under declared **roots**; out-of-scope access needs a logged **context request**; **forbidden zones** are security stops.
- **Git-native missions:** commit subjects use **`[MSN-XXXX]`** so history is greppable (`git log --grep='MSN-0042'`).

## Using this outside the OpenGantry repo

Treat the following as a **portable kit** you can drop into any Git repository (app, library, or monorepo).

### Human handbrake (read this first)

If you do **not** review the **mission** (YAML from `gapman legislate` or another structured work order under `.gitagent/missions/`) **before** the worker runs, the forensic trace is mostly a record of **what you allowed to happen**—not a substitute for intent checks. The trace still helps audit and grep history; it does not replace **you** signing off on scope, TMVC roots, and the deterministic gate.

### Enforcement boundary (read this second)

**IDE Agent Write/Edit is advisory TMVC; hard boundaries live in `runtime exec`, `gapman verify`, and hooks.**

| Tier | Mechanism | What is actually enforced |
|------|-----------|---------------------------|
| **Process-boundary** | `gapman runtime exec` | Forbidden-zone scan + subprocess TMVC envelope |
| **Deterministic hook** | Cursor `beforeShellExecution`, pre-push verify | Shell writes to law/manifest paths; mission git-proof |
| **Advisory** | IDE rules, `AGENTS.md`, sessionStart context | LLM compliance only — not a kernel/file sandbox |

Per-tool recipes and headless orchestration patterns: [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) (see **Enforcement boundary**).

### 1. Bootstrap with `gapman init` (recommended)

From a built OpenGantry tree (or after copying the `gapman` CLI + `templates/` into your toolchain):

```bash
npm ci && npm run build   # in the OpenGantry repo, or use a globally linked gapman
gapman init               # interactive wizard on TTY; auto-default in CI (no hang)
export GAPMAN_TEACHER_EMAILS="$(git config user.email)"
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
- Store mission files you intend to **`gapman verify`** under **`.gitagent/missions/`** and set **`GAPMAN_TEACHER_EMAILS`** so the Teacher's legislation commits are recognized (see [gapman](#gapman-cli)).

**Concrete gate example** (YAML fields in a mission file; adjust paths and commands):

```yaml
gate_command: "npm test -- src/components/Button.test.tsx"
gate_success_substring: "Tests:       1 passed"
```

The gate is whatever command **fails closed** for your repo (lint, typecheck, integration suite). One explicit command beats a vague "run tests somewhere." Primary reference: [`.gitagent/teacher/MISSION.example.yaml`](.gitagent/teacher/MISSION.example.yaml). Markdown missions remain supported (`gapman verify` parses both); [`.gitagent/teacher/MISSION.template.md`](.gitagent/teacher/MISSION.template.md) is a human-readable reference, not the `legislate` default.

### gapman CLI

Requires **Node.js 24+** (Active LTS line). After `npm ci` and `npm run build`, the `gapman` binary resolves to `dist/cli/index.js` (see [`package.json`](package.json)).

**Developing OpenGantry:** dogfood the full stack — [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) (missions, hooks, verify, `npm run validate`). Layer rules: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Adopters: [`docs/ADOPTION.md`](docs/ADOPTION.md).

| Command | Purpose |
|--------|---------|
| `gapman init` | Bootstrap substrate + IDE packs + hooks + CI from packaged templates. Interactive wizard or `--yes` default profile. |
| `gapman check` | Validate `MANIFEST.json` shape + **Rule 4.4** sync: every `manifest.skills` key must have `skills/<key>.md`, with no orphan skill files. |
| `gapman status` | Human-readable report of the same checks. |
| `gapman doctor` | Active readiness check (manifest, Teacher email, bypass secret match, hooks, architecture pointer, integration staleness). Warnings exit 0. |
| `gapman triage "<intent>"` | Foreman-style routing ([`SOUL.md`](.gitagent/foreman/SOUL.md)). `--json` for machine output (may include non-binding `adr_hints` from [`.gitagent/out-of-scope/`](.gitagent/out-of-scope/README.md)). `--emit-mission --msn MSN-0007` writes `.gitagent/missions/ACTIVE_MISSION.md` by default on **DIRECT_EXECUTION** only. |
| `gapman legislate "<intent>" --msn MSN-0007` | Emit stub **YAML** mission under `.gitagent/missions/` with explicit MSN (`--skill-key` when triage would escalate; `--gate-command` / `--gate-success-substring` for one-click handoff). Teacher still **`git commit`**-legislates under `GAPMAN_TEACHER_EMAILS`. |
| `gapman mission validate --file <path>` | Validate a mission `.md` or `.yaml` (YAML checked against [`.gitagent/teacher/MISSION.schema.yaml`](.gitagent/teacher/MISSION.schema.yaml)). |
| `gapman mission snapshot --file <path>` | Write start-state JSON under `.gitagent/history/` (git HEAD, branch, dirty flag, manifest hash, hashes of files under the mission skill's `tmvc_roots`). |
| `gapman runtime env --mission <path>` | Worker Runtime Contract: emit `GXT_REPO_ROOT`, `GXT_MISSION_FILE`, `GXT_MSN_ID`, `GXT_SKILL_KEY`, `GXT_TMVC_ROOTS`, `GXT_FORBIDDEN_ZONES`, `GXT_WORKER_LOG`. Default: POSIX `export …` lines; `--json` for scripts. [.gitagent/teacher/RUNTIME.md](.gitagent/teacher/RUNTIME.md). |
| `gapman runtime exec --mission <path> -- <cmd…>` | Run worker command with mission env, telemetry capture, and forbidden-zone scan (strongest TMVC trap). |
| `gapman verify --mission <path>` | **Git-proof** + gate + trace. **`--pre-push`** for hook handoff (legislative stubs stop after git-proof). **Auto line-drift resolution** by default; **`--strict-trace`** to disable. **`--break-glass --reason "…"`** when `GXT_BYPASS_SECRET` matches `BYPASS.sha256`. Failures include **Fix:** hints. |
| `gapman arch pointer` | Print architecture pointer summary for agents (`.gitagent/ARCHITECTURE.pointer.json`). |
| `gapman arch cred status\|set\|unset` | Git-ignored credential slots for authenticated external architecture sources (secrets via stdin only). |
| `gapman metrics [--json] [--ref main]` | Git-native governance rollup (stream-parsed). See [`docs/ADOPTION.md`](docs/ADOPTION.md). |

Set **`GAPMAN_TEACHER_EMAILS`** to a comma-separated list of Git **author emails** allowed to legislate missions (must match the committing Teacher's `user.email` / `GIT_AUTHOR_EMAIL`).

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

## Staying in sync (no npm package for the substrate kit)

There is **no** `npm install opengantry` as a published package—**this canonical repo** uses root `package.json` only for the **`gapman`** CLI and its tests. When you **vendor** OpenGantry into another app, copy `.gitagent/` (and optionally the `gapman` sources); you are not required to adopt Node in the host repo.

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
| **GXT / OpenGantry** | Git-native missions, manifest routing, deterministic gates, forensic trace mapped to **`WORKER_LOG.md`**, Teacher stamps + segregation of duties ([`RULES.md`](.gitagent/teacher/RULES.md)) | Explicit **regulated loop**: what ran, where, and why is greppable; merge gates can fail closed on missing evidence |
| Agent "swarm" / choreography layers | Orchestrates model calls across services; emphasizes throughput and parallelism | Strong on **coverage** of tasks; lineage and per-change evidence depends on tooling above the swarm |
| Unstructured desktop assistants | Reactive help in-editor or OS-wide; informal plans | Lightweight for exploration; weakest default for **reproducible** production sign-off without additional discipline |

GXT deliberately trades "always-on improvisation" for a **narrow, inspectable envelope**: Foreman chooses a skill footprint, Teachers legislate commits, Workers stay inside TMVC (or Context Request → accept/reject), and Verifiers bind PASS claims to log quotes.

## Relationship to this repository

**jeger-ai/opengantry** is the **canonical reference tree** for **GXT** (manifest `schema_version` **v0.5.0** law + **`gapman` v0.8.1** CLI). Fork it, run `gapman init` in your repo, vendor the `.gitagent/` folder, or cherry-pick files—there is no published runtime "install" step.

## License

OpenGantry is licensed under the **Apache License, Version 2.0**. See [`LICENSE`](LICENSE). Attribution and copyright notice: [`NOTICE`](NOTICE).
