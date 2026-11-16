---
id: ADR-0062
title: Operation admission — a closed request/decision contract, and no prevention claim without proof
status: PROPOSED
match_terms:
  - operation admission
  - admission
  - permit
  - broker
  - pre-execution
  - capability matrix
  - process.spawn
  - network.connect
  - git.publish
  - delivery.mutate
---

# ADR-0062: Operation admission — a closed request/decision contract, and no prevention claim without proof

**Status: PROPOSED** (issue [#356](https://github.com/jeger-ai/opengantry/issues/356), work slices 1-2). This records a design for owner review. It ships no code and no schema, and it changes no existing guarantee. The field names, defaults and states below come from #356 "Detailed requirements R1" (2026-11-14). They are proposed contracts, not accepted configuration. Everything marked **Open** needs an owner decision before slice 3 starts.

## Context

#356 asks for policy enforcement before destructive or systemic agent operations, and for proof of every preventive claim. R1 picks the shape: typed trusted brokers for privileged operations, OS-enforced confinement for candidate code, and an explicit capability report. Anything not mediated is denied by default. If an agent can reach an equivalent unmediated path, preventive support for that operation is false.

The inventory ([`docs/concepts/operation-admission-coverage.md`](../../docs/concepts/operation-admission-coverage.md)) shows where OpenGantry stands at `be464fe9`:

- **No cell is `prevention`.** OpenGantry owns no OS boundary (ADR-0060 decision 1).
  - The pre-effect mechanisms are string-matching tool-call guards (read guard, ADR-0056; Cursor `beforeShellExecution`) and a Claude Code sandbox fragment that `gantry cage policy` prints for a human to merge.
  - No OpenGantry test exercises that fragment at the OS level.
- **`workspace.write` and `dependency.materialize` have real `detection`.** The session cage restores and halts (ADR-0048), `runtime exec` scans forbidden zones after exit, and `cage check`, verify and CI judge committed history (ADR-0050).
- **`network.connect` and `delivery.mutate` are `unsupported` everywhere.** `git.publish` has only a session push guard that the candidate can bypass.
- **Several authority inputs are readable or writable by a same-user candidate:** the MCP draft-token key, the break-glass anchor in the working tree, and hook code in `dist/`.
- **Windows has no evidence at all.**

ADR-0048 and ADR-0060 settle two points this design must respect. The cage detects and restores; it does not block. OpenGantry does not build its own sandbox; it configures the agent's. R1's "OS-enforced confinement" is compatible with ADR-0060 only if the confinement comes from the harness and is proven per harness and platform. Otherwise ADR-0060 decision 1 must be superseded. That is open question Q1.

## Decision (proposed)

### 1. Support levels and the no-claim rule

Every (operation family × platform × harness) cell carries exactly one of `prevention`, `unproven`, `detection`, `audit-only`, `unsupported`, as defined in the inventory.

- A cell is `prevention` only when a committed, disposable, local canary for that platform and harness shows the forbidden effect never occurs. The canary must cover nested processes, inherited handles, alternate executables, path/symlink substitution before use, and alternate transports (ADM-T01).
- A known equivalent unmediated path makes a cell `unproven`, whatever the mechanism.
- The levels are machine-readable. A capability report (slice 5) publishes the full matrix, including `unsupported` and `unproven` rows (ADM-T06).
- A Linux-only slice never closes the cross-platform acceptance by leaving other rows out.
- When a workflow requires `prevention` for an operation and the cell is anything less, the decision is `unsupported` and the launch or dispatch is refused.
  - Audit-only operation stays possible, but it is labeled. It never satisfies a requirement for prevention.

### 2. Operation families (ADM01)

The families are semantic policy categories, not syscalls. Each one names the resource identity a request must bind.

| `kind` | Covers | `resourceIdentity` binds |
|--------|--------|--------------------------|
| `artifact.read` | reading a file or secret store into a candidate or the model's context | canonical path plus stable file identity where available (device+inode on POSIX, volume serial plus file id on Windows), or a named secret reference |
| `workspace.write` | create, modify, delete, rename, chmod, symlink inside or outside the work tree | canonical path plus parent-directory identity, plus prior content digest or "absent" |
| `process.spawn` | starting a process: executable, argv, cwd, environment and inherited handles | resolved executable path plus file identity and digest, `argsDigest`, cwd identity, environment allowlist digest |
| `dependency.materialize` | resolving, fetching, unpacking, linking or running lifecycle code of third-party packages | supplied by #355: ecosystem, graph digest, artifact set (name, version, source, integrity), permitted scripts |
| `network.connect` | outbound connections from candidate code | canonical origin (scheme, host, port), resolved by the broker, not by the candidate |
| `git.publish` | pushing refs, tags or notes to a remote | remote URL identity, ref, expected old head, new head |
| `delivery.mutate` | host-API mutations: PRs, merges, reviews, releases, comments, deploys, package publish | host, repository or project id, object type and id, mutation name, expected precondition (for example head SHA or ETag) |

### 3. Request (ADM02)

A closed, versioned record. The schema id is `opengantry.admission-request.v1`, following the neutral `opengantry.*.v1` naming of `opengantry.gate.v1`.

| Field | Content |
|-------|---------|
| `schema` | `"opengantry.admission-request.v1"` |
| `operationId` | broker-assigned id for one logical operation. A retry of the same effect keeps it. |
| `attemptId` | broker-assigned id for one dispatch attempt. Every new execution attempt gets a new one, and needs new authorization (shared invariant). |
| `acceptedContractDigest` | sha256 of the accepted execution contract the consumer bound: a sealed mission contract (ADR-0045) or a verify contract (ADR-0051) |
| `resolvedPolicyDigest` | sha256 of the effective, tighten-only policy after merging the local law and the org floor (ADR-0042) |
| `actorIdentity` | who asks: harness, session and task ids from the trusted launcher, never candidate-supplied strings alone |
| `kind` | one family from section 2. An unknown kind is rejected. |
| `resourceIdentity` | the object for `kind`, with a closed per-kind shape |
| `argsDigest` | sha256 of the canonical arguments. Raw arguments stay with the broker, never in audit. |
| `capabilityEvidence` | the capability report entry (id, level, probe digest) for the cell the request runs in |
| `nonce` | 128-bit random value from the broker. It prevents replay and is not a secret. |

- Canonical form is the repository's canonical JSON (`packages/core/src/canonical-json.ts`) hashed with sha256.
- The default size cap is 64 KiB.
- Unknown fields, unknown kinds and malformed identities are rejected before evaluation (decision `deny`, reason `request_malformed`).
- Raw secrets never enter a request or audit. A secret is named by reference.

### 4. Decision and permit (ADM03)

The schema id is `opengantry.admission-decision.v1`.

| Field | Content |
|-------|---------|
| `decision` | `allow` \| `deny` \| `unsupported` \| `held` |
| `requestDigest` | sha256 of the canonical request |
| `operationId`, `attemptId` | copied from the request |
| `policyRuleIds` | the rules that decided, in order |
| `reasonCodes` | closed list, for example `request_malformed`, `policy_denied`, `capability_absent`, `evidence_missing`, `approval_missing`, `permit_expired`, `permit_reused`, `policy_changed` |
| `resolvedPolicyDigest` | the policy evaluated, which must equal the request's |
| `capabilityId` | the enforcement mechanism that will hold the boundary, at its level |
| `decidedAt` | wall-clock time, for audit only |
| `decisionDigest` | sha256 of the canonical decision without this field |

- **Evaluation order is fixed:**
  1. A malformed request gets `deny`.
  2. If the required level exceeds the proven cell level, the decision is `unsupported`.
  3. A policy rule that denies gives `deny`.
  4. Missing mandatory evidence or approval gives `held`.
  5. Otherwise the decision is `allow`.

  `held` is never upgraded to `allow` by time, retry or any AI signal. Only new evidence or approval from existing authority can produce a new decision for a new attempt.
- **An `allow` creates a permit held by the broker, not a bearer token.**
  - The permit is bound to one `requestDigest`, the current `resolvedPolicyDigest`, the `capabilityId`, and one `operationId`/`attemptId`.
  - Its lifetime is at most 30 s by default, measured on a local monotonic clock that never leaves the broker.
  - At dispatch it is consumed atomically: the broker revalidates policy and capability, then performs the effect, all in one critical section.
  - A second use is refused (`permit_reused`).
- **The serialized decision is evidence, never authority.** Presenting a decision or digest grants nothing. Authority exists only as broker-held state reached over authenticated IPC that candidate processes cannot open. Hashes alone do not authorize anything.

### 5. Enforcement points (ADM04, design only)

- **Check and use are the same step.** The broker opens and holds the handle it checked: `openat` with `O_NOFOLLOW` against a held directory fd on POSIX, or an equivalent Windows handle. It does not re-resolve a path string after checking it.
- **Remote mutations** use the host's conditional operations: an expected old ref for `git push --force-with-lease`, an expected head SHA for merges, an ETag or `If-Match` for API writes. The remaining race is documented per operation.
- **No interception claim for arbitrary protocols.** `network.connect` is mediated only through a broker-held egress path, or it is `unsupported`.
- **First adapter (slice 4):** a Linux mechanism that the slice probes and proves. Landlock is defense in depth, not a portable network policy. The selection is open question Q2.

### 6. Lifecycle (ADM06)

```
received ─► authorized ─► dispatch-intent ─► confirmed
        │              │                 ├─► failed
        └─► denied     └─► expired       └─► unknown ─► reconciled-confirmed | reconciled-failed
              (also: unsupported, held)
```

| State | Durable before | Meaning |
|-------|----------------|--------|
| `received` | evaluation | Request recorded by digest. |
| `denied` / `unsupported` / `held` | the reply to the requester | Terminal for this attempt. Nothing dispatches. |
| `authorized` | the permit exists | Permit held by the broker. It expires to `expired`, which is terminal and proves nothing about effects. |
| `dispatch-intent` | the external effect starts | Written and synced to durable storage first. If the journal write fails, nothing dispatches (ADM08). |
| `confirmed` / `failed` | the reply | Authoritative outcome observed: the local result, or the host's acknowledgement or refusal. |
| `unknown` | — | Crash, timeout or lost acknowledgement after intent. It never becomes permission to replay. |
| `reconciled-*` | — | An authoritative read (ref head, PR state, file identity) settled an `unknown`. |

- **Retries.**
  - Metadata-only retries (re-reading state, re-sending a receipt) never dispatch.
  - A new effect attempt needs a new `attemptId` and a new authorization.
  - An `unknown` remote mutation must be reconciled before any new attempt for the same `operationId`.
- **Stop, revocation, violation.**
  - A deny, a revocation or an active violation stops new launches immediately.
  - Affected local work is asked to terminate, and descendants are confirmed stopped under a host-specific ownership contract: cgroup on Linux, job object on Windows, process group or a supervised spawn on macOS.
  - Outcomes are distinct: `stop-confirmed` or `stop-unknown`.
  - Killing a process never claims to recall a remote effect already accepted. Receipts never claim rollback (ADM-T05). The existing cage halt (ADR-0048 decision 7) is the precedent, and it is honest about the reparenting race.

### 7. AI proposes, policy decides (ADM07)

- AI output (risk scores, complexity, confidence, explanations, triage of a denial) is recorded as an `advisory` attachment. The decision evaluator never reads it to reach `allow`.
- Trusted policy may name an advisory signal only to make a decision stricter: route to `held`, require human approval, or deny.
  - Whether policy may also use advisory signals to choose among already-allowed paths is open question Q5.
- Candidate text, generated templates, high confidence, executable helper code and candidate-side config (for example a manifest's `allowScripts`) are data, never authority. They cannot grant permission, rewrite policy, waive capability proof or create a retry.
- Unknown or missing evidence holds.
- Amendments to approvals and policy go through existing authority only: a Planner mission and its stamp (RULES §6.1, ADR-0045), the org floor (ADR-0042), and announced runtime relaxations where ADR-0048 already allows them. There is no AI-owned policy channel and no MCP tool that writes admission policy, as ADR-0048 decision 4 already holds for cage rules.

### 8. Audit (ADM08)

- **Every decision and every effect produces a receipt.** Receipts are bounded and digest-only, following ADR-0034 and RULES §9.
  - The decision receipt carries the request digest, decision, rule ids, policy and contract digests, actor identity, and the capability and level.
  - The effect receipt carries the observed enforcement, the outcome (`confirmed`, `failed`, `unknown`, `reconciled-*`) and redacted provenance.
- **Receipts are bound to type and version** (`opengantry.admission-receipt.v1`). Readers refuse unknown mandatory fields; they do not ignore them.
- **Journal before dispatch.** If the receipt for `dispatch-intent` cannot be persisted, the dispatch does not happen. A privileged mutation that cannot be journaled is not performed.
- **Protection.** Receipts are signed or otherwise protected, reusing the existing signing paths (git ssh/gpg signatures, `packages/git/src/receipt-signing.ts`; keyless Sigstore, ADR-0055). The signing key is never reachable by candidate processes. Where receipts live and how a run's receipts bind into the run record is open question Q6.
- **Downstream use.** Machine-readable outcomes support a downstream inbox or escalation without making the inbox or any evaluator the enforcement authority.

### 9. How #355 plugs in

- `dependency.materialize` is one family of this contract, not a separate permit mechanism.
- **#355 supplies:**
  - the dependency policy (DEP01)
  - the normalized graph and diff (DEP02), which become `resourceIdentity`: ecosystem, graph digest, admitted artifact set, permitted scripts
  - the dependency approval authority (DEP04), which is evidence the evaluator checks
  - the dependency reason codes (DEP06), which extend `reasonCodes` under a `dependency.` prefix
- **This contract supplies:** the request and decision records, the permit lifecycle, the capability levels and refusal rule, and the receipts.
- **No circular dependency.**
  - #355 can ship its graph, diff and policy checks (verify-time `detection`) before any broker exists.
  - The broker can ship other families before #355's acquisition adapter (DEP05).
  - #355's pre-execution claim (DEP-T02) is a `prevention` cell under section 1, with its own canary.
- **No parallel structures.** Dependency admission must not define a second permit, receipt or approval format. If #355's first slice lands names that differ from this ADR, the later of the two PRs aligns them.

### 10. Relationship to existing decisions

- **Not superseded:** ADR-0048, ADR-0050, ADR-0056, ADR-0057, ADR-0060. The cage keeps detecting and restoring, and cage cells stay `detection`.
- **ADR-0060 decision 1 vs R1's broker and confinement:** open question Q1.
- **Inventory findings that need their own missions** are listed under "Observations for follow-up" in the inventory. None is fixed here, and none changes a decision above.

## Open questions for the owner

1. **Q1 — Who owns confinement.** Should OpenGantry ship its own Linux confinement adapter for candidate processes, superseding ADR-0060 decision 1 for that adapter? Or should "OS-enforced confinement" mean the harness's sandbox (Claude Code bubblewrap/Seatbelt, Codex Landlock/Seatbelt), configured by `gantry cage policy` and proven by OpenGantry canaries per harness version? The broker itself (typed operations, held handles, scoped credentials) is new under either answer.
2. **Q2 — First Linux mechanism.** Which mechanism should slice 4 prove on Ubuntu 24.04 first? Candidates: a separate-uid broker plus Landlock for the candidate; bubblewrap with user namespaces (AppArmor-restricted on 24.04); or a cgroup v2 + seccomp-notify supervisor. Should privileged host setup be an accepted deployment prerequisite?
3. **Q3 — Broker process model and IPC authentication.** Same-user processes can read each other's files and, without hardening, `ptrace` each other. Is a separate OS user (or a service account) required for the broker, which a `gantry` CLI alone cannot provide? If not, what counts as "candidate cannot forge a permit" for a same-user deployment, and is that cell then `unproven` by definition?
4. **Q4 — Required levels by default.** Which families require `prevention` by default, so that a missing capability refuses launch, and which may run `detection` or `audit-only` with a label? The proposed default is: none required until a cell is proven, with the requirement declared per accepted contract.
5. **Q5 — Advisory signals.** May trusted policy use AI advisory signals to select among allowed paths (for example the cheaper of two allowed strategies), or only to tighten (`held`, `deny`, require approval)? This ADR proposes tighten-only.
6. **Q6 — Receipt storage.** Should admission receipts be stored in a local journal under the git dir, bound into the run record by digest (RULES §3), as ledger entries (RULES §9: digest-only, compare-and-swap appends), or in both? Ledger appends per operation may be too frequent.
7. **Q7 — Host mutations.** Which `git.publish` and `delivery.mutate` operations get typed brokers first (push to a non-default branch, PR create, PR comment)? Where do the scoped credentials live (GitHub App installation token, OIDC in CI)? Today the agent's own token reaches every host API (inventory B18).
8. **Q8 — Windows and macOS rows.** Which native mechanisms (job objects plus AppContainer or restricted tokens on Windows; Endpoint Security or `sandbox-exec` on macOS, the latter deprecated) are acceptable to investigate? Until one is proven, every row stays `unsupported` or `unproven` and is published as such.
9. **Q9 — Schema delivery.** Should the request, decision and receipt shapes ship as zod schemas in `packages/core` (the repository's convention, with registry entries and conformance goldens) plus generated JSON Schema for downstream consumers, or as JSON Schema first? This ADR ships neither.
10. **Q10 — Authority surfaces found in the inventory.** Should the draft-token key, break-glass anchor and hook-in-`dist/` findings be fixed before slice 3, since a broker that trusts any of them inherits the weakness?

## Consequences

- No adopter-facing guarantee changes. The published [Enforcement boundary](../../docs/concepts/enforcement-boundary.md) page stays the description of today's behaviour, and the inventory is unpublished until the owner accepts a contract.
- The vocabulary (five levels, seven families, four decisions, the lifecycle states) is fixed for the following slices, so tests, capability reports and #355 can use the same names.
- Prevention claims become expensive by design. Each one needs a canary per platform and harness, and the matrix publishes the cells that have none.
- Accepting this ADR (status `ACTIVE`) requires answers to Q1 to Q4 at least. Q1 may require a superseding amendment to ADR-0060.
