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

**Status: ACTIVE** (issue [#356](https://github.com/jeger-ai/opengantry/issues/356), work slices 1-4; accepted 2026-11-16, MSN-0380, after the owner answered all ten open questions, recorded under "Owner decisions" at the end). It was recorded as a design for owner review and shipped no code or schema (MSN-0380). It changes no existing guarantee. The field names, defaults and states below come from #356 "Detailed requirements R1" (2026-11-14). They are accepted as the contract for the following slices. Slice 2 is implemented as code (MSN-0384, see "Implementation status" below): schemas and pure logic only, with no broker, no enforcement and no `prevention` cell. Slice 3 (MSN-0386) adds the broker state machine and its local process, still with no confinement and no `prevention` cell. Slice 4 (MSN-0391) adds sandbox canaries and `gantry admission probe`; on the stock Ubuntu 26.04 host it ran on, no cell is proven (see "Slice 4"). With the owner's AppArmor prerequisite, the re-run proves `process.spawn` and `dependency.materialize`, and `network.connect` under `--strict-network`; `workspace.write` is not proven, because an fd inherited past a gap reaches the sandbox (MSN-0395, see "Slice 4 re-run"); the static matrix is unchanged. MSN-0392 adds the first typed host brokers (Q7): push to a non-default branch and PR create, with a broker-held GitHub App token. They are tested offline only, and they raise no cell. Where an owner decision differs from a proposal below, the decision wins.

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

Owner decisions of 2026-11-17 (PR #370 review round): **(a) CI anchor:** where the journal is absent, `gantry verify` checks the run-record anchor's format strictly and labels the result "not verified here" instead of failing, never as a pass-equivalent; where the journal exists, the full chain check runs. **(b) Flooding:** malformed socket input is counted per time window, not journaled per message; refused well-formed requests keep their receipts under a denial budget separate from the dispatch budget; when it is spent the socket accepts no new requests, while authorized dispatches in progress always keep room for their intent and outcome.

Owner decision of 2026-11-17 (after the PR #375 canaries): **(c) Broker transport:** every Unix socket stays blocked in the harness sandbox, because srt on Linux can only block all of them or allow all of them, and two canaries escaped through same-user sockets. The agent was to reach the broker through an already connected fd handed over at launch. That fd cannot arrive (see "Broker transport"), so the agent reaches the broker through gantry's MCP server instead, the fallback the brief named.

Owner decisions of 2026-11-17 (after the first full-sandbox probe, MSN-0395): **(d) Inherited fd:** `write-inherited-fd` counts as blocked when no fd above 2 reaches the sandbox. It is a positive check: inside the sandbox the canary lists `/proc/self/fd`; no fd above 2 is `blocked`, an fd above 2 is written through and any one outside the canary's own `out/` and temp dir is `effect`. The first basis given, that Node and Claude Code mark fds above 2 close-on-exec, is wrong (PR #379 review): Node's `uv_disable_stdio_inheritance()` stops at the first closed fd above 15, so an inherited fd past such a gap survives exec. The canary therefore plants fd 20 with fds 3–19 closed; see "Slice 4 re-run". **(e) Network:** `network.connect` is reachable through an opt-in `gantry cage policy --strict-network`, which sets `sandbox.network.strictAllowlist: true`. The default output stays as it is. The cell may be `prevention` only when the probed policy is strict and every network canary is blocked.

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

### Slice 3 in code (MSN-0386, 2026-11-17)

The broker state machine and its local process, in `packages/missions/src/admission/`. Operator notes: [`docs/reference/admission-broker.md`](../../docs/reference/admission-broker.md). Nothing here confines the candidate. Every cell keeps its reported level, and none is `prevention`.

- **Broker** (`broker.ts`). It wraps the pure functions and holds:
  - the `PermitLedger`;
  - its authority, a random `brokerId` and an epoch;
  - the resolved policy, re-read at every decision and dispatch;
  - the capability report.

  It decides against the host cell it resolved itself, from os-release and the operator's `--harness`. The lifecycle is `received → authorized/denied/unsupported/held → dispatch-intent → confirmed/failed/unknown`, plus `expired` for an authorization that never dispatched.
  - **Broker-assigned fields.** `prepare` hands out the ids, the nonce, the contract and policy digests, the actor identity and the capability evidence. A request whose nonce the broker did not hand out is refused (`permit_unknown`); a reused nonce is `permit_reused`; one older than 30 s is `permit_expired`. A changed attempt, actor or contract is `request_changed`, and so are arguments that `argsDigest` does not bind.
  - **Client-chosen ids are never registered.** A refusal of an unissued or reused nonce, or of ids that differ from the prepared ones, is journaled as a counted refusal but registers no attempt, and recovery skips it. `prepare` accepts only operation ids the broker issued. The attempt table is bounded (65,536); it forgets the oldest operations whose attempts are all terminal, never an open or `unknown` one.
  - **Permits never leave the broker.** Decide, permit and dispatch happen in one call; the client gets the decision, the state and receipt digests.
  - **Journal before effect.** Consuming the permit (which revalidates policy, authority, clock and capability), checking the handles and journaling `dispatch-intent` with fsync happen in one synchronous step before the effect. A journal failure refuses the dispatch.
  - **Recovery.** A restart records every open intent as `unknown` (ambiguity `crash`) and every undispatched authorization as `expired`. An `unknown` operation gets no new attempt. A refused replay never changes the state of the attempt it names.
  - **Revocation.** A policy change, an unreadable policy, a policy that fails its file checks, SIGHUP or `revoke()` bumps the epoch. Pending permits refuse with `authority_changed`, and prepared requests are void.
- **Journal file** (`journal-file.ts`) at `<git dir>/opengantry/admission/journal.jsonl`:
  - one exclusive lock file, with no stale takeover;
  - fsynced appends that write every byte; a failed or short write (ENOSPC) is cut back, fsynced and refused, so nothing dispatches;
  - a journal changed outside the broker breaks it;
  - two budgets in the one file (owner decision (b)): dispatch records (an `allow` and every effect record) have a 32 MiB cap that refuses new dispatches, with a 1 MiB reserve that the intent and the outcome of an authorized dispatch may both use, so an authorized dispatch always has room for its intent; refusal receipts have their own 8 MiB budget. Once that is spent, the broker answers every new request with a fixed `denial_budget_exhausted` and journals nothing for it, while authorized dispatches complete. No rotation.
  - the denial-budget lockout is permanent, as decision (b) chose: anyone who can connect can spend the budget with refused requests, and a restart recounts it from the journal. The operator's recovery is to stop the broker, move the journal aside as evidence and start a new one; run records anchored to the old journal then fail verify on that host until they are re-recorded. The operator page says so.
  - malformed, oversized and timed-out input is counted, not journaled: at most one summary line per 60 s in `input-summary.jsonl` next to the journal (capped at 1 MiB). It is an operator signal, not evidence: not hash-chained and not anchored.

  `gantry verify --record` adds an additive `admission_journal` anchor (path, count and head digest) to the run record when the host shows admission for the repository (a journal, an admission dir or a broker's state dir; zero records when nothing was journaled). That closes the slice-2 limit "no caller holds a trusted anchor" for repositories that run the broker. `gantry verify` (owner decision (a)):
  - always checks the anchor's format strictly: exactly `path`, a non-negative integer `count` and a sha256 `head_digest`;
  - where the journal exists, checks the full chain: a missing, cut or rewritten journal is `GXT_RUN_RECORD_MISMATCH`;
  - treats only a missing file as absent: an admission dir, journal or state dir that cannot be read (`EACCES`) fails;
  - where the whole admission dir is absent (a CI clone), passes with the warning `admission_journal: not verified here`, never as verified. If a state dir shows a broker served the repository on this host, an absent dir fails instead. Both the default `~/.opengantry` and a `GANTRY_STATE_DIR` set now are checked, so an override cannot hide the default;
  - fails a record without an anchor where the host shows admission for the repository (review round 2: records in `.gitagent/runs` are not denied by the cage, so the field can be removed). Everywhere else, including every CI clone, a record without an anchor passes with the same "not verified here" label, never cleanly.
  - Limit: deleting the admission dir and the state dirs makes a local check look like a clone; a record then shows as not verified, never as verified, also when its anchor was removed too.
- **Process** (`serve.ts`, hidden `gantry admission serve` and `stop`). It is Linux only and refuses elsewhere (`GXT_ADMISSION_BROKER_UNSUPPORTED`).
  - **Locations.** The instance lock and `broker.json` are in the per-user state dir. The socket defaults to `$XDG_RUNTIME_DIR/opengantry/` (directory 0700, socket 0600); a socket inside the work tree, the git dir or the state dir is refused, and so is a policy inside the work tree.
  - **Messages.** There is one message per connection: its first line, at most 1 MiB plus 64 KiB, with the 64 KiB request bound. Everything after the first newline is dropped before the size check, however the bytes are split. The line must be complete within 10 s of accept, a total deadline rather than an idle timer. At most 64 connections are open at once; a new one over the cap gets `too_many_connections` and is counted (`connection_limit`). Anything else gets a deny and no crash. Once a message is handed to the broker, the deadline is off and further bytes are dropped unread: the only answer is the broker's own, however long the dispatch runs.
  - **Policy checks, at start and at every reload.** The policy file must be a regular file (not a symlink) owned by the user, not group- or world-writable, in a directory that is not group- or world-writable. A policy that fails these checks after start decides nothing (`policy_invalid`) and bumps the epoch, so outstanding permits refuse.
  - **Other checks at start.** The broker's state dirs are narrowed to 0700 (refused when owned by someone else). `stop` signals only the process whose pid, start time and full command line `broker.json` recorded.
  - **Socket authentication.** None beyond filesystem permissions: Node has no `SO_PEERCRED`, and a connection only lets a client send a request.
  - **Cage policy.** `gantry cage policy` now also denies `.git/opengantry`, and a linked worktree's journal dir by its absolute path.
- **Dispatchers** (`dispatch.ts`). Node has no `openat` or `fexecve`, so the dispatchers use `/proc/self/fd/<n>` as the held object.
  - **`workspace.write`** holds the parent directory (`O_NOFOLLOW`, device and inode, path read back). It refuses a symlink in the final component, checks the prior digest or absence, then creates exclusively or renames over the target inside the held directory. Before the rename it re-checks the target's identity and content digest. An error after the first mutating syscall (the `O_CREAT` open, or the rename) records `unknown` (ambiguity `lost-acknowledgement`), which blocks a retry; `failed` is kept for errors before any mutation.
  - **`process.spawn`** takes an argv array, never a shell, and exactly the bound names from an environment allowlist. It copies the hashed bytes to a 0500 file in a broker-private 0700 dir under the state dir, re-hashes the copy, runs it as `/proc/self/fd/3` with the client-chosen `argv[0]` in the held cwd, and deletes it after the process ends. A timeout records `unknown`.
  - **`process.spawn` is effectively unrestricted in this slice.** A policy rule matches the family and harness only; it cannot name an executable or argv. A policy that allows `process.spawn` allows any executable under any `argv[0]` (a multi-call binary becomes whichever tool `argv[0]` names; the copy's file name constrains nothing). **Policy should not allow `process.spawn` until resource matchers exist, and those matchers must bind the executable digest and `argv[0]`.** The broker does not refuse such a policy itself: the strict v1 policy schema has no field to name a digest, and adding one is a schema change for a later slice.
  - **Every other family** is `unsupported`.
- **Tests** (`src/cli/tests/admission/`). The ADM-T02 and ADM-T04 cases, and the ADM-T03 parts that need no confinement:
  - forged, replayed and expired requests;
  - changed arguments, resource, cell and policy epoch;
  - revocation while a dispatch is pending;
  - a journal write failure, a full journal and a journal changed outside the broker;
  - a symlink or swapped parent on `workspace.write`;
  - a truncated, rewritten or deleted journal caught through the run-record anchor;
  - malformed and oversized socket input;
  - concurrent dispatch of one attempt by eight client processes, which produces one effect;
  - `kill -9` of the broker between intent and outcome, which gives `unknown` with no re-dispatch;
  - review round: a spawn longer than the connection timeout and trailing bytes past the bound both get the true result; a short journal write; `unknown` after a mutation; a target or executable rewritten in place; forged operation ids; a malformed flood; the denial budget with a dispatch in flight; `stop` against another repository's broker; and an anchor in a clone without a journal;
  - review round 2: a removed anchor where a journal or broker state exists; a labelled record without an anchor; an unreadable admission dir or state dir; a `GANTRY_STATE_DIR` override that must not hide the default; a trickling client cut off at the deadline; the connection cap; a valid line and a tail in one write; the message reader at the bound; a policy made group-writable, put in a group-writable dir or replaced by a symlink after start; an intent in the reserve; a failed rename's temporary file.

**Residual races and limits of slice 3:**

- **Replacing a file:** between the final re-check of the target (identity and content digest) and the rename, the target can be swapped or rewritten. The rename stays in the held directory and never follows a link.
- **Inherited handles:** a spawned process inherits its private executable copy and cwd handles.
- **Nested executables:** interpreters and nested programs are opened by path.
- **Revocation after the intent:** a revocation after `dispatch-intent` does not stop that effect.
- **CI clones:** a run record's anchor is only format-checked where its journal is absent, and a record without an anchor cannot be told from one whose anchor was removed; both say "not verified here".
- **`process.spawn` is unrestricted** once a policy allows the family: see Dispatchers.
- **Denial-budget lockout:** permanent, and any client that can connect can trigger it (decision (b)); recovery moves the journal aside and breaks anchors to it on that host.
- **Choices this slice made conservatively:**
  - A broker-side refusal reuses existing reason codes: `permit_unknown`, `permit_reused`, `permit_expired`, `request_changed`, `policy_denied` and `evidence_missing`. No code is added.
  - Malformed requests carry no ids, so they are counted in the input summary, not journaled.
  - The input summary is a separate, unchained file, because the receipt schema has no summary record.
  - Recovery's `expired` is journaled as an effect receipt.

### Host brokers in code (MSN-0392, 2026-11-17)

Owner decision Q7: the first typed host brokers, in `packages/missions/src/admission/host-*.ts` and `github-client.ts`. Operator notes: [`docs/reference/admission-host-brokers.md`](../../docs/reference/admission-host-brokers.md). They dispatch only when `gantry admission serve --host-config` names an `opengantry.admission-host.v1` file. Without one, both families stay `unsupported`.

- **`git.publish`**: pushes one exact commit to `refs/heads/<branch>` of the one configured repository.
  - Binding: the request binds the canonical remote URL, the ref, the expected old value (`null` for absent) and the new commit, and the raw arguments `{remote, branch, commit}` must match them. A different repository, or a branch that matches the host config's protected patterns, is denied (`policy_denied`) before any permit exists.
  - Checks before the permit is consumed: the named remote must point at the configured repository (its `url` lines parsed by the broker, includes not followed), the commit's whole history must be in the repository's own objects, and the remote's default branch (read from its `HEAD`) is refused. The remote ref must hold exactly the expected old value. A stale value refuses, and nothing changes.
  - Push (ADM04): from a broker-private bare repository holding a copy of the repository's loose and packed object files (no symlinks followed, `objects/info/*` skipped, a file with a second hard link refused, never alternates, which git follows recursively), from the common dir pinned to the broker's own git dir. `serve` resolves that git dir without running git and checks that it belongs to the work tree: a real `.git` directory, or a linked worktree entry whose `gitdir` back-pointer names the work tree's `.git` and whose `commondir` names its parent. Git never runs inside the candidate's repository. Git runs with a clean environment: no system or global config, hooks off, only the https protocol, no credential helper, no redirects. The token is an `http.extraHeader` passed through `GIT_CONFIG_COUNT` for that one command, never on an argv. The push is `--force-with-lease=<ref>:<expected old>` and never a plain force. The remote's conditional update is the race boundary: a concurrent writer wins, and the push is `failed`.
  - Afterwards the ref is read back. The requested commit gives `confirmed`; a contradictory or unreadable observation gives `unknown`.
- **`delivery.mutate`**: PR create only, through a typed client with three calls (token exchange, pulls list, pulls create).
  - Binding: the request binds the API host, `owner/repo`, `pull-request`/`create`/`absent`, and an `objectId` that digests head, base and the title and body digests.
  - Idempotency is keyed on head and base: an open PR for the same head and base is success, with its number, flagged `titleMismatch`/`bodyMismatch` when they differ. Otherwise one POST: a 4xx is `failed`; a 5xx, a timeout or a lost answer is `unknown`.
- **Reconciliation (ADM06):** a `reconcile` message carries the original request, whose digest must match the journaled attempt. The broker reads the remote ref, or the PRs for that head and base in every state (a merged or closed one counts only when its number is above the floor recorded before the create, and it has the requested title and body; a full page of 100 is ambiguous), and journals `reconciled-confirmed` or `reconciled-failed`. An inconclusive read leaves the attempt `unknown`. Nothing is pushed or POSTed again; a new attempt is the client's to prepare.
- **Credentials:**
  - **GitHub App:** a JWT signed with the App key, which must be under `<state root>/admission/`, not a symlink, owned by the user and mode 0600 or 0400. It is exchanged for an installation token scoped to the one repository with exactly `contents: write` and `pull_requests: write`, requested explicitly; a token granted anything else is refused. The token is held in memory only and reused for at most 5 minutes.
  - **GitHub Actions OIDC:** a typed stub that refuses as not implemented, because GitHub does not exchange an Actions OIDC token for an installation token without a separate exchange service.
  - **Test provider:** exists only in the tests.
  - Tokens are a `SecretToken` that serializes as `[redacted]`. Receipts carry digests only. Tests check that the token is absent from the journal, the replies and every argv.
- **Cage policy:** the state dir that holds the key and host config was already denied. The fragment now adds `sandbox.credentials.envVars` deny entries for `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN` and `GITHUB_ENTERPRISE_TOKEN`. Claude Code applies them to sandboxed Bash commands only, not to its file tools or MCP servers.
- **Tests** (`src/cli/tests/admission/host-brokers.test.ts`), all offline, with a local bare repository and a fake GitHub API on 127.0.0.1:
  - the default branch and protected patterns refused;
  - a stale expected old value and a lease lost to a concurrent writer;
  - a candidate hook and `insteadOf` ignored;
  - the token sent as a header and absent from the argv, the journal and the replies;
  - a crash between intent and outcome for both families, reconciled by a read with one push or POST in total;
  - an existing PR treated as success, and an ambiguous 5xx;
  - App key files that are loose, symlinked or outside the state dir;
  - a token that carries extra permissions;
  - revocation between authorize and dispatch, and during the token fetch.

**Limits of the host brokers:**

- **No prevention.** No cell is raised. A candidate that still reaches a host token, `gh` or the API bypasses the brokers (B18) until a slice-4 canary proves it cannot.
- **Same user.** While a push runs, the token is in the git child's environment, readable through `/proc/<pid>/environ` by a same-user process outside a PID-namespaced sandbox.
- **Open PRs only.** A PR created and closed before reconciliation reads as `reconciled-failed`, because only open PRs are looked up.
- **Open item:** live proof against real GitHub needs the owner to create the GitHub App. No credentials were available, and none were created.

**Later slices, not here:**

- live proof of the host brokers against GitHub (owner creates the App), OIDC credentials for CI, and PR comments (Q7);
- reconciliation of an `unknown` `workspace.write` or `process.spawn`, and checking receipts against the lifecycle table;
- policy resource matchers for `process.spawn` that bind the executable digest and `argv[0]` (and for `workspace.write`, the path), before any policy should allow `process.spawn`;
- the descendant stop contract (`stop-confirmed` / `stop-unknown`, ADM-T05);
- running the full-srt canary (the broker socket unreachable by path from the sandbox) once the AppArmor profile is installed; the agent reaches the broker only through the MCP relay (MSN-0394, "Broker transport");
- fully verifying in CI a run record whose journal stays on the developer's machine;
- receipt signing;
- OS and harness adapters (slice 4 tested Claude Code's runtime on Ubuntu 26.04, see below; with the AppArmor prerequisite the probe proves three families there, but only per host through `--probe`);
- the published capability report and the adversarial suite (slice 5).

### Slice 4: sandbox canaries (MSN-0391, 2026-11-17)

Owner decisions Q1, Q2, Q4 and Q8, put to a test on one host. **Result: no cell is `prevention`.** The full mechanism cannot run on a stock Ubuntu 26.04, and the configuration that does run there can be escaped.

- **What runs.** `gantry admission probe` (hidden) runs 33 canaries through `@anthropic-ai/sandbox-runtime` (`srt`), the open-source runtime Claude Code's sandbox is built on. The operator supplies it; it is not a dependency.
  - The settings are those `gantry cage policy --agent claude-code` generates, merged as Claude Code's sandboxing documentation describes: `Read`/`Edit` deny rules join `denyRead`/`denyWrite`, the working directory and a temp dir are writable, and the domain allowlist starts empty (`packages/cage/src/sandbox-probe/srt-config.ts`). That merge is our reading of the documentation, not Claude Code's code.
  - Each canary runs in a fresh disposable fixture with random tokens as secrets; the env canary plants tokens in the launch environment. The effect is checked from outside: no token in the workspace, every target byte-identical or still absent, no connection at an outside listener. A canary that did not run is `inconclusive`, never a pass.
- **The mapping** (`packages/core/src/admission-canary.ts`, pure). A family is `prevention` only when all of these hold:
  - the host is the Ubuntu 26.04 x64 row;
  - the runtime ran with the generated policy and its seccomp helper;
  - a control canary wrote and read inside the workspace;
  - every canary of the family was blocked;
  - every cross-family transport canary was blocked.
  
  Otherwise the static level stays; an `unproven` cell then carries the probe as canary evidence with the reasons. Canary evidence gains optional `host` (kernel, AppArmor restriction, bwrap version; since MSN-0395 also `nestedUserns` and the AppArmor bwrap profile files) and `note` fields. Since MSN-0395 a `prevention` row's `note` states its conditions: the host prerequisite, and for `network.connect` where `strictAllowlist` must be set. `network.connect` also needs `strictAllowlist`, because without it Claude Code asks the user to approve a new domain. The generated policy does not set it.
- **The host** (2026-11-17): Ubuntu 26.04.1, kernel 7.0.0-43, bwrap 0.11.1, `kernel.apparmor_restrict_unprivileged_userns = 1`. The apparmor package ships the `bwrap-userns-restrict` profile, so bwrap itself creates user namespaces. That profile's `unpriv_bwrap` stacking denies capabilities to everything bwrap starts. socat was not installed; the probe used Ubuntu's `socat_1.8.1.1-1ubuntu0.1` .deb unpacked into a scratch dir, with no system change.
- **Policy mode refuses.** The runtime's seccomp helper creates a nested user namespace with capabilities, and `unpriv_bwrap` refuses it (`write /proc/self/setgroups: Permission denied`). So the full mechanism does not start. The probe checks this first (bwrap, then `unshare --user --map-root-user` inside it) and refuses with `GXT_ADMISSION_PROBE_UNAVAILABLE`. The stock profile that "lets bwrap use user namespaces" (Q2) is therefore not enough. What would be enough (Claude Code's documented `/etc/apparmor.d/bwrap` profile with `flags=(unconfined)`, or the sysctl) is untested here, because testing it needs root.
- **Diagnostic mode runs, and is escaped.** `--diagnostic` drops the seccomp helper (`allowAllUnixSockets`). Claude Code's documentation calls that filter optional, so this is how Claude Code runs where the helper is missing. Runtime digest `c6872618…`; probe digest `c7be4b17…`, identical over two runs (34 canaries, after the PR #375 review).
  - **Blocked (28):** every direct, symlink, hardlink, `/proc/self/root`, `..`, nested `sh`/`node`/`python3`, symlink-swap, `.git`-rename, user-namespace, npm postinstall and TCP canary. The proxy canary sends the proxy's credentials, and its positive control, with the port allowlisted, reaches the listener. That includes the state dirs and `.git/opengantry` after PR #370 added that deny.
  - **Escaped (3):** a connection to a same-user Unix socket outside the sandbox, and `systemd-run --user` over the session bus, which wrote a file outside the sandbox. Either is a full escape, so no family can be proven in that configuration. Also, tokens in the launch environment pass through: the generated policy declares no `sandbox.credentials.envVars`.
  - **Untested (1):** an inherited fd. `srt` passes only stdio into the sandbox, so that path cannot be tested through `srt`; it is `inconclusive`, not blocked.
- **Broker socket.** In diagnostic mode the candidate reached the broker (`{"type":"capabilities"}` answered), and the journal, `broker.json`, the policy and `exec/` stayed unread and unchanged.
  - In policy mode the seccomp helper refuses every `AF_UNIX` socket. The runtime's `allowUnixSockets` path list is macOS-only.
  - So on Linux, a reachable broker socket and blocked same-user sockets exclude each other with `srt` 0.0.83. The broker cell stays unproven. It needs another transport (for example a loopback port the proxy allowlist names) or a runtime that filters sockets by path.
- **Policy change.** `gantry cage policy` now sets `sandbox.failIfUnavailable: true`. Claude Code's documentation says it otherwise runs commands unsandboxed when its sandbox cannot start, whatever `allowUnsandboxedCommands` says.
- **Doctor.** `gantry doctor` warns about each missing prerequisite (bwrap, socat, the nested user namespace), only where Claude settings enable the sandbox (the repository's `.claude/settings*.json`, `~/.claude/settings.json` or the managed settings).
- **Not done.** No CI job: `ubuntu-latest` is 24.04, not the target row, and changing workflows is outside this mission. Claude Code's own binary was not driven, because that needs a model. macOS and Windows stay `unproven` or `unsupported` (Q8).

### Broker transport (MSN-0394, 2026-11-17)

Decision (c) asked for an fd handed to the sandboxed agent at launch. Host evidence on Ubuntu 26.04 (srt 0.0.83, Claude Code 2.1.325; reproduced by `src/cli/tests/admission/broker-sandbox-host.test.ts` and an independent review of PR #375):

- **No inherited fd reaches a sandboxed command.** srt's CLI passes only stdio (an fd 3 is "Bad file descriptor" inside). Node marks every inherited fd above 2 close-on-exec at startup, so a Node harness never hands one on. bwrap itself passes fds through, so the drop is not bwrap's. *Corrected by MSN-0395 (PR #379 review):* Node marks fds close-on-exec only up to the first closed fd above 15. An fd past such a gap (fd 20 with 3–19 closed) reached the sandboxed shell through srt and was written through. The fd 3 test above had no gap.
- **Nor a Claude Code MCP server or hook.** A probe MCP server and a SessionStart hook started by `claude -p` had no fd 3. Claude Code's Bash tool gives its commands no stdin, so there is no pipe either.
- **The seccomp filter blocks only creation.** srt's filter refuses `socket(AF_UNIX)` but not use of an inherited socket. With its rules applied by `bwrap --seccomp`, connecting to the broker socket by path fails with EPERM, where the same sandbox without the filter connects.

**What is built:** the fallback. `gxt_admission_request` in gantry's MCP server (which runs outside the sandbox) forwards one broker message to the socket named by `GANTRY_BROKER_SOCKET` and returns the broker's answer verbatim. The hidden `gantry admission launch -- <harness…>` starts a broker for the session, exports that variable and stops the broker when the harness exits. Claude Code starts MCP servers itself and passes them no fd, so the relay reaches the broker by its socket path, outside the sandbox. The broker's socket is still the only transport: framing, bounds, deadline, denial budget and journal-before-effect are unchanged.

- **The relay trusts only the recorded broker.** `GANTRY_BROKER_SOCKET` may come from an MCP config the agent can edit, so the relay refuses (`unavailable`) a socket that is not the one the repository's `broker.json` records for a running broker. Its answer is advisory to the agent; the broker's journal is the authority.
- **Sandboxed shell commands have no broker access.** They see the variable, but with srt's filter they cannot create a socket to connect with. This is a deviation from the literal fd-into-sandbox design, and it fails closed.
- **Residual:** without the filter (srt without its helper, which is what runs on this host until the AppArmor profile is installed), the socket path is reachable from the sandbox like every other same-user socket. The full-srt canary skips with that reason until the profile is present. No cell changes; none is `prevention`.
- **If sandboxed commands ever need the broker:** loopback TCP through srt's authenticated proxy. An `allowedDomains` entry `127.0.0.1:<port>` plus a `CONNECT` that carries `Proxy-Authorization` from `HTTP_PROXY` reaches exactly that port, and other ports get 403 (verified in the review). It would need a per-session token, because loopback TCP carries no peer identity, and `strictAllowlist`. Not built.

### Slice 4 re-run with the host prerequisite (MSN-0395, 2026-11-17)

Owner decisions (d) and (e), and the probe on the full mechanism. **Result after the PR #379 review round: `process.spawn` and `dependency.materialize` are `prevention` on this host, and `network.connect` is too under `--strict-network`.** `artifact.read` and `workspace.write` are not proven. The first re-run below also proved `workspace.write`, with an fd canary that could not fail.

- **The host prerequisite.** The owner disabled Ubuntu's `bwrap-userns-restrict` profile (link in `/etc/apparmor.d/disable/`) and installed `/etc/apparmor.d/bwrap`: `profile bwrap /usr/bin/bwrap flags=(unconfined) { userns, }`. `kernel.apparmor_restrict_unprivileged_userns` stays `1`. The commands, the undo and the trade-off are in [the probe guide](../../docs/guides/admission-probe.md#the-prerequisite-on-ubuntu). Every result below holds only with that prerequisite.
- **Host:** jai01, Ubuntu 26.04.1 LTS, kernel 7.0.0-43-generic, x64, bwrap 0.11.1, socat 1.8.1.1 (the scratch-dir copy), a nested user namespace with capabilities inside bwrap available. **Runtime:** `@anthropic-ai/sandbox-runtime` 0.0.83, digest `c6872618befe1f8e6b8620cbb3abcfc6a605b88e183cdca9a5ede758738dbcbe`, policy mode, seccomp helper applied.
- **Before the changes** (owner's run, MSN-0391 code, probe digest `029b5432…`): 32 of 34 canaries blocked, including the Unix socket and session bus escapes. `read-env-token` was `effect`; `write-inherited-fd` was `inconclusive` (no fd 3 inside); `broker-socket-reach` was blocked (EPERM). `process.spawn` and `dependency.materialize` were `prevention`.
- **Default policy** (probe digest `bdc7a4b28e37d1add8681adfee22d90a2d825e03470bccd3f3707c9880561178`, identical over two runs; policy digest `00fe1ae3…`): 33 blocked, 1 effect. `write-inherited-fd` is blocked: the sandboxed shell had fds 0 (`/dev/null`), 1 (`/dev/null`) and 2 (a socket) and nothing above. `read-env-token` is `effect`: `GH_TOKEN`, `GITHUB_TOKEN` and `OGCANARY_GH_TOKEN` pass through, because the generated policy has no `sandbox.credentials.envVars` yet (PR #376 adds them).
- **`--strict-network`** (probe digest `bb31b45799aa59e61e180cffc31d1c454da1531ccfa86bd94763303535222c33`, policy digest `19f4f471…`): the same canary results, with `networkStrict: true`.
- **Review round (PR #379).** The fd canary above handed the srt CLI fd 3, which Node always closes, so it could not fail. It now plants fd 20, open for append on `.git/config`, with every other fd above 2 closed (the probe starts the runtime through a shell that closes them). The fd judge counts any fd above 2 as `effect` unless it points into the canary's `out/` or temp dir. Five network canaries were added, each judged by an outside listener: SOCKS5 `CONNECT` through the proxy's port, `CONNECT` by hostname (`localhost`), and with `127.0.0.1:<port>` allowlisted a `CONNECT` to `<port+1>`, UDP to a loopback listener, and TCP to `[::1]`. SOCKS5 and hostname `CONNECT` each have a positive control that must reach the listener. Re-run on the same host and runtime, 39 canaries:
  - **Default policy:** probe digest `07124421a8291f6d88f5262155f6cfce8928ffa350bdc3749ed105f52dd24456` (identical over two runs), policy digest `00fe1ae3…`. 37 blocked, 2 effect.
  - **`--strict-network`:** probe digest `6d085771e525640cd6944d6b93d7b7da0bb05617a21206093fa90b222b168e5b` (identical over three runs), policy digest `19f4f471…`. 37 blocked, 2 effect.
  - **`write-inherited-fd` is `effect`** in both: the sandboxed shell listed `0 /dev/null, 1 /dev/null, 2 socket, 20 -> <fixture>/repo/.git/config` and wrote through fd 20. So an inherited fd past a gap reaches the sandbox, and `workspace.write` is **not proven** through the srt CLI. Claude Code is a Node process, so a handle it inherits from its launcher past such a gap reaches the commands it sandboxes. **Follow-up (not built):** `gantry admission launch` should close every fd above 2 before it execs the harness.
  - **All eight network canaries are blocked** in both modes, and all three proxy controls reached the listener. The proxy answered 403 to `CONNECT` by address, by hostname and to the adjacent port, and SOCKS5 status 2 (not allowed).
  - **Proven rows carry their conditions** in `evidence.note`: the nested user namespace and the AppArmor profile state for every family, and for `network.connect` "requires sandbox.network.strictAllowlist in user or managed settings (or --settings); probed with no allowedDomains". The evidence `host` gains `nestedUserns`, `apparmorBwrapProfile` (`installed`) and `apparmorUsernsRestrictProfile` (`disabled`): the profile files, not the loaded state.

  | Family | Default policy | `--strict-network` |
  |--------|----------------|--------------------|
  | `artifact.read` | not proven (`read-env-token`: effect) | not proven (`read-env-token`: effect) |
  | `workspace.write` | not proven (`write-inherited-fd`: effect; was prevention before this round) | not proven (same) |
  | `process.spawn` | **prevention** | **prevention** |
  | `dependency.materialize` | **prevention** | **prevention** |
  | `network.connect` | not proven (no `strictAllowlist`: Claude Code prompts) | **prevention** |

- **Broker.** The socket is unreachable under the seccomp helper (EPERM) and the state stays protected, as slice 4 found; the broker stays unproven.
- **The static matrix stays as it is.** `packages/core/src/admission-capabilities.ts` has no way to say "prevention on this row, provided the host has the AppArmor prerequisite": a `prevention` cell there would claim every Ubuntu 26.04 host, including the stock ones where the full mechanism refuses to start. So the static cells keep their inventory levels, and the proven cells come only from `gantry admission capabilities --probe` (and `--strict-network`) on a host that passed. Its rows carry the probe digest as canary evidence.
- **Limits.** One runtime version on one host. Claude Code's own binary was not driven. `strictAllowlist` takes effect in Claude Code only from user, managed or `--settings` settings, not from a repository's settings files. The canaries run `srt` alone, which has no prompt, so strict and default runs block the same connections; `network.connect` turns on what Claude Code would do, by policy.

## Consequences

- No adopter-facing guarantee changes. The published [Enforcement boundary](../../docs/concepts/enforcement-boundary.md) page stays the description of today's behaviour, and the inventory stays unpublished until a cell is proven by a canary.
- The vocabulary (five levels, seven families, four decisions, the lifecycle states) is fixed for the following slices, so tests, capability reports and #355 can use the same names.
- Prevention claims become expensive by design. Each one needs a canary per platform and harness, and the matrix publishes the cells that have none.
- Accepting this ADR (status `ACTIVE`) required answers to Q1 to Q4 at least. The owner answered all ten on 2026-11-16. Q1 keeps ADR-0060 decision 1, so no superseding amendment is needed.
- Before slice 3 (the broker), a separate mission fixes the three authority surfaces of Q10.
- Status (2026-11-16): the Q10 prerequisite is done (MSN-0381, PR #365): the draft-token key is in `~/.opengantry`, the break-glass anchor comes from the `origin/HEAD` merge-base, and the hook shims run a pinned installed `gantry`. Its follow-up MSN-0385 covers the rest: the MCP launcher, the Cursor sessionStart hook and the runtime-env script run the same pinned installed `gantry`; CI counts a `gxt-bypass` note only when a Planner key from the base commit signed it (attribution, not a boundary: an `[MSN-NNNN]` subject needs no note, and branch protection plus review of workflow changes is the boundary); `gantry cage policy` denies every home secret also at its physical path. Residual limits: all cells stay `unproven` until a sandbox canary proves the denies; a same-user process can still reach the state directory, the Planner key, the global install prefix and the local remote-tracking refs; `GANTRY_HOOK_LOCAL_BUILD=1` (hooks) or `GANTRY_MCP_LOCAL_BUILD=1` (launchers, a separate opt-in since the PR #369 review round) in an agent's environment runs `dist/` again; the read guard's home list has the same linked-home gap; the boundary is branch protection plus human review of workflow and verifier changes, not CI on its own.
