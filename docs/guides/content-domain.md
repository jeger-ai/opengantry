---
title: "Content governance"
description: "Govern brand and compliance copy with the content domain: write pattern rules in TARGET_ARCHITECTURE.yaml and fail on forbidden claims."
section: guides
order: 8
---

# Content governance

The same mission and verify graph that governs TypeScript imports governs marketing copy. The `content` domain scans `.md`, `.html`, `.txt` and `.json` files and enforces pattern rules: `forbid_pattern` for claims that must never appear, `require_pattern` for boilerplate that must.

## Walk through the example

The repository ships a fixture in [`examples/content-governance/`](https://github.com/jeger-ai/opengantry/tree/main/examples/content-governance) with three seeded violations:

| File | Violation | Rule |
|------|-----------|------|
| `content/ad-bad.md` | The forbidden claim `cures cancer` | `forbid_pattern` |
| `content/ad-incomplete.md` | The required FDA disclaimer is missing | `require_pattern` |
| An ad using `#FF0000` | Wrong brand colour instead of the approved `#1A2B3C` | `forbid_pattern` |

The fixture ships its `TARGET_ARCHITECTURE.yaml`. `gantry` judges the repository it runs in, so copy the fixture into its own repository first:

```bash
cp -r examples/content-governance /tmp/content-governance && cd /tmp/content-governance
git init -q && gantry init --yes --no-hooks --no-ci   # keeps the fixture's TARGET_ARCHITECTURE.yaml
gantry arch check
# expect the seeded violations; fix the files and rerun until it passes
```

## Do it in your repository

Write `TARGET_ARCHITECTURE.yaml` at the repository root with `domain: content` and one rule per claim or required block, then run `gantry arch check`. Each rule is a plain regular expression, so a rule matches or it does not, and reruns on an unchanged tree are byte-identical:

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

## In a mission

Use `gantry arch check` as the mission gate, or as one step of it. A violation comes back as a finding with `offending_file` and `line`, so a writing agent can fix the exact sentence:

```json
{
  "failed_gate": "arch",
  "offending_file": "content/ad-bad.md",
  "line": 3,
  "severity": "error",
  "resolution_hint": "..."
}
```

Corpora without a built-in domain, such as accounting or legal text, use `gate_command` scripts and edit-root globs in the same graph ([Perimeters](../concepts/perimeters.md)).
