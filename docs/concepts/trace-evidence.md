---
title: "Trace evidence"
description: "Why verify demands verbatim quotes from EXECUTOR_LOG.md, how stale evidence is detected with git blame, and how to keep the log stable."
section: concepts
order: 5
---

# Trace evidence

A verifier must cite verbatim execution evidence, not source code alone, or a PASS claim is ungrounded. `EXECUTOR_LOG.md` at the repository root holds that evidence: the executor appends gate output to it, and each mission trace row quotes it.

## The rule

- Every claimed PASS needs a **trace reference**: a verbatim substring of `EXECUTOR_LOG.md` and an anchor, a line number or a timestamp, that ties it to the log.
- Source-code quotes cannot be the sole or primary evidence. Code may supplement a valid trace reference.
- A quote that is not in `EXECUTOR_LOG.md`, or a PASS without a reference, is **evidence tampering**: the mission fails and does not merge.

```yaml
trace_rows:
  - dod_id: "1"
    trace_quote: "tests 412 pass 412 fail 0"
    anchor: "88"
    status: PASS
```

With a numeric anchor, that 1-based line must contain the quote.

## Stale evidence

Evidence must describe the code that is merged, not an earlier version. After the gate and quote mapping, full verify binds each **committed** PASS quote to the mission skill's full edit roots:

1. Resolve the quote's line: numeric anchor, fuzzy drift, or freeform anchor plus quote.
2. Run `git blame --porcelain` on that line to find the attestation commit. An uncommitted line (all-zero blame) is skipped, since trace and code are still changing together in the working tree.
3. Run `git diff --name-only <attestation commit> -- <edit roots…>` against the working tree. Any listed path means the evidence is **stale** (`GXT_TRACE_STALE`).

To fix it, rerun the gate, append a fresh unique line to `EXECUTOR_LOG.md`, update the mission's `trace_quote`, commit, and verify again. Interactive rebase or squash can invalidate historical attestation; expect to refresh trace rows afterwards.

`gantry verify --skip-stale-evidence` (MCP: `skip_stale_evidence`) is a migration escape hatch. The check uses Git's diff engine, so line endings and `.gitattributes` behave the same on every platform.

## Keep the log stable

Anchors and `git blame` bind to committed line numbers, so a formatter that rewrites `EXECUTOR_LOG.md` causes avoidable drift. Add it to `.prettierignore`, or the equivalent for your formatter: Biome `files.ignore`, an ESLint ignore, or an editor's format-on-save exclude. `gantry init` and `gantry upgrade apply` add the Prettier entry automatically.

Verify resolves formatter line drift on its own; `--strict-trace` demands exact line numbers.

## Context requests and stamps

The log also records **context requests** before any access outside the mission scope ([Scope](scope.md#working-outside-the-scope)).

Executors may append optional `[SKILL-EXEC] skill_key=<provider::skill> tool=<tool_name> scope=<path_or_glob>` lines as context for human reviewers. They are not cryptographic proof, a missing stamp is not a verify failure, and a stamp never replaces a trace quote.

## How strong is this?

Trace mapping is process control, not cryptographic tamper-proofing. Evidence integrity rests on Git history, hooks and verify gates, and human review, not on proving a model could not lie. For digest receipts and an append-only chain, see [Org control plane](../guides/org-control-plane.md).
