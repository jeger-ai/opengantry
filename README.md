# OpenGantry

**OpenGantry** is a **reference implementation** of the **GXT (Git-native eXecution and Trace) protocol**: a small, version-controlled **substrate** for running AI-assisted engineering with explicit law, routing, and audit trails—without a proprietary runtime.

This repository is both the **specimen** and the **template**. You do not need to depend on OpenGantry as a package; you **copy the substrate** into your own repo and adapt it.

**Protocol maturity:** substrate is labeled **v0.5.0** (pre-1.0): useful for real teams, honest about what is still manual until tooling like `gapman` exists. The sections **Human handbrake**, **Staying in sync**, and **Concrete gate example** below are **v0.5.1 README** guidance for adopters (the on-disk `schema_version` in `MANIFEST.json` may still read `0.5.0` until you bump it).

## What you get

| Idea | Where it lives |
|------|----------------|
| **Law** (SOD, trace mapping, risk tiers, TMVC, manifest sync) | [`.gitagent/teacher/RULES.md`](.gitagent/teacher/RULES.md) |
| **Routing map** (skills, roots, forbidden zones, path risks) | [`.gitagent/foreman/MANIFEST.json`](.gitagent/foreman/MANIFEST.json) |
| **Foreman** (cheap, manifest-only triage) | [`.gitagent/foreman/SOUL.md`](.gitagent/foreman/SOUL.md) |
| **Work order + commit receipt** | [`.gitagent/teacher/MISSION.template.md`](.gitagent/teacher/MISSION.template.md), [`.gitagent/teacher/commit-template.md`](.gitagent/teacher/commit-template.md) |
| **Full orientation + workflow diagram** | [`.gitagent/README.md`](.gitagent/README.md) |

Core behaviors in plain language:

- **Forensic trace:** verifier "pass" is tied to quotes from **`WORKER_LOG.md`**, not vibes alone. That log is **authored by the worker**—so trace mapping is a **process control**, not cryptographic proof. It works when you pair it with **SOD**, **deterministic gates**, and **tier-appropriate human review** (see [`.gitagent/teacher/RULES.md`](.gitagent/teacher/RULES.md)).
- **Risk tiers:** cheap automation where safe; stricter human or multi-model paths for sensitive areas.
- **Dynamic TMVC:** work happens under declared **roots**; out-of-scope access needs a logged **context request**; **forbidden zones** are security stops.
- **Git-native missions:** commit subjects use **`[MSN-XXXX]`** so history is greppable (`git log --grep='MSN-0042'`).

## Using this outside the OpenGantry repo

Treat the following as a **portable kit** you can drop into any Git repository (app, library, or monorepo).

### Human handbrake (read this first)

If you do **not** review the **mission** (work order from [`.gitagent/teacher/MISSION.template.md`](.gitagent/teacher/MISSION.template.md)) **before** the worker runs, the forensic trace is mostly a record of **what you allowed to happen**—not a substitute for intent checks. The trace still helps audit and grep history; it does not replace **you** signing off on scope, TMVC roots, and the deterministic gate.

### 1. Copy the substrate

Copy at least:

