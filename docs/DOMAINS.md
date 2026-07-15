# Domain adapters (v3.0.0)

OpenGantry v3.0.0 is a **domain-agnostic governance layer for autonomous agents**. The mission/verify loop, trace mapping, failure envelope, and `gate_command` shell gates are domain-neutral. **Domain adapters** plug deterministic discovery, blueprint, and perimeter checks into that loop.

## Universal framing

| Phase | OpenGantry surface | What it does |
|-------|-------------------|--------------|
| **Context ingestion** | `gantry init --discover --domain <key>` | Walk corpus files; emit evidence-anchored conventions/anomalies |
| **Rules of engagement** | `gantry blueprint --domain <key>` | Human interview → `TARGET_ARCHITECTURE.yaml` + `verification_plan.json` |
| **Standardized audit API** | `gantry verify` + failure envelope `findings[]` | Deterministic gates + machine-readable verdicts for external executors |

## Built-in adapters (v3.0.0)

| Key | Corpus | Enforcement rules |
|-----|--------|-------------------|
| `code` | `.ts`, `.js`, … | Import layers (`forbid_import_layer`, `forbid_specifier_substring`, …) |
| `content` | `.md`, `.html`, `.txt`, `.json` | Regex perimeter (`forbid_pattern`, `require_pattern`) |

List adapters: `gantry domains`

### Determinism mandate

Everything in the trust path is binary and reproducible:

- **Enforcement:** regex rules either match or they do not; reruns on an unchanged tree are byte-identical.
- **Content discovery:** verbatim boilerplate blocks (≥2 files, exact byte match) and YAML frontmatter keys only — no statistical “dominant terminology.”
- **Code discovery:** coverage percentages are advisory proposal metadata; humans confirm before rules become law.

## Perimeter schema 0.3.0

`TARGET_ARCHITECTURE.yaml` gains optional `domain` and pattern rules:

```yaml
schema_version: "0.3.0"
domain: content
scan_roots:
  - content
layers:
  - id: content
    globs:
      - content/**
rules:
  - id: forbid-claim
    from_layer: content
    applies_to: ["content/**"]
    forbid_pattern: "(?i)cures cancer"
  - id: require-disclaimer
    from_layer: content
    applies_to: ["content/**"]
    require_pattern: "These statements have not been evaluated by the FDA"
```

Check: `gantry perimeter check` (domain-neutral alias of `gantry arch check`).

Schemas **0.1.0** and **0.2.0** remain supported for code-only adopters.

## Mission loop is domain-agnostic

Regardless of domain:

1. Planner legislates mission YAML (`gate_command` can be any shell command).
2. Executor works within TMVC roots / forbidden zones.
3. Trace rows land in `EXECUTOR_LOG.md`.
4. `gantry verify` runs gates and emits `findings[]` on failure.

See [`docs/AGENT-LOOP.md`](AGENT-LOOP.md) for Hermes-style executor integration.

## Recipes without built-in adapters

**Accounting, legal, custom corpora:** use `gate_command` scripts and TMVC path globs. Document patterns in your repo's `ARCHITECTURE.md`; add a custom adapter in v3.1+ via the registry extension point.

## Example

Full content loop fixture: [`examples/content-governance/`](../examples/content-governance/)

## Deferred (v3.1+)

- Runtime-loaded adapter plugins (npm packages registered in config)
- AI judge gate (#62)
- Built-in accounting/legal adapters

See ADR-0033 in `.gitagent/out-of-scope/ADR-0033-domain-adapters.md`.
