---
title: "Feature factory acceptance contract"
description: "Versioned verification input and acceptance criteria for controller-authorized candidates."
publish: false
---

# Feature factory acceptance contract v1

A direct request may go from a frozen file list to verification in one attempt. A factory can use the same contract for a bug or a story derived from an approved feature. Request text drives discovery in the factory. Path risk, scope and gates determine merge eligibility.

## Trusted inputs

GitHub Actions, Bitbucket Pipelines and Hangar serialize the same strict JSON shape defined by `verifyInput` in `packages/verify/src/factory-input.ts`. The stateless library entry point is `verifyFactoryCandidate(root, raw)`. Invalid input or unreadable Git objects raise an error. A successful evaluation returns the exact candidate SHA, eligibility and findings with a code and subject. The existing mission CLI and ADR-0027 result formats have their own interfaces.

A trusted controller freezes the repository, work item, unique attempt and immutable record ID, full base commit SHA, exact allowed files and required gate digests before launching the worker. Each digest identifies the check implementation, inputs and invocation. Standing policy can authorize Tier 1 automatically. The verifier retrieves authorization by trusted job assignment. Worker credentials must have no access to modify records, impersonate the independent runner, or supply any field of the controller envelope.

The controller supplies the effective policy compiled from the trusted base, including organization floors, protected checks, forbidden paths and Tier 2/3 roots. Path prefixes end at component boundaries. The default tier is 1. Policy compilation belongs to the trusted integration; supplying a matching base string alone cannot authenticate a policy. Verify the queue's current base and policy again immediately before merge.

## Evaluation and handoff

* The trusted inventory identifies staged, unstaged and untracked changes at worker handoff. Each blocks, including an untracked file at an allowed path. Ignored files and worker Git metadata never enter the runner. Use a clean object checkout, independent Git configuration, pinned gate inputs and isolated credentials.
* Compare base and candidate trees with rename detection disabled. Check each deletion and addition independently. Report all applicable scope and risk findings. A forbidden change blocks even when declared. Tier 2 requires trace review. Route Tier 3 to the repository's prescribed verification and audit process.
* New or changed symlinks and gitlinks block in v1. Executable changes require an exact policy allowance. File lists use canonical repository-relative paths.
* A protected expectation can change only through a named human's literal amendment scoped to the record, file, original blob, UTF-16 offset and exact old and new JSON string literals. The controller offers only an assertion's expected-value operand for approval. Compare the entire resulting blob. A selector change, removed assertion or changed runner requires separate policy review.
* An independent runner supplies exactly one passing receipt per required gate for this record and candidate. Every repair, rebase or queue update that changes the candidate requires fresh evidence. The queue merges only the evaluated revision.
* An incidental undeclared Tier 1 edit rejects the attempt. The harness may construct a fresh candidate from the base and authorized changes, preserving the rejection record. Do not split a rename, carry forward gate receipts or widen the authorization during repair. Preserve higher-risk findings for review. A gate failure blocks merge immediately; the factory escalates after the third unsuccessful round or when a decision is needed.

## Acceptance suite

Run `npm run build` followed by `node --test dist/cli/tests/factory-acceptance.test.js`. The suite creates temporary repositories and calls the library. Controller identities, receipt issuance, review routing and merge-queue isolation are deployment responsibilities that each integration must test in its own environment.