- `.gitagent/` (entire tree)
- `.githooks/` (optional: creates an empty repo-root `WORKER_LOG.md` when you check out a feature branch; see below)
- `AGENTS.md` (or merge its bullets into your existing agent instructions)
- Optionally `.cursor/rules/opengantry-gxt-substrate.mdc` if you use Cursor (or translate the same rules into your IDE's rule system)

Add to your **`.gitignore`** (if not already present):

```gitignore
# OpenGantry local forensic bulk (optional)
.gitagent/history/
```

**Optional — empty `WORKER_LOG.md` on branch checkout:** after copying, point Git at the vendored hooks once per clone:

```bash
git config core.hooksPath .githooks
```

Then `git switch -c your-feature` (or `git checkout -b …`): on branch checkouts **other than** `main` or `master`, if `WORKER_LOG.md` is missing at the repo root, [`.githooks/post-checkout`](.githooks/post-checkout) copies [`.gitagent/teacher/WORKER_LOG.template.md`](.gitagent/teacher/WORKER_LOG.template.md) into place. It **never overwrites** an existing file. Adjust the `main|master` list in the hook if your default branch differs.

### 2. Customize for your project

- Edit **[`.gitagent/foreman/MANIFEST.json`](.gitagent/foreman/MANIFEST.json)**  
  Set `path_risks`, `risk_keywords`, and each skill's `tmvc_roots`, `forbidden_zones`, and `trust_threshold` to match **your** directories and risk appetite.
- Align **[`.gitagent/teacher/RULES.md`](.gitagent/teacher/RULES.md)** with your review policy (tiers, who counts as "human audit", merge gates).
- Point **deterministic gates** in missions at **your** stack (`npm test`, `pytest`, `cargo test`, etc.).

**Concrete gate example** (paste into a mission file; adjust paths and commands):

```markdown
## 3. Deterministic Gate

**Command:** `npm test -- src/components/Button.test.tsx`
**Success:** process exits `0` and Jest output contains `Tests:       1 passed`
```

The gate is whatever command **fails closed** for your repo (lint, typecheck, integration suite). One explicit command beats a vague "run tests somewhere."

### 3. Wire agents (and optionally CI)

- **[`AGENTS.md`](AGENTS.md)** tells agents to read **RULES** + **MANIFEST** before acting.
- **[`.cursor/rules/opengantry-gxt-substrate.mdc`](.cursor/rules/opengantry-gxt-substrate.mdc)** does the same for Cursor with `alwaysApply: true`.
- **CI:** this repo includes **[`.github/workflows/gxt-validate.yml`](.github/workflows/gxt-validate.yml)**:
  - **Manifest:** validates [`.gitagent/foreman/MANIFEST.json`](.gitagent/foreman/MANIFEST.json) on every **push** and **pull_request** (via [`scripts/validate-gxt.sh`](scripts/validate-gxt.sh) `manifest`).
  - **MSN (PR only, path-scoped):** on **pull_request** only, any **non-merge** commit in the PR range that touches `.gitagent/`, repo-root `WORKER_LOG.md`, `.githooks/`, or [`.github/workflows/gxt-validate.yml`](.github/workflows/gxt-validate.yml) must have a subject starting with **`[MSN-NNNN]`** (four digits). Other paths (e.g. root `README.md` only) do not trigger this check.
- **Local:** run [`scripts/validate-gxt.sh`](scripts/validate-gxt.sh) before push (requires `jq` and `git`):

```bash
./scripts/validate-gxt.sh manifest
./scripts/validate-gxt.sh msn origin/main HEAD   # after: git fetch origin
# or both:
./scripts/validate-gxt.sh all origin/main HEAD
```

### 4. Run the loop (human + models)

High level: **Foreman** routes → **Teacher** authors a mission when needed → **Worker** executes inside TMVC and writes **`WORKER_LOG.md`** → **deterministic gate** runs → **Verifier** maps passes to the log → commits follow **`[MSN-XXXX]`** + receipt template.

Details and the workflow diagram: **[`.gitagent/README.md`](.gitagent/README.md)**.

## Staying in sync (no package manager yet)

There is **no** `npm install opengantry`—so you own **merge discipline** when upstream `RULES` / templates improve.

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
curl -fsSL -o .gitagent/teacher/MISSION.template.md \
  https://raw.githubusercontent.com/jeger-ai/opengantry/main/.gitagent/teacher/MISSION.template.md
```

Always **review the diff** before commit; never bulk-overwrite a customized `MANIFEST.json`.

## Relationship to this repository

**jeger-ai/opengantry** is the **canonical reference tree** for the GXT v0.5.0 substrate. Fork it, vendor the `.gitagent/` folder into another project, or cherry-pick files—there is no runtime "install" step.

## License

OpenGantry is licensed under the **Apache License, Version 2.0**. See [`LICENSE`](LICENSE). Attribution and copyright notice: [`NOTICE`](NOTICE).
