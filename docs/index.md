# OpenGantry documentation

<p align="center">
  <a href="https://opengantry.ai"><img src="assets/opengantry-logo.svg" alt="OpenGantry logo" width="64" height="64"></a>
</p>

> Product home: [https://opengantry.ai](https://opengantry.ai) · Source: [https://github.com/jeger-ai/opengantry](https://github.com/jeger-ai/opengantry)

OpenGantry docs answer three questions: **how** to use it, **what** it helps with, and **why** its features exist. Version history lives in one place: [`CHANGELOG.md`](CHANGELOG.md).

| Location | Purpose |
|----------|---------|
| **This folder (`docs/`)** | Adopter runbooks, feature insights, integration guides, contributor docs |
| **`.gitagent/`** | GXT substrate law, missions, manifest, planner skills |
| **Root `README.md`** | Product pitch, feature tour, quick links — start with [In plain English](../README.md#in-plain-english) and [Why not just TDD and CI?](../README.md#why-not-just-tdd-and-ci) |

---

## How — use OpenGantry

| Doc | When to read |
|-----|--------------|
| [`ADOPTION.md`](ADOPTION.md) | Install, mission loop, troubleshooting, hooks |
| [`KATA.md`](KATA.md) | 15-minute first mission practice |
| [`INTEGRATIONS.md`](INTEGRATIONS.md) | Wire Cursor / Claude / Codex / CI |
| [`DOMAINS.md`](DOMAINS.md) | Code vs content domain adapters |
| [`AGENT-LOOP.md`](AGENT-LOOP.md) | External executor (Hermes-style) integration |

---

## What — problems it helps with

| Doc | When to read |
|-----|--------------|
| [`USE-CASES.md`](USE-CASES.md) | Personas, situations, contrast vs improvised agent workflows |
| [`examples/content-governance/`](../examples/content-governance/) | Brand/compliance content walkthrough |
| [`examples/benchmark-agent/`](../examples/benchmark-agent/) | Reproducible contrast benchmark |

---

## Why — feature insights

| Doc | When to read |
|-----|--------------|
| [`FEATURES.md`](FEATURES.md) | Why missions, TMVC, discover/blueprint/perimeter, verify, hooks exist |
| [`COMPLIANCE-ISO.md`](COMPLIANCE-ISO.md) | ISO 27001 / 42001 artifact mapping for regulated teams |

---

## Contributing (this repo)

| Doc | When to read |
|-----|--------------|
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Dogfood loop, missions, `npm run validate` |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Layer rules for `src/cli/` |

---

## Reference

| Doc | When to read |
|-----|--------------|
| [`SECURITY.md`](SECURITY.md) | Supported versions, reporting vulnerabilities, break-glass runbook |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history and upgrade notes |
| [`ADR-EPHEMERAL-VIRTUALIZATION.md`](ADR-EPHEMERAL-VIRTUALIZATION.md) | Virtual scratch contract (design record) |
| [`.gitagent/out-of-scope/`](../.gitagent/out-of-scope/) | Planner ADRs (deep design rationale) |
