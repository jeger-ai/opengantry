---
title: "Content governance"
description: "Govern brand and compliance copy with the content domain adapter: discover boilerplate, write pattern rules, and fail on forbidden claims."
section: guides
order: 8
---

# Content governance

The same mission and verify graph that governs TypeScript imports governs marketing copy. The `content` adapter scans `.md`, `.html`, `.txt` and `.json` files and enforces pattern rules: `forbid_pattern` for claims that must never appear, `require_pattern` for boilerplate that must.

## Walk through the example

The repository ships a fixture in [`examples/content-governance/`](https://github.com/jeger-ai/opengantry/tree/main/examples/content-governance) with three seeded violations:

| File | Violation | Rule |
|------|-----------|------|
| `content/ad-bad.md` | The forbidden claim `cures cancer` | `forbid_pattern` |
| `content/ad-incomplete.md` | The required FDA disclaimer is missing | `require_pattern` |
| An ad using `#FF0000` | Wrong brand colour instead of the approved `#1A2B3C` | `forbid_pattern` |

From a clone of the repository, after `npm run build`:

```bash
node dist/cli/index.js init --discover --domain content --yes --cwd examples/content-governance
node dist/cli/index.js perimeter check --cwd examples/content-governance
# expect the three violations; fix the files and rerun until it passes
```

## Do it in your repository

```bash
gantry init --discover --domain content   # propose conventions from your corpus
gantry blueprint --domain content --yes   # write TARGET_ARCHITECTURE.yaml and the verification plan
gantry perimeter check                    # enforce the rules
```

Discovery proposes only what it can prove: verbatim boilerplate blocks that appear byte-identical in at least two files, and YAML frontmatter keys. It never infers "dominant terminology" from statistics. Nothing becomes a rule until you confirm it.

Rules look like this:

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

Use `gantry perimeter check` as the mission gate, or as one step of it. A violation comes back as a finding with `file` and `line`, so a writing agent can fix the exact sentence:

```json
{
  "failed_gate": "arch",
  "offending_file": "content/ad-bad.md",
  "line": 3,
  "severity": "error",
  "resolution_hint": "..."
}
```

Corpora without a built-in adapter, such as accounting or legal text, use `gate_command` scripts and edit-root globs in the same graph ([Perimeters](../concepts/perimeters.md)).
