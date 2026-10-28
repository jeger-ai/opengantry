---
title: "Perimeters and domain adapters"
description: "TARGET_ARCHITECTURE.yaml rules for import layers and content patterns, and the built-in code and content domains."
section: concepts
order: 3
---

# Perimeters and domains

A mission authorizes scope. It should not authorize architecture violations or unbounded churn. A **perimeter** is the machine-checkable rule set in `TARGET_ARCHITECTURE.yaml` that `gantry arch check` and `gantry perimeter check` enforce.

OpenGantry enforces architectural boundaries such as import layers and content patterns. It is not a general full-repository AST scanner.

## The same graph, any domain

The mission and verify graph, trace mapping, the failure envelope and `gate_command` are domain-neutral. The `domain` key in `TARGET_ARCHITECTURE.yaml` picks which files the perimeter check reads and which rules apply:

| Key | Corpus | Rules |
|-----|--------|-------|
| `code` | `.ts`, `.js`, … | Import layers (`forbid_import_layer`, `forbid_specifier_substring`, …) |
| `content` | `.md`, `.html`, `.txt`, `.json` | Patterns (`forbid_pattern`, `require_pattern`) |

For accounting, legal or other corpora without a built-in domain, use `gate_command` scripts and edit-root globs, and document the patterns in your repository's `ARCHITECTURE.md`.

## Writing the rules

You write `TARGET_ARCHITECTURE.yaml` by hand and review it like code; there is no generator. `gantry verify --json` reports a violation as a finding with `offending_file` and `line` ([Verify](verify.md)). Enforcement is binary: a rule matches or it does not, and reruns on an unchanged tree are byte-identical.

## Perimeter file

Schema `0.3.0` adds an optional `domain` and pattern rules:

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

Schemas `0.1.0` and `0.2.0` remain supported for code-only repositories. Violations come back as findings with `offending_file` and `line`.

```bash
gantry arch check <files…>   # code: import and layer rules
gantry perimeter check       # domain-neutral alias, same engine
gantry arch fetch            # resolve an external architecture pointer (kind: external) for offline checks
```

## Defensive profiles (parked)

Defensive profiles (severity-tiered guards on net lines changed, file scope, churn ratio and test-to-code, with `init` presets) are parked outside the CLI since 4.0: [`examples/defensive-profiles/`](https://github.com/jeger-ai/opengantry/tree/main/examples/defensive-profiles). A `defensive_profile` block in `config.json` is ignored, and `ledger.mode` must be set explicitly. The structural law in `TARGET_ARCHITECTURE.yaml` (layer budgets, owner, registry, dependency and duplicate rules) is the deterministic replacement.

## Not shipped yet

Runtime-loaded adapter plugins (npm packages registered in config) are on the roadmap. Until then, custom domains use `gate_command` and edit-root globs.

A worked content example is in [Content governance](../guides/content-domain.md).

Design notes: [ADR-0033 domain adapters](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0033-domain-adapters.md).
