---
id: ADR-0063
title: Operation admission — a closed request/decision contract, and no prevention claim without proof
status: ACTIVE
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

# ADR-0063: Operation admission — a closed request/decision contract, and no prevention claim without proof

**Status: ACTIVE** (issue [#356](https://github.com/jeger-ai/opengantry/issues/356), work slices 1-2; accepted 2026-11-16, MSN-0380, after the owner answered all ten open questions, recorded under "Owner decisions" at the end). It was recorded as a design for owner review and shipped no code or schema (MSN-0380). It changes no existing guarantee. The field names, defaults and states below come from #356 "Detailed requirements R1" (2026-11-14). They are accepted as the contract for the following slices. Slice 2 is implemented as code (MSN-0384, see "Implementation status" below): schemas and pure logic only, with no broker, no enforcement and no `prevention` cell. Where an owner decision differs from a proposal below, the decision wins.

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

ADR-0048 and ADR-0060 settle two points this design must respect. The cage detects and restores; it does not block. OpenGantry does not build its own sandbox; it configures the agent's. R1's "OS-enforced confinement" is compatible with ADR-0060 only if the confinement comes from the harness and is proven per harness and platform. Otherwise ADR-0060 decision 1 would have to be superseded. Owner decision Q1 keeps ADR-0060 decision 1: the confinement is the harness sandbox, proven by canaries.

## Decision

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
- **First adapter (slice 4):** a Linux mechanism that the slice probes and proves. Landlock is defense in depth, not a portable network policy. The owner chose Claude Code's bubblewrap sandbox on Ubuntu 26.04 (Q2).

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
  - Whether policy may also use advisory signals to choose among already-allowed paths is answered by owner decision Q5: no, advisory signals only tighten.
- Candidate text, generated templates, high confidence, executable helper code and candidate-side config (for example a manifest's `allowScripts`) are data, never authority. They cannot grant permission, rewrite policy, waive capability proof or create a retry.
- Unknown or missing evidence holds.
- Amendments to approvals and policy go through existing authority only: a Planner mission and its stamp (RULES §6.1, ADR-0045), the org floor (ADR-0042), and announced runtime relaxations where ADR-0048 already allows them. There is no AI-owned policy channel and no MCP tool that writes admission policy, as ADR-0048 decision 4 already holds for cage rules.

### 8. Audit (ADM08)

- **Every decision and every effect produces a receipt.** Receipts are bounded and digest-only, following ADR-0034 and RULES §9.
  - The decision receipt carries the request digest, decision, rule ids, policy and contract digests, actor identity, and the capability and level.
  - The effect receipt carries the observed enforcement, the outcome (`confirmed`, `failed`, `unknown`, `reconciled-*`) and redacted provenance.
- **Receipts are bound to type and version** (`opengantry.admission-receipt.v1`). Readers refuse unknown mandatory fields; they do not ignore them.
- **Journal before dispatch.** If the receipt for `dispatch-intent` cannot be persisted, the dispatch does not happen. A privileged mutation that cannot be journaled is not performed.
- **Protection.** Receipts are signed or otherwise protected, reusing the existing signing paths (git ssh/gpg signatures, `packages/git/src/receipt-signing.ts`; keyless Sigstore, ADR-0055). The signing key is never reachable by candidate processes. Receipts live in a local append-only journal under the git dir, whose digest is bound into the run record (owner decision Q6).
- **Downstream use.** Machine-readable outcomes support a downstream inbox or escalation without making the inbox or any evaluator the enforcement authority.

### 9. How #355 plugs in

- `dependency.materialize` is one family of this contract, not a separate permit mechanism.
- #355's own design is ADR-0062 (PR #362, `ADR-0062-dependency-admission.md`, open while this ADR is written). This section states the interface between the two. It does not restate or decide anything ADR-0062 owns.
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
- **No parallel structures.** Dependency admission must not define a second permit, receipt or approval format. Where ADR-0062 (PR #362) and this ADR name the same thing differently, the PR that merges second aligns the names.

### 10. Relationship to existing decisions

- **Not superseded:** ADR-0048, ADR-0050, ADR-0056, ADR-0057, ADR-0060. The cage keeps detecting and restoring, and cage cells stay `detection`.
- **ADR-0060 decision 1 vs R1's broker and confinement:** resolved by owner decision Q1; ADR-0060 decision 1 stands.
- **Inventory findings that need their own missions** are listed under "Observations for follow-up" in the inventory. None is fixed here, and none changes a decision above.

## Owner decisions (2026-11-16)

The owner answered the ten open questions in chat, one at a time (MSN-0380).

1. **Q1 — Who owns confinement.** *Decision:* the harness's sandbox (Claude Code bubblewrap/Seatbelt, Codex Landlock/Seatbelt), configured by `gantry cage policy` and proven by OpenGantry canaries per harness version. ADR-0060 decision 1 stands: OpenGantry ships no sandbox. An unproven harness makes an enforced launch refuse. The broker (typed operations, held handles, scoped credentials) is new.
2. **Q2 — First Linux mechanism.** *Decision:* Claude Code's bubblewrap sandbox on **Ubuntu 26.04 x64**, which replaces 24.04 as the Linux target row (owner change). A one-time privileged host step, the AppArmor profile that lets bwrap create user namespaces, is an accepted and documented deployment prerequisite. A later slice adds a `gantry doctor` check that reports when it is missing; an enforced launch then refuses.
3. **Q3 — Broker process model.** *Decision:* the broker runs as the same OS user, outside the harness sandbox. "The candidate cannot forge a permit" rests on the proven sandbox boundary: the candidate cannot reach the broker's state, its socket credentials, or `ptrace` it. Without a proven sandbox the cell is `unproven` and an enforced launch refuses. A separate-user deployment may be added later as a stronger row.
4. **Q4 — Required levels by default.** *Decision:* no family requires `prevention` by default until a cell is proven. Each accepted contract declares its own requirement.
5. **Q5 — Advisory signals.** *Decision:* tighten-only. AI signals may only produce `held`, `deny` or require approval. They never select among, or widen, allowed paths.
6. **Q6 — Receipt storage.** *Decision:* a local append-only journal under the git dir, with its digest bound into the run record (RULES §3). No ledger append per operation.
7. **Q7 — Host mutations.** *Decision:* the first typed brokers are push to a non-default branch and PR create. Credentials are a short-lived GitHub App installation token held by the broker (OIDC in CI), and no host token is reachable inside the sandbox. PR comment comes later.
8. **Q8 — Windows and macOS rows.** *Decision:* investigate the harnesses' own sandboxes first (Seatbelt on macOS; Codex's Windows sandbox). Native mechanisms (job objects plus AppContainer or restricted tokens; Endpoint Security) are fallbacks. Both rows stay `unsupported` or `unproven` until a canary proves a cell.
9. **Q9 — Schema delivery.** *Decision:* zod schemas in `packages/core` with registry entries and conformance goldens, plus generated JSON Schema for downstream consumers.
10. **Q10 — Authority surfaces.** *Decision:* fix all three before slice 3, as a separate mission: move the draft-token key out of the candidate's reach, read the break-glass anchor from the base commit, and make the hooks run a pinned installed `gantry` instead of the working tree's `dist/`.

## Implementation status

### Slice 2 in code (MSN-0384, 2026-11-16)

Owner decision Q9, implemented as contract and pure logic. Nothing here dispatches, confines or enforces anything, and no adopter-facing guarantee changes.

- **Schemas.** `packages/core/src/schemas/admission-schema.ts` holds closed zod schemas:
  - `opengantry.admission-request.v1`, with one branch per `kind` and a closed `resourceIdentity` per family;
  - `-decision.v1`, `-permit.v1`, `-receipt.v1` and `-journal-record.v1`;
  - `-policy.v1` (the resolved policy the evaluator reads), `-advisory.v1` (AI output) and `-capabilities.v1`.

  Unknown fields, kinds, levels and states are rejected.
- **JSON Schema.** `npm run gen:admission-schemas` writes the JSON Schema to `schemas/admission/`, and a core test fails when the committed files drift.
  - The files are in the repository, not in the npm tarball.
  - JSON Schema checks structure only. Each file's `$comment` lists the cross-field rules it cannot express, so **a consumer must also run the zod schema or the reference validator** (`packages/core/src/admission*.ts`); JSON Schema alone accepts records that break them:
    - request: the canonical JSON is at most 64 KiB;
    - decision: `decisionDigest` is the digest of the rest, and `capabilityId` and `capabilityLevel` are both null or both set;
    - permit: `expiresAtMs > issuedAtMs` and the lifetime is at most 30 s; a permit authorizes only if the issuing broker holds its digest;
    - journal record: `recordDigest`, `seq` from 0, and the `prevDigest` chain;
    - capability report: each `capabilityId` is `platform/harness/family`, `prevention` needs canary evidence, and every cell appears exactly once.
  - `test/conformance/admission/invalid.*.json` are negative examples (a permit with a 1 h lifetime or an expiry before issue, a row whose id does not match its family, a `prevention` row without a canary). Each is well-formed structure that zod rejects.
- **Pure functions** in `packages/core/src/admission.ts`:
  - canonical digests for request, decision and permit (`canonicalJson` plus sha256);
  - the 64 KiB request bound, on received bytes and on the canonical value;
  - `decide`, which follows the fixed order of decision 4 and is deny by default (`default-deny`):
    - the broker passes its own resolved host (platform and launched harness) in the context, and a request whose `capabilityEvidence` names any other cell is `unsupported` with `capability_mismatch`, so a request cannot borrow a stronger cell from another platform or harness;
    - the decision records the matched cell's `capabilityLevel` from the report, never the request's claim;
    - a malformed context (a `decidedAt` that is not ISO UTC, an unknown host, a malformed approval) is `deny` with `context_invalid` and `decidedAt: null`, never a throw;
  - `issuePermit`, `checkPermit` and `consumePermit` over a broker-held `PermitLedger` (issued permit digests, claimed and consumed keys), which is a required argument:
    - the permit's cell and level come from the decision, not from the caller;
    - single use is per operation, not per permit: the request digest (which covers the nonce) and the `operationId`/`attemptId` pair are claimed at issue and consumed at dispatch, so a second permit for the same request or attempt is not issued, and if one exists anyway only one dispatches (`permit_reused`);
    - a well-formed permit whose digest the broker did not issue (a fabricated decision digest, a changed level) refuses with `permit_unknown`;
    - reused, expired and changed permits refuse: request, args, resource, authority, clock, policy or capability;
  - the lifecycle table and transition function;
  - crash recovery, where `dispatch-intent` becomes `unknown`;
  - `mayStartAdmissionAttempt`, under which an `unknown` blocks a new attempt until it is reconciled.
- **Journal.** `packages/core/src/admission-journal.ts` provides the hash-chained journal: append, canonical line encoding, and a verifier.
  - The verifier detects edits, reordering, a missing head and a partial last line.
  - It also detects a cut at a record boundary, measured against an anchor (count and head digest) that a later slice binds into the run record.
  - An anchor that is not a non-negative integer count with a sha256 head is refused as `anchor_mismatch`, never indexed with.
- **Capability matrix.** `packages/core/src/admission-capabilities.ts` holds the capability matrix: 3 platforms × 5 harnesses × 7 families = 105 cells, every one present. No cell is `prevention`.
- **Registry and goldens (Q9).**
  - The hidden, read-only `gantry admission capabilities [--json]` prints the matrix, and is registered in `.gitagent/registry/commands.yaml`.
  - Its output is a conformance golden.
  - `test/conformance/admission/` holds example records and their digests for consumers in other languages.

**Limits of the journal in this slice (do not rely on the verifier yet):**

- **An unanchored journal can be truncated at a record boundary, or rewritten from genesis, and still verify.** Only an anchor kept outside the journal catches either.
- **The anchor binding to the run record (Q6) must land before anything relies on the verifier.** Until then no caller holds a trusted anchor, so the verifier proves internal consistency only.
- **The verifier checks the hash chain only, not lifecycle order across receipts.** For example, an `effect` receipt with no prior `allow` decision for its attempt, or `confirmed` after `unknown`, verifies. Checking the receipts against the lifecycle table is a later slice.

**Choices this ADR did not settle, made conservatively:**

1. **A cell with two inventory levels** carries the first, pre-effect one. For example, "unproven / detection" is `unproven`, which meets no requirement.
2. **macOS and Windows cells are capped.** The inventory lists some as `detection` or `audit-only`; they are `unproven` under Q8, and the inventory level stays in the row's evidence.
3. **Cells follow the inventory.** Ubuntu 26.04 cells, Claude Code included, keep the coverage page's level, so a family the page marks `unsupported` stays `unsupported`. It is not raised to `unproven`.
4. **Policy rules match by family and optional harness only.** Resource matchers come with the broker. No family has a required level by default (Q4).
5. **Advisory signals are numeric (0 to 1),** and only trusted policy's `advisoryRules` read them, to hold, deny or require approval. A malformed advisory holds, and a missing one changes nothing. A test checks over every family that no advisory input loosens a decision (Q5).
6. **Approvals are passed in by the caller,** bound to the request digest. Verifying them against existing authority is the broker's job.
7. **Permit time is in milliseconds on a named monotonic clock (`clockId`).** A reading from another clock, or one before issue, counts as expired.
8. **A crash before decision or dispatch maps to `expired`.** An `authorized` or `received` attempt lapses to `expired`; this edge exists only in crash recovery.
9. **Reason codes are a closed list,** extended only under `dependency.` for #355. This slice adds `permit_unknown` (a permit the broker did not issue) and `context_invalid` (the broker's own context is malformed).
10. **A host mismatch is `unsupported`, not `deny`.** The request names a cell that is not the one it runs in, so no proven cell holds the boundary for it; this is the capability step of decision 4. Both values are equally strict.
12. **`policyRuleIds` holds up to 320 ids** (256 rules plus 64 advisory rules, the policy maxima), in decisions and decision receipts. The list is never truncated.
13. **A canonical path has no control character or line terminator** (C0, DEL, C1, U+2028, U+2029), and its `..` check scans across line terminators.
11. **`issuePermit` trusts a self-consistent `allow` from `decide` in the same broker.** It re-checks the decision digest and the binding to the request, but not the report; the broker must not pass it decisions from elsewhere.

**Later slices, not here:**

- the broker process and its state machine, and IPC authentication (slice 3, after the Q10 authority fixes);
- held handles and the check-equals-use dispatch;
- the journal file under the git dir, its fsync, and the binding of its anchor into the run record;
- receipt signing;
- OS and harness adapters (slice 4, with Claude Code bubblewrap on Ubuntu 26.04 first);
- canaries, and the `doctor` AppArmor check;
- host brokers for push and PR create (Q7);
- the published capability report and the adversarial suite (slice 5).

## Consequences

- No adopter-facing guarantee changes. The published [Enforcement boundary](../../docs/concepts/enforcement-boundary.md) page stays the description of today's behaviour, and the inventory stays unpublished until a cell is proven by a canary.
- The vocabulary (five levels, seven families, four decisions, the lifecycle states) is fixed for the following slices, so tests, capability reports and #355 can use the same names.
- Prevention claims become expensive by design. Each one needs a canary per platform and harness, and the matrix publishes the cells that have none.
- Accepting this ADR (status `ACTIVE`) required answers to Q1 to Q4 at least. The owner answered all ten on 2026-11-16. Q1 keeps ADR-0060 decision 1, so no superseding amendment is needed.
- Before slice 3 (the broker), a separate mission fixes the three authority surfaces of Q10.
- Status (2026-11-16): the Q10 prerequisite is done (MSN-0381, PR #365): the draft-token key is in `~/.opengantry`, the break-glass anchor comes from the `origin/HEAD` merge-base, and the hook shims run a pinned installed `gantry`. Its follow-up MSN-0385 covers the rest: the MCP launcher, the Cursor sessionStart hook and the runtime-env script run the same pinned installed `gantry`; CI counts a `gxt-bypass` note only when a Planner key from the base commit signed it (attribution, not a boundary: an `[MSN-NNNN]` subject needs no note, and branch protection plus review of workflow changes is the boundary); `gantry cage policy` denies every home secret also at its physical path. Residual limits: all cells stay `unproven` until a sandbox canary proves the denies; a same-user process can still reach the state directory, the Planner key, the global install prefix and the local remote-tracking refs; `GANTRY_HOOK_LOCAL_BUILD=1` (hooks) or `GANTRY_MCP_LOCAL_BUILD=1` (launchers, a separate opt-in since the PR #369 review round) in an agent's environment runs `dist/` again; the read guard's home list has the same linked-home gap; CI stays the boundary.
