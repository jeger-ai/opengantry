# OpenGantry documentation

<p align="center">
  <a href="https://opengantry.ai"><img src="assets/opengantry-logo.svg" alt="OpenGantry logo" width="64" height="64"></a>
</p>

> Product home: [https://opengantry.ai](https://opengantry.ai) · Source: [https://github.com/jeger-ai/opengantry](https://github.com/jeger-ai/opengantry)

OpenGantry docs map the **verification pipeline** — scope enforcement → architectural boundaries → static analysis → execution gates with `findings[]` remediation — then how to adopt it in your repository. Version history lives in one place: [`CHANGELOG.md`](CHANGELOG.md).

| Location | Purpose |
|----------|---------|
| **This folder (`docs/`)** | Adopter runbooks, feature insights, integration guides, contributor docs |
| **`.gitagent/`** | GXT substrate law, missions, manifest, planner skills |
| **Root `README.md`** | Product pitch and verification pipeline — start with [The Verification Pipeline](../README.md#the-verification-pipeline) and [In plain English](../README.md#in-plain-english) |

**Pipeline quick links:** [`FEATURES.md`](FEATURES.md) (core capabilities) · [`DOMAINS.md`](DOMAINS.md) (architectural boundaries) · [`ADOPTION.md`](ADOPTION.md) (legislate → verify)

---

## How — use OpenGantry

| Doc | When to read |
|-----|--------------|
| [`ADOPTION.md`](ADOPTION.md) | Install, mission loop, troubleshooting, hooks |
| [`KATA.md`](KATA.md) | 15-minute first mission practice |
| [`INTEGRATIONS.md`](INTEGRATIONS.md) | Wire Cursor / Claude / Codex / CI |
| [`DOMAINS.md`](DOMAINS.md) | Architectural boundaries (code/content) — not full-repo AST |
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
| [`FEATURES.md`](FEATURES.md) | Core capabilities: TMVC, perimeters, static gates, deterministic feedback |
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
