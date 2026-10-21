---
id: ADR-0059
title: Plan adapters — another framework's plan becomes a verify contract and a cage scope
status: ACTIVE
match_terms:
  - adapt
  - plan
  - lights-on
  - spec kit
  - verify.yaml
  - allow_only
---

# ADR-0059: Plan adapters — another framework's plan becomes a verify contract and a cage scope

## Context

Agent frameworks write down what a task may touch in their own plan format: lights-on-software-factory names `Files to create`, `Files to modify` and `Files to delete` per step, Spec Kit and others have task files. None of them checks that a worker stayed inside those lists; a command-shape regulator does not (jeger-ai/opengantry#301, gojko/lights-on-software-factory#1). OpenGantry has the checks (`verify --contract` judges the committed change against `allowed_paths`; the session cage with `--allow-only` puts every other write back), but users had to write the `verify.yaml` and the cage flags by hand for every step. The agent-cheat-demo carries a script that does it for lights-on plans.

## Decision

1. **`gantry adapt --from <format> <plan>`** reads a plan, takes the files one step (`--step`) or every step names, and prints the `verify.yaml` for that scope (or writes it with `--out`), plus the matching `gantry cage --allow-only …` flags on stderr; `--json` returns the files, the YAML and the flags.
2. **The contract it writes:** the named files are `allowed_paths`; the run's own machinery and what no step owns are `forbidden_paths` (`.claude`, `.gitagent`, npm/yarn/pnpm lockfiles, `plans`, `verify.yaml`); `--check <command>` adds checks. A human commits it before the step runs, so verify reads it from the base commit and the step cannot widen it.
3. **New files by allowance, not by guessing.** A step that is expected to split a file gets `--allow-new <dir>`: that folder joins `allowed_paths` (and the cage scope). The allowance is in the committed contract, and the result lists every changed path.
4. **Adapters are data readers, deterministic, fail closed.** Each format is an adapter in `packages/verify/src/plan-adapters.ts` (`id`, `read(text, step)`). A plan without the notation, a step without its three lists, or an unknown step is an error (exit 2), never a best effort. No model is involved.
5. **First adapter: `lights-on`** (`#### Step <n>:` headings with the three bold list headings, backquoted paths, `none`). Other formats are added when a user brings a plan; a third-party format change is a new adapter version, not a silent reinterpretation.
6. **Library.** `adaptPlan` is exported by `@jeger-ai/opengantry-verify`, so an orchestrator can generate the contract in process.

## Consequences

- Any framework that writes plans can use OpenGantry as its enforcement backend without its authors adding code: the plan is the input, the contract and the cage scope are the output.
- The adapter owns a dependency on someone else's notation; it is pinned by tests with a sample plan, and breaks loudly when the notation changes.
- The agent-cheat-demo script can be replaced by `gantry adapt --from lights-on` once 4.0.0 is published.
