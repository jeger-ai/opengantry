---
title: "Perimeters and domain adapters"
description: "TARGET_ARCHITECTURE.yaml rules for import layers and content patterns, the discover and blueprint phases, and the built-in code and content adapters."
section: concepts
order: 3
---

# Perimeters and domain adapters

A mission authorizes scope. It should not authorize architecture violations or unbounded churn. A **perimeter** is the machine-checkable rule set in `TARGET_ARCHITECTURE.yaml` that `gantry arch check` and `gantry perimeter check` enforce.

OpenGantry enforces architectural boundaries such as import layers and content patterns. It is not a general full-repository AST scanner.

## The same graph, any domain

The mission and verify graph, trace mapping, the failure envelope and `gate_command` are domain-neutral. **Domain adapters** plug deterministic discovery, blueprint and perimeter checks into it:

| Key | Corpus | Rules |
|-----|--------|-------|
| `code` | `.ts`, `.js`, … | Import layers (`forbid_import_layer`, `forbid_specifier_substring`, …) |
| `content` | `.md`, `.html`, `.txt`, `.json` | Patterns (`forbid_pattern`, `require_pattern`) |

`gantry domains` lists them. For accounting, legal or other corpora without an adapter, use `gate_command` scripts and edit-root globs, and document the patterns in your repository's `ARCHITECTURE.md`.

## Three phases

| Phase | Command | Output |
|-------|---------|--------|
| Context ingestion | `gantry init --discover --domain code\|content` | `.gitagent/discovery-proposal.json`, evidence-anchored; nothing becomes law until confirmed |
| Rules of engagement | `gantry blueprint --domain code\|content` | `ARCHITECTURE.md`, `TARGET_ARCHITECTURE.yaml`, `.gitagent/verification_plan.json` |
| Audit | `gantry verify --json` | Pass, or `findings[]` ([Verify](verify.md)) |

**Discovery is fast.** It uses streaming regex per file, not a whole-repository compiler graph, and is budgeted to finish a 5,000-file monorepo in under five seconds (pinned in CI). It proposes conventions and anomalies with `file:line` snippets.

**Blueprint turns confirmed conventions into rules.** The verification plan lists `gate_commands` and `required_skills`, so an external executor can build missing tooling before it starts coding.

## Everything in the trust path is binary

- **Enforcement:** a rule matches or it does not, and reruns on an unchanged tree are byte-identical.
- **Content discovery:** verbatim boilerplate blocks (at least two files, exact byte match) and YAML frontmatter keys only, no statistical "dominant terminology" that would flip on unrelated edits.
- **Code discovery:** coverage percentages are advisory proposal metadata; humans confirm before a rule becomes law.

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

## Defensive profiles

Defensive profiles add severity-tiered guards on top of the perimeter: net lines changed, file scope, and test-to-code ratio. `gantry init` offers presets during onboarding.

## Not shipped yet

Runtime-loaded adapter plugins (npm packages registered in config) are on the roadmap. Until then, custom domains use `gate_command` and edit-root globs.

A worked content example is in [Content governance](../guides/content-domain.md).

Design notes: [ADR-0033 domain adapters](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0033-domain-adapters.md).
