---
title: "The Post-PR Software Factory"
description: "OpenGantry's north star: a deterministic referee in the inner loop, law owned at each flight level, and a ladder from cage to verify to the org plane."
section: about
order: 1
---

# The Post-PR Software Factory

AI-assisted engineering scales code generation without limit while human review capacity stays fixed. OpenGantry is built for a different future: machines check agent work against laws that people own, before that work reaches review.

## The bottleneck: the outer-loop trap

Today agents write code, open pull requests and wait for human engineers or AI reviewers to catch their mistakes. That loop leaks in two places.

- **Review fatigue.** When agents produce change faster than people can read it, review stops guaranteeing anything about architecture.
- **Probabilistic review.** A model reviewing a model's code swaps one hallucination risk for another. It may catch a typo, but it cannot prove that a module boundary still holds.

## From reviewer to referee

Governance has to move from the outer loop, the pull request after the fact, into the inner loop, where agents generate code. Execution is a graph: intent fans out to parallel executors, and OpenGantry referees each edge. "Inner" and "outer" say where work runs, not an order of steps.

Trusting the model is not enough either. Between an agent and the model sit API routers and proxies, and published attacks on that path tamper with what the agent receives and does ([arXiv:2604.08407](https://arxiv.org/abs/2604.08407)). A referee on your machine and in your CI judges the files that changed against the law, whoever or whatever produced them.

A reviewer leaves comments and asks the agent to fix a structural mistake. A referee returns an exit code. Its rules are machine-checkable: edit scope, forbidden zones, import layers, content patterns and the mission's own gate command. When a rule is broken the work does not land, and the agent gets a structured finding it can act on. [Enforcement boundary](concepts/enforcement-boundary.md) separates the mechanisms that fail closed from the ones that only guide.

## Who owns which law

Removing line-by-line code review does not leave one Architect writing every rule. Technical law is decided at five levels, and each level writes it into its own artifact.

| Level | Owner | Decides | Artifact |
|-------|-------|---------|----------|
| Enterprise | Executives, security | Framework, mandatory gates, signature and telemetry floors | [Org policy floor](guides/org-control-plane.md#org-policy-floor) |
| System | System architect | Architecture across applications | Banned imports and manifest constraints in the org policy |
| Application | Application architect | Architecture and design of one application | [Target architecture perimeters](concepts/perimeters.md) |
| Module | Technical module owner | Scope, forbidden zones, risk tier and gates inside a module | [Skill entries in the manifest](concepts/scope.md) |
| Execution | Planner | The cage for one task | [Mission intent and contract](concepts/missions.md#contracts), or [`.cage.yaml`](cage/cage-yaml.md) for the cage alone |

Levels compose in one direction. A lower level may narrow what a higher level allows and may never widen it: sets are unioned, risk tiers take the maximum, and a mission's edit roots must sit inside its skill's. The upper levels change rarely and live in protected paths. A single task is sealed by one Planner commit.

The business side of the work, such as epics, roadmaps and requirements, lives in the product tool you already use. It reaches OpenGantry in exactly two places: the mission's intent, the plain-text story the Planner commits, and its gate command, the deterministic acceptance test that story must pass. A task needs no second, business signature. Where an organisation wants business sign-off, it happens in the product tool before the mission is written.

Planner, Executor and Verifier stay what they are: steps of a mission, not job titles. One person may hold several roles and levels. Business ownership and technical ownership usually sit with different people.

## The adoption ladder

You do not adopt everything at once. Each step works on its own, and each adds law on top of the one before.

| Step | Protects | For | On a breach |
|------|----------|-----|-------------|
| [Cage](cage/index.md) | Files no agent should change on its own: CI configs, `.env` files, git hooks and config, and paths you add | Any developer running an agent today, with no setup | A commit that touches them fails the pull request check, a watched change waits for your answer, and a caged session restores them and stops an agent that keeps rewriting them |
| [Verify](concepts/verify.md) | Mission scope, architecture rules and the mission's gate | Teams that want agents to work inside declared scope | The work does not land, and the agent gets structured findings to retry on |
| [Plane](guides/org-control-plane.md) | An org-wide policy floor, a digest-only audit ledger and cross-repository dependencies | Organisations that need one policy and one audit trail across repositories | Local rules are raised to the floor, a tampered or unsigned policy fails closed, and the ledger records each run |

The cage and verify answer different questions. The cage guards fixed files, and an agent that rewrites `.env` again and again is stuck or compromised, so it is stopped, not coached. Feedback an agent can iterate on belongs to verify: a failed gate returns findings, and the agent tries again until the gate passes.

## Floors that never move

Some guarantees hold at every step and every level, whatever a repository configures.

- **Decisions are deterministic.** Pass and fail come from commands and exit codes, never from a model's judgment.
- **Invalid law fails closed.** A broken manifest, cage config, contract or policy stops the run before any work starts.
- **Built-in protections are a floor.** Nothing in the working tree can remove or weaken the cage's built-in rules, and project rules can only add.
- **Lower levels only tighten.** No mission, skill or repository can grant what a level above it withholds.
- **Law is written outside the agent loop.** A Planner commits and stamps the scope in Git before work starts, and an agent cannot widen its own scope mid-task.
- **The executor never verifies itself.** The agent that runs the gate is not the one that declares it passed, and every pass binds to a run record the CLI wrote about a named tree, not to a claim the agent typed.
- **The plane sees digests, not code.** Each repository stays its own enforcer. The org plane receives hashes and keyed digests, never source, gate output or plain identities.

## The crucible: autonomous assembly

This is the direction, not today's default. In the end state the lifecycle runs without a human bottleneck:

1. **Intent.** A product owner's story becomes a mission: intent, scope and a gate.
2. **Execution.** Agents generate code in parallel, each inside its mission's scope and its cage.
3. **Referee.** Before the work lands, verify checks it against the law of every level. A scope escape, a forbidden import or a failing gate is rejected, and the finding goes straight back to the agent instead of to a human.
4. **Output.** The agent iterates until the gate returns exit 0.

By the time code reaches staging, it has passed every rule its owners wrote down. You stop reviewing software line by line. You own the laws, and the machine that checks them.

Design notes: [ADR-0049 flight levels](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0049-flight-level-decision-model.md), [ADR-0048 cage trust model](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0048-cage-trust-model.md), [ADR-0042 org policy floor](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0042-org-policy-bundle.md), [ADR-0034 hub and spoke](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0034-hybrid-hub-spoke-metadata-plane.md).
