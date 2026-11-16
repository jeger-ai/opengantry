---
id: ADR-0062
title: Dependency admission — an exact, approved npm graph before install, an audit-only label until prevention is proven
status: ACTIVE
match_terms:
  - dependency admission
  - dependency policy
  - lockfile graph
  - install script
  - lifecycle script
  - supply chain
---

# ADR-0062: Dependency admission — an exact, approved npm graph before install, an audit-only label until prevention is proven

**Design status.** Issue #355 authorizes refining requirements, not activating anything in production. This ADR records the design for DEP01–DEP07 (issue #355, "Detailed requirements R1", 2026-11-14). Of the work slices, only slice 1 is implemented (MSN-0378): the graph parser and the graph diff. Everything else marked *proposed* is a contract the owner reviews before any slice implements it. The open questions at the end need an owner decision first.

## Context

Coding agents add dependencies, and installing a package runs that package's code (`preinstall`, `install`, `postinstall`, `prepare`, node-gyp builds). OpenGantry already has three related controls. None of them is an admission policy:

- **`dependency_update` trusted automation** ([ADR-0057](ADR-0057-dependency-update-automation.md), `packages/core/src/dependency-update.ts`). Named bot authors may bump versions of dependencies the manifest already declares. Every new or changed lock entry must resolve to an allowed registry and carry an integrity hash. Scripts, new packages, links and shape changes are refused. It is an *exemption from missions* for bumps. It does not decide whether an agent-authored change may add a package, and it matches registries by URL prefix.
- **The cage's dependency freeze** ([ADR-0048](ADR-0048-cage-trust-model.md) decision 9). It restores lockfiles and manifests after the fact. That ADR states the limit itself: install-time scripts have already run by the time cage restores a file.
- **Agent sandbox policy** ([ADR-0060](ADR-0060-agent-sandbox-policy.md)). OpenGantry generates a policy for the agent's own sandbox; it does not run one.

Issue #356 owns general operation admission: the request/decision/permit contract, the capability matrix, and which host mechanisms can actually prevent an effect. This ADR owns the dependency-specific parts: policy, graph, sources, approval identity, the dependency verdict and its evidence. It plugs into #356's boundary rather than defining a second permit mechanism.

## Decision

### 1. Supported ecosystem (DEP02, slice 1: implemented)

The first supported ecosystem is npm `package.json` plus `package-lock.json` / `npm-shrinkwrap.json` at lockfileVersion 2 and 3. Other formats (lockfileVersion 1, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, other ecosystems) are **unsupported**. Under enforcement, a change to an unsupported dependency file is a hold. It is never silently passed.

`packages/core/src/dependency-graph.ts` (pure core: no fs, process or network) turns a lockfile, plus the root `package.json` when given, into `opengantry.npm-dependency-graph.v1`:

