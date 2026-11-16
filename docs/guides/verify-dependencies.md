---
title: "Dependency admission in verify"
description: "With a dependencies policy in verify.yaml, gantry verify --contract judges the npm lockfiles a change touched and signs the verdict with its result."
section: guides
order: 14
---

# Dependency admission in verify

When the base `verify.yaml` has a `dependencies` section (the policy: see [the contract guide](verify-contract.md#dependencies)), every `gantry verify --contract` run judges the dependency files the change touched (root and nested `package.json`, `package-lock.json`, `npm-shrinkwrap.json`):

- **Authority comes from the base commit.** The policy, the signed approvals under `approval_refs`, the allowed signers (`.gitagent/foreman/PLANNER.signing.pub`), the base lockfile graph, the baseline graph and the content digests of `file:` folders are git objects at the base. A change that edits any of them is judged by the base version. A task contract (a `gate.json`, a handover `verify.yaml`) inherits the policy tighten-only; its own `dependencies` section is refused (`GXT_VERIFY_CONTRACT_INVALID`) unless the base `verify.yaml` has one for it to tighten.
- **Each changed lockfile** is parsed with its sibling `package.json` and judged against the policy: every package must be in the baseline import or in a signed, unexpired, unrevoked approval, and something new needs an approval made for exactly the head graph. The baseline is the base graph when its digest is `approved_baseline_digest`, else the newest of the last 50 base revisions of that lockfile with that digest.
- **Around it, these hold:** `yarn.lock`, `pnpm-lock.yaml`, `bun.lock(b)` and lockfileVersion 1 (unsupported); anything under `node_modules/`; a `package.json` whose lockfile did not change, or that has no lockfile; a lockfile removed while its `package.json` stays; root dependencies or workspaces in `package.json` that differ from the lockfile root.
- **`mode: enforce`**: a hold or fail is a problem, so the run fails. **`mode: audit`**: the verdict is reported and labelled, and the run does not fail on it.
- **Signed.** The section is part of the result `--sign` and `--sign keyless` sign, so the verdict is bound to the base, head, policy revision and graph digests.

## Import a baseline, approve packages

To import a baseline, run once in audit mode and copy the `base_graph` digest of the lockfile from the result into `approved_baseline_digest`, in a change of its own. Approvals are signed JSON files under `approval_refs`, read from the base commit; their format and signature are in the design notes below. A `file:` folder is approved by its path and its `opengantry.content-digest.v1` at the base (`contentDigestAt` in the library); a change that edits the folder holds until a new approval is at the base.

## The dependencies section

With a policy, the result is `opengantry.verify-result.v2`: the fields of `opengantry.verify-result.v1` plus a mandatory `dependencies` section (`opengantry.verify-dependencies.v1`). A reader that only knows v1 refuses it by its schema check instead of ignoring the verdict, and `--check-result` refuses a v1 result for a contract with a policy. The section is digest-only:

```jsonc
"dependencies": {
  "schema": "opengantry.verify-dependencies.v1",
  "outcome": "hold",                  // pass | hold | fail: the worst reason
  "mode": "enforce",                  // the policy's mode
  "enforcement": "audit",             // always: a post-change check cannot prevent what already ran
  "base": "<sha>", "head": "<sha>",
  "policy_revision": "<sha256>",      // of the effective dependencies section
  "ecosystems": ["npm"],              // what this reader judges; other dependency files hold
  "files": ["package-lock.json", "package.json"],
  "lockfiles": [{ "path": "package-lock.json", "outcome": "hold", "base_graph": "<sha256>", "head_graph": "<sha256>", "graph_diff": "<sha256>", "approvals_used": [] }],
  "approvals_used": [],
  "reasons": [{ "code": "unapproved_identity", "severity": "hold", "file": "package-lock.json", "location": "node_modules/b", "detail": "b@1.0.0 registry:https://registry.npmjs.org/ sha512-… is not in the baseline or any approval" }]
}
```

`pass` means the configured admission requirements are met for exactly these inputs; it is not a claim that the packages are harmless. The evaluator's reason codes are listed in the design notes (decision 7); verify adds `unsupported_dependency_file`, `node_modules_changed`, `manifest_without_lockfile`, `manifest_without_lock_change`, `manifest_lock_mismatch`, `lockfile_missing` (hold) and `lockfile_removed` (info).

## Using the verdict downstream

A tool that gates on the verdict (a merge bot, a deploy step) should check the signature, then the section, and refuse what it does not know:

```js
import { checkVerifyResult, verifyDependenciesProblem, VERIFY_RESULT_SCHEMA_V2 } from "@jeger-ai/opengantry-verify";

const { ok, problems, result } = checkVerifyResult("verify.json", { base, allowedSigners: ".github/allowed_signers" });
if (!ok) throw new Error(problems.join("; "));               // also refuses a v1 result for a contract with a policy
if (result.schema !== VERIFY_RESULT_SCHEMA_V2) throw new Error("no dependency verdict");
const problem = verifyDependenciesProblem(result.dependencies);   // the strict zod schema
if (problem) throw new Error(problem);
const d = result.dependencies;
if (d.outcome !== "pass") throw new Error(`dependencies ${d.outcome}: ${d.reasons.map((r) => r.code).join(", ")}`);
// d.enforcement is "audit": the packages may already have run code in the agent's environment.
// Do not use this verdict where a workflow requires prevention.
```

In SARIF, each hold or fail is a `verify/dependency-<code>` result on its file: an error under `mode: enforce`, a warning under `audit`. JUnit has a `dependencies` case, skipped as `dependencies (audit)` under audit when something holds.

## Limits

- It runs after the change was made. It can fail the run and block a merge; it cannot stop an install script that already ran in the agent's environment, so every result says `enforcement: audit` and cannot satisfy a workflow that requires prevention.
- Only npm `package-lock.json` and `npm-shrinkwrap.json` at lockfileVersion 2 and 3 are judged. `overrides` and workspace `package.json` scripts are not read; install scripts are known from npm's `hasInstallScript`.
- `pass` is fixture-tested evidence that the policy's requirements are met for these exact inputs (unit tests and a conformance golden); no live npm installation is part of it.

Design notes: [ADR-0062 dependency admission](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0062-dependency-admission.md).
