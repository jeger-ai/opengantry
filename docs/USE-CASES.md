# What OpenGantry helps with

Product pitch and problem framing: [README](../README.md). This page maps **situations and personas** to the GXT workflow — when OpenGantry is the right fit and what you get out of it.

All docs: [`index.md`](index.md)

---

## When to adopt

You adopt OpenGantry when agent velocity is valuable but **unreviewed scope creep, silent governance edits, or unverifiable "it works" claims** are unacceptable.

```
OpenGantry = scoped work order + shell gates + structured verify output
Executor agent = worker (Cursor, Hermes, human dev)
```

Typical triggers:

| Situation | Without governance | With OpenGantry |
|-----------|-------------------|-----------------|
| IDE agents edit anywhere | Implicit scope; `.gitagent/` drift | Declared **tmvc_roots** + **forbidden zones** in mission + manifest |
| "It passed locally" | Chat logs or ad-hoc JSON | **Git-native:** mission YAML, gate output, verbatim **`EXECUTOR_LOG.md`** quotes |
| Architecture or copy drift | Manual review only | `TARGET_ARCHITECTURE.yaml` + `gantry arch check` / `gantry perimeter check` |
| Autonomous retry loops | Parse terminal stderr | Stable **`findings[]`** envelope with file, line, hint |
| One-off policy per repo | Reinvent orchestration each time | `gantry init` scaffolds the same GXT substrate everywhere |

---

## vs TDD + GitHub Actions

You already have tests and CI. The friction is not "do we have gates?" — it is **who reads the failure output**.

Human TDD works because a developer parses stderr and fixes code. When an IDE agent runs the same loop, unstructured terminal output causes hallucinated fixes and infinite retries; someone senior still babysits.

OpenGantry keeps your existing `gate_command` (e.g. `npm test`) and adds:

- **Mission YAML** — declared edit paths before the agent touches files
- **`findings[]`** — machine-readable failure envelope (`file`, `line`, `resolution_hint`) from `gantry verify --json`

Vocabulary and the full contrast table: [README § In plain English](../README.md#in-plain-english) and [README § Why not just TDD and CI?](../README.md#why-not-just-tdd-and-ci).

---

## Personas

### Teams already doing TDD who still babysit IDE agents

Your test suite and CI are solid. Cursor or Copilot still edits outside the intended blast radius, and when a gate fails the model misreads stderr. You need the same gates with **structured retry input** and **Git-locked scope** — not another test framework.

See [README § Why not just TDD and CI?](../README.md#why-not-just-tdd-and-ci) and [`FEATURES.md`](FEATURES.md) § `gantry verify`.

### Regulated engineering (fintech, health, critical infrastructure)

Auditors ask how AI-assisted coding fits your ISMS or AI management system — not how good your prompts are. OpenGantry produces **operational records**: Planner `[MSN-XXXX]` commits, mission scope, executor trace, verify output.

See [`COMPLIANCE-ISO.md`](COMPLIANCE-ISO.md) for ISO 27001 / 42001 mapping and [`ADOPTION.md`](ADOPTION.md) for the standard change loop.

### Platform / platform-security teams

You need **blast-radius control** before agents get write access: subprocess TMVC via `gantry runtime exec`, hooks on governance paths, merge-time `gantry verify`. Enforcement tiers are documented honestly — IDE Write/Edit alone is advisory.

See [`FEATURES.md`](FEATURES.md) § Enforcement boundary and [`INTEGRATIONS.md`](INTEGRATIONS.md).

### Autonomous orchestrators (Hermes, CI bots, custom runners)

External executors implement code; OpenGantry owns **contract and verdict**. On verify failure, ingest structured `findings[]` — no terminal log scraping.

See [`AGENT-LOOP.md`](AGENT-LOOP.md).

### Content and brand compliance

The same mission/verify loop governs TypeScript imports **and** marketing copy: regex perimeter rules (`forbid_pattern`, `require_pattern`) with `file` + `line` in the failure envelope.

Walkthrough: [`examples/content-governance/`](../examples/content-governance/). Adapter details: [`DOMAINS.md`](DOMAINS.md).

### Teams replacing improvised agent scripts

Many teams use IDE agents with no orchestrator; others ship one-off `agent-run.mjs` files with ad-hoc state and heuristic scope. OpenGantry replaces improvisation with a **Git-native protocol envelope** — legislative commits, pinned missions, verify-gated workflow.

---

## OpenGantry vs alternatives

OpenGantry is **Autonomous Repository Engineering** — determinism, predictability, and standardized protocols for scoped agent work. It is **not** a real-time conversational wrapper and **not** a cloud observability product (see [Gantry.io](https://gantry.io) for that category).

| Concern | Improvised agent workflow | Cloud agent / observability dashboard | OpenGantry (GXT) |
|---------|---------------------------|---------------------------------------|------------------|
| **Scope** | Implicit; edits anywhere the model chooses | Session visibility in vendor UI; repo policy varies | Declared **tmvc_roots** + **forbidden zones** |
| **Approval** | None or ad-hoc prompts | Vendor workflow / RBAC | Planner **`[MSN-XXXX]`** commit before executor execution |
| **Audit trail** | Local JSON / chat logs (if any) | Vendor-retained telemetry | Mission YAML + **`EXECUTOR_LOG.md`** in Git |
| **Recovery** | Custom error handling per script | Vendor dashboards + support | Stable **`GXT_*`** codes, `gantry verify --fix`, `--audience` |
| **Enterprise fit** | Hard to explain to risk/compliance | Strong fleet visibility; per-repo Git evidence may need extra tooling | Greppable history: `git log --grep='MSN-'` |

**Non-goals:** always-on improvisation, unscoped IDE writes as source of truth, replacing your CI — GXT adds a **narrow inspectable envelope** on top of Git.

---

## Reproducible benchmark

Clone this repository and compare a **pedagogical orchestrator specimen** against OpenGantry TMVC on the same task:

```bash
git clone https://github.com/jeger-ai/opengantry.git
cd opengantry
npm ci && npm run build
npm run examples:benchmark
```

**What this is (and is not):** the raw-script phase compresses common anti-patterns into one file. Most teams do not ship a monolithic orchestrator; the benchmark still shows that **without a Git-native protocol envelope, structure and auditability are improvised.**

Contrast specimens: [`examples/contrast-agent-script/`](../examples/contrast-agent-script/) vs [`examples/gantry-minimal/`](../examples/gantry-minimal/). Full harness: [`examples/benchmark-agent/`](../examples/benchmark-agent/).

Machine-readable: `npm run examples:benchmark -- --json`.

---

## Custom domains without built-in adapters

Accounting, legal, or proprietary corpora: use `gate_command` scripts and TMVC path globs. Document patterns in your repo's `ARCHITECTURE.md`. Built-in adapters cover `code` and `content`; everything else follows the same mission loop.

See [`DOMAINS.md`](DOMAINS.md) § Recipes without built-in adapters.

---

## Related docs

| Goal | Doc |
|------|-----|
| Install and daily loop | [`ADOPTION.md`](ADOPTION.md) |
| First mission practice | [`KATA.md`](KATA.md) |
| Why each feature exists | [`FEATURES.md`](FEATURES.md) |
| Wire your IDE | [`INTEGRATIONS.md`](INTEGRATIONS.md) |
