---
title: "When to adopt OpenGantry"
description: "The situations and teams OpenGantry fits, how it compares with improvised agent scripts and hosted dashboards, and what it is not."
section: concepts
order: 7
---

# When to adopt OpenGantry

Adopt OpenGantry when agent speed is valuable but unreviewed scope creep, quiet edits to governance files, or unverifiable "it works" claims are not acceptable.

## Typical triggers

| Situation | Without governance | With OpenGantry |
|-----------|--------------------|-----------------|
| IDE agents edit anywhere | Implicit scope; governance files drift | Declared edit roots and forbidden zones in the mission and manifest |
| "It passed locally" | Chat logs or ad-hoc JSON | Mission YAML, gate output and verbatim `EXECUTOR_LOG.md` quotes in Git |
| Architecture or copy drift | Manual review only | `TARGET_ARCHITECTURE.yaml` with `gantry arch check` or `gantry perimeter check` |
| Autonomous retry loops | Parsing terminal stderr | A stable `findings[]` envelope with file, line and hint |
| A new policy per repository | Reinventing orchestration each time | `gantry init` scaffolds the same substrate everywhere |
| No org-wide floor or audit chain | Per-repository conventions | A tighten-only org policy, a digest-only ledger and cross-repository gates |

## Who it is for

**Teams already doing TDD who still babysit IDE agents.** Your tests and CI are solid, but agents edit outside the intended blast radius and misread failures. You need the same gates with structured retry input and scope locked in Git, not another test framework ([Verify](verify.md)).

**Regulated engineering** (fintech, health, critical infrastructure). Auditors ask how AI-assisted coding fits your information security or AI management system, not how good your prompts are. OpenGantry produces operational records: Planner commits, mission scope, executor trace and verify output ([Regulated teams](../guides/regulated-teams.md)).

**Platform and platform-security teams.** You need blast-radius control before agents get write access: the `runtime exec` process boundary, hooks on governance paths and merge-time verify, with the advisory tiers stated honestly ([Enforcement boundary](enforcement-boundary.md)).

**Autonomous orchestrators** (Hermes-style runners, CI bots, custom runners). The executor implements; OpenGantry owns the contract and the verdict. On failure it consumes `findings[]`, never scraped logs ([Agent graphs](../guides/agent-graphs.md)).

**Content and brand compliance.** The same graph governs TypeScript imports and marketing copy, with pattern rules that report file and line ([Content governance](../guides/content-domain.md)).

**Teams replacing improvised agent scripts.** Many teams run IDE agents with no orchestrator; others ship one-off `agent-run.mjs` files with ad-hoc state and guessed scope. OpenGantry replaces that with a Git-native protocol: legislation commits, pinned missions and a verify-gated workflow.

## Compared with the alternatives

OpenGantry is about determinism, predictability and a standard protocol for scoped agent work. It is not a real-time conversational wrapper and not a cloud observability product.

| Concern | Improvised agent workflow | Cloud agent or observability dashboard | OpenGantry |
|---------|---------------------------|----------------------------------------|------------|
| Scope | Implicit; the model edits wherever it chooses | Session visibility in the vendor UI; repository policy varies | Declared edit roots and forbidden zones |
| Approval | None, or ad-hoc prompts | Vendor workflow and roles | A Planner commit before the executor runs |
| Audit trail | Local JSON or chat logs, if any | Telemetry the vendor keeps | Mission YAML and `EXECUTOR_LOG.md` in Git |
| Recovery | Custom error handling per script | Vendor dashboards and support | Stable `GXT_*` codes, `gantry verify --fix`, `--audience` |
| Enterprise fit | Hard to explain to risk and compliance | Strong fleet visibility; per-repository Git evidence may need extra tooling | Greppable history: `git log --grep='MSN-'` |

OpenGantry does not aim for always-on improvisation, does not treat unscoped IDE writes as the source of truth, and does not replace your CI. It adds a narrow, inspectable envelope on top of Git.

## What OpenGantry is not

- **Not an agent.** It does not chat, plan features or open pull requests by itself.
- **Not a hosted execution console.** Gates and cages run on your machine and in your CI. Verify uploads no source.
- **Not Gantry.io.** There is no bundled hosted observability dashboard. An optional future metadata hub would receive digests only.
- **Not an LLM judge for merge.** Gates stay deterministic: shell commands with an exit code.
- **Not an MCP execution firewall.** Sandboxing and skill-hash checks belong to a complementary proxy ([Enforcement boundary](enforcement-boundary.md#opengantry-and-an-execution-firewall)).
- **Not a full prompt or diff recorder by default.** Hash-only telemetry and digest receipts prove outcomes without shipping raw content.