- **Nodes.** One node per `packages` entry. Each node has a location, a resolved identity (`name`, `version`) and an `alias`: the installed folder name when it differs from the resolved name (`"lodash": "npm:evil-lodash@1"`), so manifest aliases are kept apart from actual identities. It also has `integrity`; the flags `dev`, `optional`, `devOptional`, `peer`, `inBundle`, `hasShrinkwrap` and `extraneous`; `installScript` (npm's `hasInstallScript`); platform conditions (`os`, `cpu`, `libc`); dependency edges by kind (`dependencies`, `optionalDependencies`, `peerDependencies`, `devDependencies`); and `direct`.
- **Source kinds.** `registry`, `git`, `url`, `file`, `link`, `workspace`, `local`, `external`, `bundled` and `unresolved`:
  - A registry tarball's source is its canonical registry base: URL origin plus the path before `/<name>/-/`, with no query or fragment. It is never a string prefix, so `https://registry.npmjs.org.evil.example/` is its own registry.
  - Credentials are stripped from `ref` and only flagged (`credentials: true`). Secrets never enter the graph or its digest.
  - A folder outside `node_modules` is a `workspace` when it matches the root's `workspaces` globs, otherwise `local` (a `file:` dependency).
  - npm's description of a file dependency's own `node_modules` (`../x/node_modules/y`) is `external`: this lockfile does not install it.
- **Root.** Name, version, edges, `workspaces`, and the lifecycle scripts of the root manifest (`preinstall`, `install`, `postinstall`, `prepublish`, `preprepare`, `prepare`, `postprepare`, `dependencies`), or `null` when no manifest was read.
- **Direct.** A node is direct when it is installed for the root or a local package that declares it, or when it is hoisted to the top and the root or a workspace declares it.
- **Digest.** sha256 of `canonicalJson` of the graph without the digest. Key order does not matter.
- **Bounds.** At most 20 MiB of lockfile, at most 10,000 nodes, at most 32 nested `node_modules` levels. The v2 legacy tree is walked recursively but is bounded by the same depth and node limit. The bounds can be configured (tighten-only once the policy carries them).
- **Lossless or hold.** A result is either a graph or an explicit hold: `lockfile_too_large`, `malformed_json`, `unsupported_lockfile`, `too_many_nodes`, `too_deep`, `lossy_entry` or `inconsistent_lockfile`. Holds include:
  - an unknown top-level or entry field, a wrong type, or a location that is not a relative package path;
  - a v3 lockfile with a legacy tree;
  - a v2 legacy tree whose `resolved`, `integrity` or `version` disagrees with `packages`, or names a location `packages` lacks. npm 6 installs from that tree, so disagreement is a smuggling channel.

  The known-field set is checked against this repository's own lockfiles in the tests, as a canary for npm format drift.

`diffNpmGraphs(before, after)` returns `opengantry.npm-dependency-graph-diff.v1`. Its fields:

- `changes`: added, removed and updated nodes by location, each with `direct` and the changed fields.
- `root`: the root fields that changed (edges, workspaces, lifecycle scripts, name, version).
- `newIdentities`: `name@version source integrity` present after but not before. A hoisting move changes locations, not identities.
- `newInstallScripts`: nodes with an install script whose identity had none before.

Neither function decides anything. Slice 1 is not wired into `gantry verify`, the CLI or any result.

### 2. Policy contract (DEP01, proposed)

A closed, versioned `dependencies` section in the standalone verify contract (`verify.yaml`, `opengantry.verify.v1`, [ADR-0051](ADR-0051-standalone-verify-contract.md)). It is strict YAML ([ADR-0047](ADR-0047-config-file-format.md)): unknown keys, wrong types and aliases are refused (`GXT_VERIFY_CONTRACT_INVALID`). Proposed shape:

```yaml
dependencies:
  schema: opengantry.dependency-policy.v1
  mode: enforce                 # audit | enforce
  ecosystems:
    npm:
      lockfile_versions: [2, 3]
      npm_version: "<pinned>"   # the npm acquisition runs (decision 5; open question 3)
  registries:                   # explicit; no inferred trust (DEP03)
    - https://registry.npmjs.org/
  approved_baseline_digest: "<sha256 of an imported graph>"   # DEP04
  approval_refs:                # where approvals live (open question 1)
    - .gitagent/dependency-approvals/
  lifecycle:
    default: deny               # deny | allow-approved
  sources:                      # what holds by default
    git: hold
    url: hold
    file_outside_workspaces: hold
    bundled: hold
  limits:
    max_lockfile_bytes: 20971520
    max_nodes: 10000
    max_depth: 32
```

- **Tighten-only inheritance.** As with ADR-0051 decision 11 and the org policy floor (RULES §8), repository and org policy are a floor. Registries are intersected; holds, `mode: enforce` and lower limits win. A task contract (`gate.json`, a handover contract) inherits and cannot loosen it.
- **The base decides authority.** The section is read from the base commit, as a tracked contract already is (ADR-0051 decision 3). A change that edits its own `dependencies` section, its approvals or the baseline is judged by the base version.
- **No exemption.** The `dependency_update` exemption skips the *mission* checks for bumps. It cannot waive admission: under `mode: enforce`, a bot's bump needs the same approval as anyone's.
- **Old readers.** A reader that does not know the section refuses a contract that carries it (see decision 6). It never ignores it.

### 3. Sources (DEP03, proposed)

The registry allowlist is explicit and compared by canonical base, as in decision 1. A registry tarball needs `integrity`. `git`, `url`, `file` outside declared workspaces, `bundled` and `hasShrinkwrap` contents hold by default. A later policy version may admit them with an equally exact identity: a full commit sha for git, an integrity hash for a URL. Credentials in a URL refuse. Approving a registry never approves every package from it.

### 4. Authority (DEP04, proposed)

An approval binds:

- the graph delta (or the full graph digest it applies to);
- the policy revision (the sha256 of the effective `dependencies` section);
- each admitted identity's name, version, source and integrity;
- the lifecycle scripts it permits, by node identity and script name;
- the approver and an expiry or revocation reference.

A package name alone never approves anything. The existing graph is admitted by an **explicit baseline import** (`approved_baseline_digest`), not inferred. That import admits exactly those identities, not their future updates. The candidate's `package.json` settings (`allowScripts`, `.npmrc`, `overrides`) are data. Only trusted policy supplies authority. An AI evaluator may explain a hold or recommend; it cannot approve or waive one.

### 5. Two boundaries: pre-execution admission and final diff verification (DEP05, proposed)

These are two separate checks, and the result names which one ran:

- **Final diff verification** (`gantry verify --contract`, base...head). It compares the base and head graphs, applies the policy and reports the diff. It runs after the agent worked, so it is **audit-only** with respect to install-time execution: it can block a merge, but not package code that already ran in the agent's environment. The result says so (`enforcement: "audit"`). Such a result cannot satisfy a workflow that requires prevention.
- **Pre-execution admission.** In order:
  1. **Resolution.** A trusted, pinned npm with trusted config and `--ignore-scripts` resolves the exact metadata and tarballs, outside the candidate's privileges.
  2. **Admission.** Digests are verified against the lock, then the graph and its diff are judged against the policy.
  3. **Materialization.** Only admitted artifacts are materialized.
  4. **Approved lifecycle scripts.** Only these run, in an independently bounded environment with explicit capabilities.

  `npm` script flags are defense in depth, not the boundary. The boundary is the launch envelope from #356: `npm run`, another package manager, a child shell, a restored cache or a direct download inside an enforced session must hit the same refusal.

  OpenGantry runs no sandbox of its own (ADR-0060). So preventive enforcement exists only where #356's capability matrix proves a host mechanism for the operation (`dependency.materialize`, `process.spawn`, `network.connect`). Where it does not, an enforced launch **refuses** rather than claim confinement. The cage freeze (ADR-0048) remains detection and restore.

### 6. Receipt (DEP06, proposed)

The verify result gains an additive, versioned `dependencies` field with:

- base, head, the effective contract and policy digests, and the before/after graph digests;
- the graph diff (digest-only: identities, sources and reason codes, never tarball contents or secrets);
- the approval references used;
- `enforcement` (`audit` | `prevent`) together with the preventive capability identity from #356.

It is covered by the existing `--sign` and keyless signatures ([ADR-0055](ADR-0055-keyless-verify-signatures.md)), so it is bound to head, base and contract. A mandatory policy section that a reader does not know is a refusal, not a pass.

### 7. Outcomes (DEP07, proposed)

`pass` means the configured admission requirements are met for exactly these inputs. It does not certify that the packages are free of malware: a registry or integrity match says nothing about whether a package is harmless.

A hold or fail comes from any of these: an unapproved addition, a disallowed source, missing integrity, a stale or revoked approval, an unauthorized lifecycle script, any graph hold from decision 1, an unknown required enforcement capability, or a signature or identity mismatch.

Revocation stops new execution and future reuse. Effects that already happened need remediation; nothing claims a rollback.

### 8. `dependency-update.ts` is not weakened

ADR-0057's checks and their tests stay as they are, and `dependency-update.ts` is unchanged in slice 1. The graph module duplicates two small ideas from it (lockfileVersion 2/3 gating, local-folder detection) rather than refactoring a security check in the same change that introduces its replacement's parser. The slice that wires admission into verify factors the shared helpers. At that point ADR-0057's existing tests are the regression net, and the factoring may only tighten. For example, registry matching moves from URL prefix to canonical base, which refuses strictly more.

## Rollout and migration (proposed)

The sequence is: audit-only diagnosis (the result shows the diff and what would hold, with `enforcement: "audit"`), then an explicit baseline import and approvals, then `mode: enforce`. A repository without a `dependencies` section is unaffected. No production activation is part of this work.

Work slices after slice 1:

2. The closed policy and authority contract (the parser for decision 2, approvals, revocation).
3. Verifier result and signing integration (decision 6).
4. The trusted acquisition and admission adapter (decision 5, on #356's boundary).
5. Malicious install-script canaries (direct install, nested commands, alternate entrypoints, restored caches, lockfile/policy substitution between approval and use) and downstream compatibility.

## Consequences

- Graph evidence exists as a deterministic, bounded library value with fixture tests. Nothing enforces with it yet, and nothing claims prevention.
- The core layer grows by one module (budget raised in MSN-0378). There is no matching deletion in core: every core export is used outside its module.
- A lockfile npm accepts may still hold here: an unknown field written by a future npm version, or a v2 legacy tree that disagrees with `packages`. The fix is a reviewed parser update, not a looser parser.
- Limits of slice 1:
  - Duplicate JSON keys resolve last-wins, as in npm's own `JSON.parse`, so this parser and npm see the same entry.
  - Workspace `package.json` lifecycle scripts are not read; only the lock's `hasInstallScript` and the root manifest are.
  - `overrides` are not in the lockfile and are not compared yet; manifest-vs-lock consistency is a later slice.
  - node-gyp builds count as install scripts only where npm sets `hasInstallScript`.

## Open questions for the owner

1. **Where approvals live and who signs them.** Proposed: committed files under a Planner-protected path, judged from the base like the contract, signed by an allowlisted key. The alternatives are a ledger entry ([ADR-0043](ADR-0043-compliance-ledger-git-ref.md)) or a consumer-supplied approval reference bound to the accepted execution contract (#355 coordination).
2. **Field names.** Are `mode`, `approved_baseline_digest`, `approval_refs`, `lifecycle` and `sources` acceptable, and does the section belong in `verify.yaml` only, or also in mission contracts ([ADR-0045](ADR-0045-mission-contracts.md))?
3. **Pinned npm version.** Which npm version does acquisition pin, and does the parser reject lockfiles it has not been tested against, or only unknown fields?
4. **Default sources.** Should `file:` dependencies inside the repository but outside `workspaces` (such as the iii example's `file:../../`) hold by default, or be admitted by path identity?
5. **`devDependencies` and `optional` platform packages.** Should these be judged identically to production dependencies (proposed: yes, since they install and run scripts the same way)?
6. **First preventive platform.** Which #356 capability-matrix cell is the first preventive target (proposed: Ubuntu 24.04 x64, Linux mechanisms only, others reported unproven)?
