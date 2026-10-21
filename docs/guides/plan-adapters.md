---
title: "Plans from other frameworks (gantry adapt)"
description: "gantry adapt turns another agent framework's plan into the verify.yaml for one step and the cage scope for the session that runs it."
section: guides
order: 13
---

# Plans from other frameworks (gantry adapt)

Agent frameworks write down what a step may touch in their own plans. `gantry adapt` turns such a plan into the `verify.yaml` for that step and prints the cage scope for the session that runs it:

```bash
gantry adapt plans/format-greeting.md --from lights-on --step 1.1 --check "node --test" --out verify.yaml
# adapt: cage scope: gantry cage --allow-only src/format-greeting.js --allow-only src/format-greeting.test.js -- <agent>
```

The files the step lists become `allowed_paths`. The run's own machinery (`.claude`, `.gitagent`), lockfiles, `plans/` and `verify.yaml` are always `forbidden_paths`. A step that is expected to split a file gets `--allow-new <dir>`, so new files there pass and files anywhere else still fail. Commit the contract before the step runs. A plan without the notation, or a step without its three file lists, stops with `GXT_ADAPT_PLAN_INVALID` (exit `2`). The format supported so far is `lights-on` ([lights-on-software-factory](https://github.com/gojko/lights-on-software-factory): `#### Step <n>:` with **Files to create**, **Files to modify**, **Files to delete**). The library exports the same function as `adaptPlan`.

Then run the step inside the scope `adapt` printed, and verify the result against the committed contract. [Verify a change without missions](verify-contract.md) explains the contract and the run.

Design notes: [ADR-0059 plan adapters](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0059-plan-adapters.md).
