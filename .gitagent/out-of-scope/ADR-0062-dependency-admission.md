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

**Design status.** Issue #355 authorizes refining requirements, not activating anything in production. This ADR records the design for DEP01–DEP07 (issue #355, "Detailed requirements R1", 2026-11-14). Of the work slices, slice 1 (MSN-0378: the graph parser and the graph diff), slice 2 (MSN-0382: the closed policy section, signed approvals and the pure admission evaluator), slice 3 (MSN-0383: the evaluator wired into `gantry verify --contract`, the signed `dependencies` result section) and slice 4 (MSN-0387: `gantry npm ci`, the trusted acquisition and admission adapter before install, without confinement) are implemented. Everything else marked *proposed* is a contract the owner reviews before any slice implements it. The owner answered the open questions on 2026-11-16 (MSN-0380); the answers are recorded under "Owner decisions" at the end and take precedence over the proposals above where they differ.

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

### 2. Policy contract (DEP01, slice 2: implemented)

A closed, versioned `dependencies` section in the standalone verify contract (`verify.yaml`, `opengantry.verify.v1`, [ADR-0051](ADR-0051-standalone-verify-contract.md)). It is strict YAML ([ADR-0047](ADR-0047-config-file-format.md)): unknown keys, wrong types, duplicate keys and aliases are refused (`GXT_VERIFY_CONTRACT_INVALID`). The shape:

```yaml
dependencies:
  schema: opengantry.dependency-policy.v1
  mode: enforce                 # audit | enforce (required)
  ecosystems:
    npm:
      lockfile_versions: [2, 3] # 2, 3 or both
      npm_version: "11.6.2"     # an exact 11.x version (required)
  registries:                   # explicit; no inferred trust (DEP03); https, no credentials
    - https://registry.npmjs.org/
  approved_baseline_digest: "<sha256 of an imported graph>"   # optional (DEP04)
  approval_refs:                # optional; this is the default
    - .gitagent/dependency-approvals/
  lifecycle:
    default: deny               # deny (default) | allow-approved
  sources:                      # v1 accepts only hold; omitted keys hold
    git: hold
    url: hold
    file_outside_workspaces: hold
    bundled: hold
  limits:                       # optional; at most the parser bounds, lower only
    max_lockfile_bytes: 20971520
    max_nodes: 10000
    max_depth: 32
```

`packages/core/src/dependency-policy.ts` holds the model: `parseDependencyPolicy` (closed, fail-closed defaults), `canonicalRegistry`, `mergeDependencyPolicy` and `dependencyPolicyRevision`. `packages/verify/src/contract.ts` reads the section into `VerifyContract.dependencies` and turns every problem into `GXT_VERIFY_CONTRACT_INVALID`.

- **Tighten-only inheritance.** As with ADR-0051 decision 11 and the org policy floor (RULES §8), repository and org policy are a floor. `mergeDependencyPolicy(floor, local)`:
  - intersects registries, lockfile versions and approval locations;
  - `enforce` beats `audit`, `deny` beats `allow-approved`, the lower of each limit wins, and sources stay held;
  - a local section may drop the floor's baseline (tighter), but naming any baseline the floor does not name refuses, also when the floor names none or there is no floor: a baseline admits a whole graph without a signature, so only the repository section can set it;
  - a local section may not change the npm pin: that refuses too.

  A task contract inherits the repository's section through `mergeRepositoryLaw`. A `gate.json` cannot carry the key at all, and missions carry none (owner decision 2). The org policy bundle does not carry a section yet.
- **The base decides authority.** The section is read from the base commit, as a tracked contract already is (ADR-0051 decision 3). A change that edits its own `dependencies` section, its approvals or the baseline is judged by the base version. A test shows that a candidate that loosens its own section is still judged by the stricter base section.
- **No exemption.** The `dependency_update` exemption skips the *mission* checks for bumps. It cannot waive admission: the evaluator (decision 7) has no exemption input. A test shows a bump that ADR-0057's check accepts still holds without approval.
- **Old readers.** Every released `opengantry.verify.v1` reader refuses unknown top-level keys, so a reader that predates the section refuses a contract that carries it instead of ignoring it (DEP06). The nested `schema: opengantry.dependency-policy.v1` makes this reader refuse a later policy version the same way. The verify schema name stays `opengantry.verify.v1`, because the addition is optional and every older reader already fails closed on it.
- **Policy revision.** The sha256 of the canonical JSON of the normalized effective section. Spelling does not change it: a missing trailing slash, an omitted default. Any change of meaning does, including a new baseline digest.

### 3. Sources (DEP03, slice 2: implemented in the evaluator)

The registry allowlist is explicit and compared by canonical base, as in decision 1: equality, never a prefix, so `https://registry.npmjs.org.evil.example/` and `https://registry.npmjs.org/evil/` are other registries. A policy registry must be https, without credentials, query or fragment. A registry tarball needs `integrity`. `git`, `url`, `file` (a tarball or a folder outside declared workspaces), `bundled`, `hasShrinkwrap` contents and entries without `resolved` hold by default. Credentials in any source fail. Approving a registry never approves every package from it.

A `file:` dependency is admitted only by an approval that names its repository-relative path and the sha256 content digest of that path at the base commit (owner decision 4). The caller computes the digests; the evaluator compares them. A path that resolves outside the repository holds. npm's description of a local folder's own `node_modules` (`external` in the graph) follows the folder: it is admitted when the folder is, and held otherwise. A link whose target is not in the lockfile holds.

**Workspaces come from the base.** Slice 1 calls a folder a `workspace` when it matches the `workspaces` globs of the lockfile it parses, and the candidate writes the head lockfile. So the evaluator takes the authoritative globs from the base graph's root (none when the base has no lockfile). A head `workspace` node is a workspace, needing no approval, only when it is inside the repository and matches a base glob. Otherwise it is judged exactly like a `local` folder: path plus content digest, or `local_outside_repository`. A change to the root `workspaces` globs is a root change: it holds (`root_workspaces_changed`) unless an approval made for this head graph names exactly the head globs in `root_workspaces`. Even then the new globs admit nothing until they are at base; a new workspace folder needs its own `files` approval.

**`external` entries are not installed (evidence, npm 11.19.1).** A lockfile for `app` with `lib: file:../lib` and a hand-written entry `../lib/node_modules/is-number` (version 6.0.0, `resolved` on an unreachable host `https://evil.example/x.tgz`, a bogus `integrity`) was run with `npm ci --ignore-scripts` and with `npm install --ignore-scripts`. Both exited 0, fetched nothing (the host does not resolve) and created no `../lib/node_modules`; only the link was installed. `npm install --package-lock-only` in this setup writes no `external` entries at all. So admitting `external` entries on the folder's approval, without judging their own `resolved` or integrity, admits nothing this lockfile installs. What the folder itself needs at run time comes from its own `node_modules`, outside this lockfile; slice 4 (acquisition) must confirm this for the pinned npm version and judge that folder's own lockfile if it installs one. *Slice 4 does not rely on it:* `gantry npm ci` materializes registry nodes only and refuses every other source, `external` included (`source_not_materializable`).

A later policy version may admit git or URL sources with an equally exact identity: a full commit sha for git, an integrity hash for a URL. v1 accepts only `hold` for them.

### 4. Authority (DEP04, slice 2: implemented)

**Approval format.** An approval is a committed JSON file under one of the policy's `approval_refs` (default `.gitagent/dependency-approvals/`), read from the base commit (owner decision 1). It is machine-written, closed and versioned (`packages/core/src/dependency-approval.ts`):

```json
{
  "schema": "opengantry.dependency-approval.v1",
  "lockfile": "package-lock.json",
  "graph_digest": "<sha256: the head graph this approval was made for>",
  "policy_revision": "<sha256 of the effective dependencies section>",
  "identities": [{ "name": "x", "version": "1.0.0", "source": { "kind": "registry", "ref": "https://registry.npmjs.org/" }, "integrity": "sha512-…" }],
  "lifecycle": [{ "name": "x", "version": "1.0.0", "source": { "kind": "registry", "ref": "https://registry.npmjs.org/" }, "integrity": "sha512-…", "scripts": ["install", "postinstall", "preinstall"] }],
  "root_scripts": [{ "script": "postinstall", "command_sha256": "<sha256 of the command string>" }],
  "files": [{ "path": "vendor/x", "content_digest": "<sha256 of the folder or tarball at base>" }],
  "root_workspaces": ["packages/*"],
  "approver": "planner@example.com",
  "issued_at": "2026-11-16T00:00:00Z",
  "expires_at": "2026-12-16T00:00:00Z",
  "signature": "-----BEGIN SSH SIGNATURE-----\n…\n-----END SSH SIGNATURE-----\n"
}
```

The format is bounded: at most 4 MiB per file, 10,000 entries per list and 1,000 files. Unknown keys, other schemas, wrong types, relative paths with `..`, non-UTC times, an expiry not after the issue time and a missing signature are all refused.

- `identities` admit registry packages by exact name, version, canonical registry and integrity. A name alone never approves anything.
- `lifecycle` permits install-time scripts by node identity (registry, workspace or local). The lockfile only says that one of `preinstall`, `install` and `postinstall` runs (`hasInstallScript`), not which, so a permission must name all three. Slice 4 can narrow this to exact names from the tarball's manifest; approvals that name all three stay valid. *As implemented,* slice 4 reads the exact names from the tarball and reports them in its receipt, but approvals keep naming all three: narrowing them would change the approval format.
- `root_scripts` permit root `package.json` lifecycle scripts by name and the sha256 of the command, so a changed command needs a new permission. Workspace manifests' own scripts are not read by the graph yet (decision 1), so only their `hasInstallScript` is judged, through `lifecycle`.
- `files` admit `file:` sources and local folders, including a head `workspace` that no base glob covers (decision 3).
- `root_workspaces` (optional) accepts a change of the root `workspaces` globs to exactly this sorted list, each glob once; it is only usable for this head graph. Without the key no root workspace change is approved.

**Signature.** The approver signs the canonical JSON of the file without `signature`, using `ssh-keygen -Y sign -n opengantry-dependency-approval`. An approval counts only when the SSHSIG verifies against the base commit's allowed-signers file and that file lists the signing key for the approval's `approver`. The allowlist is the Planner allowlist, `.gitagent/foreman/PLANNER.signing.pub` (ssh-keygen ALLOWED SIGNERS format, the file `gantry perimeter` already points `gpg.ssh.allowedSignersFile` at).

Why this mechanism:

- A candidate cannot forge it without an allowlisted private key. The allowlist, the approvals and the policy are all read from the base, so a candidate's own edits to any of them do not count.
- A git commit signature (`%G?`) would only prove who committed the file, not what they approved, and it depends on local git configuration. Sigstore keyless signatures (ADR-0055) need network access and a trust root.
- The dedicated namespace keeps a signed verify receipt (namespace `gxt`) from being replayed as an approval.

Verification is pure `node:crypto` in core: ed25519 SSHSIG with sha256 or sha512, the same wire format `ssh-keygen` writes, and a test checks real `ssh-keygen` output. The allowed-signers reader fails closed. It accepts only `ssh-ed25519` keys and only the `namespaces=` option. A line with any other option (`cert-authority`, `valid-before`, …) is untrusted, and wildcard principals are ignored.

**Revocation.** A revocation is a file `opengantry.dependency-revocation.v1` under `approval_refs` with `revokes` (approval ids: the sha256 of the signed message), `reason`, `revoked_by` and `issued_at`. It needs no signature, because it can only remove authority. A revoked approval never admits again while the revocation is at base. Deleting the approval file alone is not enough, because the signed file could be committed again. Removing a key from the allowed-signers file disables every approval it signed.

**Usable and fresh.** An approval is usable when it is for this lockfile, signed by an allowlisted key for its approver, unrevoked, inside `issued_at`…`expires_at` at the caller's `now`, and made for the current policy revision. It admits something that is new against the base graph (a new identity, a new install script, a new root script or `file:` source) only when its `graph_digest` is exactly the head graph. Things already in the base graph keep needing a usable approval or the baseline, but not one for this head graph. So a policy change makes earlier approvals stale; the Planner re-imports a baseline in the same policy change. An expired approval stops admitting what it admitted.

**Baseline.** The existing graph is admitted by an **explicit baseline import** (`approved_baseline_digest`), not inferred. The caller supplies the baseline graph. Its digest must equal the policy's: if it differs, the result fails, and if it is missing, the result holds. The import admits exactly those identities, install scripts and root scripts, not their future updates. Without a baseline, nothing in the base graph is admitted by default.

The candidate's `package.json` settings (`allowScripts`, `.npmrc`, `overrides`) are data. Only trusted policy supplies authority. An AI evaluator may explain a hold or recommend; it cannot approve or waive one, and no AI output is an input to the evaluator.

### 5. Two boundaries: pre-execution admission and final diff verification (DEP05; final diff verification implemented in slice 3, pre-execution admission implemented in slice 4 without confinement)

These are two separate checks, and the result names which one ran:

- **Final diff verification** (`gantry verify --contract`, base...head). It compares the base and head graphs, applies the policy and reports the diff. It runs after the agent worked, so it is **audit-only** with respect to install-time execution: it can block a merge, but not package code that already ran in the agent's environment. The result says so (`enforcement: "audit"`). Such a result cannot satisfy a workflow that requires prevention.
- **Pre-execution admission.** In order:
  1. **Resolution.** A trusted, pinned npm with trusted config and `--ignore-scripts` resolves the exact metadata and tarballs, outside the candidate's privileges.
  2. **Admission.** Digests are verified against the lock, then the graph and its diff are judged against the policy.
  3. **Materialization.** Only admitted artifacts are materialized.
  4. **Approved lifecycle scripts.** Only these run, in an independently bounded environment with explicit capabilities.

  `npm` script flags are defense in depth, not the boundary. The boundary is the launch envelope from #356: `npm run`, another package manager, a child shell, a restored cache or a direct download inside an enforced session must hit the same refusal.

  OpenGantry runs no sandbox of its own (ADR-0060). So preventive enforcement exists only where #356's capability matrix proves a host mechanism for the operation (`dependency.materialize`, `process.spawn`, `network.connect`). Where it does not, an enforced launch **refuses** rather than claim confinement. The cage freeze (ADR-0048) remains detection and restore.

**As implemented (slice 4, MSN-0387): `gantry npm ci`.** The pre-execution path above, up to and excluding step 4's bounded environment, which does not exist yet. A pure plan (`packages/missions/src/npm-ci/plan.ts`) and an executor with an explicit interface (`execute.ts`, `fetch.ts`, `npm.ts`); the pure checks are in core (`dependency-install.ts`, `dependency-tarball.ts`). The plan is serializable: inputs digests, the admitted artifact set and the admission section, which is what a broker would bind as the `dependency.materialize` resource (ADR-0063 section 9). It does not depend on the broker.

1. **Trusted inputs.** The policy is the base commit's `verify.yaml` section only; a task contract cannot supply or tighten it here. The head lockfile (`npm-shrinkwrap.json` first) is judged by the slice-3 reader with a new `judge` input, so it is judged whether or not the change touched it, together with every changed dependency file. Anything but `pass` refuses before any network access, under `mode: audit` too (conservative: an install is an enforcement action).
2. **The npm pin.** npm is the `npm-cli.js` beside the running node, run with that node; only without one is `PATH` searched, skipping `node_modules/.bin` folders and the repository, and an npm whose real path is in the repository is refused. It must report exactly `ecosystems.npm.npm_version` (owner decision 3); another version refuses (`npm_version_mismatch`). A project without `package.json` refuses at plan time (`manifest_missing`).
3. **Acquisition by gantry, not npm.** gantry downloads each tarball from the lockfile's `resolved` URL with `node:https`: https, no credentials, under a policy registry base, redirects followed only under a policy registry base path, bounded size, idle time and overall deadline, no proxy and no auth; each tarball is streamed to disk, then verified and inspected alone. Every strong hash in `integrity` (sha512, sha384, sha256) must match; sha1-only refuses. Only verified bytes are read: a bounded in-memory tar reader yields the tarball's `package.json`. It must never see less than npm's `tar` (node-tar, via pacote: strip one component, files only) extracts, so it follows node-tar where unambiguous and refuses the rest: the two-zero-block end marker and nothing after it; pax `x` with only `path`, `linkpath`, `size` and inert keywords, a pax size equal to the ustar size; no pax `g`, GNU `L`/`K` or other meta type; no header node-tar skips as one block (bad checksum, no path, link target mismatch) and no folder with a size; no backslash, empty, `.`, `..` or drive-like component; no two paths equal without case (NFC). A test runs every fixture through npm's own `tar`. Its name and version must be the lockfile's, its install scripts (`preinstall`, `install`, `postinstall`, or a `binding.gyp` without them and without `gypfile: false`) must exist exactly when the lockfile says `hasInstallScript`, and bundled dependencies, its own `node_modules` or an `npm-shrinkwrap.json` refuse.
4. **Check before use.** Digests of the base `verify.yaml`, the policy revision, the approval files (path and blob id under `approval_refs`), the allowed signers, the lockfile and `package.json` are taken around the admission read and re-checked before materialization, as is the base ref's commit (`inputs_changed`). npm then installs from copies written at check time.
5. **Materialization by npm, offline.** The verified tarballs seed a fresh npm cache (`npm cache add`); `npm ci --offline --ignore-scripts` runs in a staging directory holding only the checked `package.json` and lockfile, with `--prefix` set to it, fresh empty user and global npmrc files, a fresh cache and a clean environment (`PATH` without repository or `node_modules/.bin` entries, a temp `HOME` and `TMPDIR`, `LANG`; no `npm_config_*`, `NODE_OPTIONS`, proxy or token). npm finds each tarball by integrity in that cache; a miss is `ENOTCACHED`, never a fetch (checked with npm 11.19.1).
6. **Layout.** The staged tree must be exactly the admitted graph (no extra or missing package folder except an optional platform package, no symlinked package, the admitted name and version, every `.bin` link into an admitted package); it then replaces the project's `node_modules` and is checked again there. A test shows npm pruning a lockfile node with no incoming edge, which this check refuses.
7. **Lifecycle scripts.** An environment counts only when the ADR-0063 capability matrix records its `dependency.materialize` cell as `prevention`; none does. So an approved install script refuses `capability_unproven` under enforce. `--audit-unconfined-scripts` runs them (`npm rebuild` with scripts on, in the staging directory) and labels the receipt `enforcement: audit` with `scripts_ran_unconfined`. Root lifecycle scripts never run (`root_lifecycle_unsupported`).
8. **Receipt.** `opengantry.dependency-install.v1` (zod `dependencyInstallSchema`, conformance golden `npm-ci.contract-dependencies`): outcome, enforcement, inputs digests, npm pinned and found, the embedded slice-3 admission section, per-package outcome and install scripts, scripts refused or run, reasons. `prevention: false`, `preventive_capability: null` and `direct_installers_blocked: false` are fixed values; claiming more needs a new schema version. It is not signed in this slice.

**Why gantry fetches and npm materializes.** npm's own fetch (`npm ci --ignore-scripts`) verifies integrity, but it follows redirects to any origin, honours proxy and auth configuration, and gives no point at which to read a tarball's `package.json` before it is unpacked. Fetching in gantry makes every refusal (origin, credentials, integrity, script mismatch, bundles) a check in this code with a test, before any byte reaches npm. Unpacking in gantry would mean reimplementing npm's placement, `.bin` linking and modes; npm offline from a cache of verified bytes keeps npm's layout and is held to the admitted graph afterwards.

**Limits of slice 4.**

- Not prevention. It does not stop `npm install`, `npx`, `yarn`, `pnpm`, `npm run` or a child shell run directly, a restored cache used by another tool, or a direct download (DEP-T02 needs the confinement boundary of #356). `--ignore-scripts` and the clean environment are defense in depth.
- Registry nodes only: workspaces, local folders, links and other sources refuse. No proxy and no registry credentials.
- A same-user process can replace the npm beside node; the version check is not a boundary. Audit-run scripts see the staging path.
- An untracked, unignored `node_modules` is a change and holds.
- Evidence is fixture-only: a local https registry in the tests; no live registry install.

### 6. Receipt (DEP06, slice 3: implemented for final diff verification)

The verify result gains an additive, versioned `dependencies` field with:

- base, head, the effective contract and policy digests, and the before/after graph digests;
- the graph diff (digest-only: identities, sources and reason codes, never tarball contents or secrets);
- the approval references used;
- `enforcement` (`audit` | `prevent`) together with the preventive capability identity from #356.

It is covered by the existing `--sign` and keyless signatures ([ADR-0055](ADR-0055-keyless-verify-signatures.md)), so it is bound to head, base and contract. A mandatory policy section that a reader does not know is a refusal, not a pass.

**As implemented (slice 3, MSN-0383).** `packages/verify/src/dependencies.ts` reads the inputs and calls the evaluator; `packages/verify/src/run.ts` adds the section; `packages/core/src/schemas/verify-dependencies-schema.ts` is its zod schema (`zod/mini`, so the slim package stays small).

- **When.** Exactly when the effective contract has a `dependencies` policy. The result is then `opengantry.verify-result.v2`; without a policy it stays `opengantry.verify-result.v1`, unchanged. Every released reader (`checkVerifyResult` before slice 3) accepts only the v1 schema name, so it refuses a v2 result instead of ignoring the section. The new reader accepts both, refuses a v1 result that carries a section, a v2 result without one, a malformed section (strict zod schema), a section for another base, head or policy revision, and a v1 result for a contract that has a policy.
- **Trusted inputs.** All from the base commit with git object reads (`git cat-file`, `git ls-tree`), never the working tree: the policy (the base `verify.yaml`, merged tighten-only); the files under `approval_refs`; the allowed signers (`.gitagent/foreman/PLANNER.signing.pub`); the base graph (base lockfile plus its sibling `package.json`); the baseline graph; and the content digests of `file:` folders. Only the head lockfile and manifest come from the change (from the working tree with `--worktree`). Lockfiles are parsed with the effective `limits`, and the head lockfile's byte length is passed. The time approvals are judged at is the run's clock.
- **Task contracts.** A task contract never supplies the policy (owner decision 2). When the base has no `verify.yaml`, or its `verify.yaml` has no `dependencies` section, a task contract that carries one is refused (`GXT_VERIFY_CONTRACT_INVALID`). This closes the gap slice 2 disclosed in `run.ts`.
- **Changed files.** Of the paths the run already judges (base...head), these are dependency files: any `package.json`, `package-lock.json`, `npm-shrinkwrap.json` and `.npmrc` at any depth, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, and anything under a `node_modules/` segment. Names and the `node_modules` segment are matched case-insensitively, because npm reads `PACKAGE-LOCK.JSON` on a case-insensitive checkout. Each changed npm lockfile that exists at head is judged by the evaluator. Around it, verify holds:
  - `unsupported_dependency_file`: the four unsupported lockfile names, and a case variant of any judged name that is not the exact name. A lockfileVersion 1 lockfile holds through the evaluator (`graph_hold`).
  - `npm_config_changed`: an added, changed or removed `.npmrc` at any depth. The candidate's npm configuration (registry, auth, script settings) is data, never authority. The approval format has no entry for it, and reusing `files` (which admits `file:` sources of one lockfile's graph) would not fit, so it always holds under enforce; a `.npmrc` change goes through the Planner in a change of its own (review round, PR #368).
  - `node_modules_changed`: committed `node_modules` content bypasses the lockfile.
  - `manifest_without_lock_change`: a changed `package.json` whose governing lockfile did not change. The governing lockfile is npm's: the nearest directory at or above it with `npm-shrinkwrap.json`, else `package-lock.json` (at head, or at base for a removed manifest).
  - `manifest_without_lockfile`: a `package.json` with no lockfile at or above it.
  - `manifest_lock_mismatch`: the head `package.json` root edges (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`) or `workspaces` differ from the lockfile root. That is as far as slice 1 reads a manifest; `overrides` are not compared.
  - `lockfile_missing`: a lockfile removed while its `package.json` stays (`lockfile_removed` is info when both go).
  - `dependency_file_symlink`: a lockfile, `package.json` or `.npmrc` (any name case, outside `node_modules`) that is a symlink at the base or the head, anywhere in the tree. npm reads the target, which a change can edit under a path no dependency rule matches, so the link is refused, not followed (MSN-0388: a `package-lock.json` linked to `deps/lock.json`, and a `file:` folder's linked `package.json`, passed under enforce when only the target changed).
- **Baseline graph.** The base graph when its digest is `approved_baseline_digest`; otherwise the newest of the last 50 revisions of that lockfile behind the base whose graph has that digest; otherwise none, so the evaluator holds `baseline_unavailable`. The digest is that of the graph parsed with the sibling `package.json`, which the result reports as `base_graph` for import.
- **Content digests.** `opengantry.content-digest.v1` of a repository path: sha256 of the canonical JSON of every blob under it (path relative to the given path, git mode, sha256 of the bytes), sorted. A path that is absent, holds a submodule or a symlink (git mode `120000`: the blob is the link text, not what npm reads; MSN-0388), or exceeds 10,000 files or 64 MiB has none, so an approval cannot match. A folder the change leaves alone is digested at the base; a folder the change edits is digested at the head commit, the content npm would install, so it is admitted only by an approval at the base for exactly that new content (owner decision 4). An edited folder has no digest in worktree mode, nor does the repository root (`.`) once anything changed, since its content includes the approval that would name it.
- **Edited folders of an unchanged lockfile.** Every npm lockfile at head that the change did not touch is judged as well when the change edits one of its `file:` sources or local folders, or a `workspace` folder no base glob of that lockfile covers (`local_folder_changed`, info, names the folder; the evaluator then holds `source_file` unless the new digest is approved). A workspace a base glob covers needs no approval (decision 3), so editing it judges nothing. Without this, a change to `vendor/x` behind an unchanged `x: file:vendor/x` passed with no dependency file judged (review round, PR #368). A folder that is, lies under or contains a symlink or a submodule (gitlink, mode `160000`) is judged whenever anything changed, since the change may have edited the target or moved the submodule's commit, which only changes the gitlink's own path (it has no digest, so it holds; MSN-0388 review round), and a lockfile whose head graph does not parse is judged instead of skipped, so the evaluator holds `graph_hold`: before MSN-0388, a task contract that only lowered `limits.max_nodes` made the head graph unparseable and turned the edited-folder hold into a pass. The tree listings that find symlinks, submodules and lockfiles use a 512 MiB buffer and throw `GXT_VERIFY_GIT_FAILED` when they fail: an empty list would read as "nothing to judge" (in a tree whose listing outgrew git's default 32 MiB buffer, an edited symlink target passed).
- **Section.** `opengantry.verify-dependencies.v1`: `outcome` (the worst reason), `mode`, `enforcement` (always `audit`, decision 5), `base`, `head`, `policy_revision`, `ecosystems` (`["npm"]`), the changed dependency `files`, per judged lockfile its `outcome`, `base_graph`, `head_graph`, `graph_diff` (sha256 of the canonical diff) and `approvals_used`, the union of `approvals_used`, and the sorted `reasons` (code, severity, file, location, a detail of at most 300 characters). No lockfile or manifest contents and no secrets: graph sources are credential-free (decision 1). The full diff stays out; its digest binds it.
- **Outcome.** Under `mode: enforce` a hold or fail is a verify problem, so the run fails closed. Under `audit` it is reported, labelled in the summary, SARIF (warning) and JUnit (skipped), and does not fail the run. No preventive capability identity is recorded: slice 3 claims no prevention.
- **No exemption.** `gantry verify --contract` never consults the `dependency_update` trusted automation. A test shows a bot bump that `manifestUpdateProblem` and `lockfileUpdateProblem` accept still holds under enforce without approval, and passes with a matching approval (DEP-T04).

### 7. Outcomes (DEP07, slice 2: implemented as a library verdict)

`pass` means the configured admission requirements are met for exactly these inputs. It does not certify that the packages are free of malware: a registry or integrity match says nothing about whether a package is harmless.

`evaluateDependencyAdmission` (`packages/core/src/dependency-admission.ts`) judges one lockfile's head graph. Its inputs are the effective policy, the base, head and baseline graphs, the head lockfile's byte length, the approval files, the allowed signers and the content digests (all read from the base by the caller), and `now` (a UTC timestamp that must round-trip, so `2026-02-31T00:00:00Z` and `T24:00:00Z` are invalid input). It enforces all three policy limits itself: `max_nodes`, `max_depth` (nested `node_modules` per location) and `max_lockfile_bytes`, so a caller that parsed with looser limits still holds. It returns `opengantry.dependency-admission.v1`, which carries:

- `verdict`: `pass`, `hold` or `fail`;
- `mode`;
- the policy revision and the base and head graph digests;
- the approvals used;
- sorted reasons, each with a stable code, a severity and a location.

The reason codes:

| Severity | Codes |
|----------|-------|
| `fail` | `source_credentials`, `baseline_mismatch`, `approval_signature_invalid` (a forged, tampered or unlisted approval at base) |
| `hold` | `invalid_input`, `graph_hold`, `unsupported_lockfile`, `too_many_nodes`, `lockfile_too_large`, `too_deep`, `baseline_unavailable`, `approvals_too_large`, `approval_invalid`, `approval_outside_refs`, `registry_not_allowed`, `integrity_missing`, `source_git`, `source_url`, `source_file`, `source_external`, `source_bundled`, `source_shrinkwrap`, `source_unresolved`, `local_outside_repository`, `link_target_missing`, `root_workspaces_changed`, `unapproved_identity`, `approval_stale`, `approval_expired`, `approval_revoked`, `lifecycle_denied`, `lifecycle_unapproved`, `root_manifest_missing` |
| `info` | `approval_inactive` (an unusable approval nothing needed) |

Malformed input holds or fails; it never passes. Under `lifecycle.default: deny`, no approval or baseline permits a lifecycle script. Dev and optional packages are judged like production ones (owner decision 5): each platform package the lockfile lists needs its own approval. `mode: audit` yields the same verdict, labelled `audit`. Slice 3 wires the result into `gantry verify --contract` and its signed result (decision 6). An unknown required enforcement capability belongs to slice 4, which refuses it as `capability_unproven` (decision 5).

Revocation stops new execution and future reuse. Effects that already happened need remediation; nothing claims a rollback.

### 8. `dependency-update.ts` is not weakened

ADR-0057's checks and their tests stay as they are, and `dependency-update.ts` is unchanged in slices 1 and 2. Slice 2 does not import from it either: the policy module has its own canonical registry comparison. The slice that wires admission into verify factors the shared helpers. At that point ADR-0057's existing tests are the regression net, and the factoring may only tighten. For example, registry matching moves from URL prefix to canonical base, which refuses strictly more.

## Rollout and migration (proposed)

The sequence is: audit-only diagnosis (the result shows the diff and what would hold, with `enforcement: "audit"`), then an explicit baseline import and approvals, then `mode: enforce`. A repository without a `dependencies` section is unaffected. No production activation is part of this work.

Work slices after slice 1:

2. The closed policy and authority contract (the parser for decision 2, approvals, revocation). *Implemented (MSN-0382)*: the policy section, the approval and revocation formats, SSHSIG verification and the pure evaluator. Nothing calls the evaluator outside tests.
3. Verifier result and signing integration (decision 6): reading the lockfiles, approvals, allowed signers and content digests at base, choosing the baseline graph, and adding the verdict to the signed result. *Implemented (MSN-0383)*, including the fix for a task contract loaded when the base has no `verify.yaml`: its own `dependencies` section is now refused instead of used unmerged.
4. The trusted acquisition and admission adapter (decision 5, on #356's boundary). *Implemented (MSN-0387)* as `gantry npm ci`, without confinement: approved install scripts refuse `capability_unproven` until a canary proves a `dependency.materialize` cell.
5. Malicious install-script canaries (direct install, nested commands, alternate entrypoints, restored caches, lockfile/policy substitution between approval and use) and downstream compatibility.

## Consequences

- Graph evidence exists as a deterministic, bounded library value with fixture tests. Nothing enforces with it yet, and nothing claims prevention.
- The core layer grows by one module (budget raised in MSN-0378). There is no matching deletion in core: every core export is used outside its module.
- Slice 2 (MSN-0382) adds three core modules (policy, approval, admission; about 960 lines and 24 exports) and the section parser in the verify layer. Both budgets are raised for this named feature; no deletion inside the mission's scope offsets it. Approvals add a second signature format beside the verify receipt's (same SSH key family, separate namespace). Verification is pure, so admission needs no `ssh-keygen` at verify time.
- A lockfile npm accepts may still hold here: an unknown field written by a future npm version, or a v2 legacy tree that disagrees with `packages`. The fix is a reviewed parser update, not a looser parser.
- Slice 3 (MSN-0383) adds one verify module and one core schema module, and the slim verify package inlines `zod/mini`. Limits of slice 3:
  - The baseline applies to whichever lockfile's graph it names; another changed lockfile in the same repository holds `baseline_unavailable` when the policy names a baseline.
  - A `file:` folder approval over the repository root (`file:../../` from a nested lockfile) cannot be made practical: the digest covers the whole repository and changes with every commit.
  - "Base" is the commit the run is given; the changed files are measured from the merge base, as for the rest of verify.
- Slice 4 (MSN-0387) adds two core modules (tarball reader, install checks), one core schema module, four missions modules (`npm-ci/`), one command and a subcommand registry entry. The core, missions, command and delivery budgets are raised for this named feature, and verify by the `judge` input; only internal helpers were un-exported to offset it.
- Limits of slice 1:
  - Duplicate JSON keys resolve last-wins, as in npm's own `JSON.parse`, so this parser and npm see the same entry.
  - Workspace `package.json` lifecycle scripts are not read; only the lock's `hasInstallScript` and the root manifest are.
  - `overrides` are not in the lockfile and are not compared yet; manifest-vs-lock consistency is a later slice.
  - node-gyp builds count as install scripts only where npm sets `hasInstallScript`.

## Owner decisions (2026-11-16)

The owner answered the six open questions in chat, one at a time (MSN-0380). Each question is kept with its answer.

1. **Where approvals live and who signs them.** *Decision:* committed files under a Planner-protected path (`.gitagent/dependency-approvals/`, the `approval_refs` default). They are read from the base commit, as the contract is, and each must be signed by an allowlisted key. Not ledger entries ([ADR-0043](ADR-0043-compliance-ledger-git-ref.md)), and not a consumer-supplied reference.
2. **Field names and placement.** *Decision:* the proposed names stand (`schema`, `mode`, `ecosystems.npm`, `registries`, `approved_baseline_digest`, `approval_refs`, `lifecycle`, `sources`, `limits`). The section lives in `verify.yaml` only. Missions and task contracts ([ADR-0045](ADR-0045-mission-contracts.md)) inherit it as a tighten-only floor and cannot carry their own `dependencies` block.
3. **Pinned npm version.** *Decision:* the policy pins an exact npm 11.x version, by default the version CI tests. The parser keeps rejecting unknown fields and shapes (decision 1) but does not gate on npm version, because a lockfile does not record which npm wrote it. Bumping the pin is a policy change.
4. **Default sources.** *Decision:* a `file:` dependency inside the repository but outside `workspaces` holds by default. An approval may admit one by its repository-relative path plus the folder's content digest at the base commit, so a change to that folder needs a new approval. The iii example's `file:../../` gets an explicit approval.
5. **`devDependencies` and `optional` platform packages.** *Decision:* judged identically to production dependencies. Optional platform packages are approved by identity for every platform the lockfile lists, not only the platform that installs.
6. **First preventive platform.** *Decision:* **Ubuntu 26.04 x64** (the owner changed this from the proposed 24.04), Linux mechanisms only. macOS and Windows rows are reported `unsupported` or `unproven`, and an enforced launch there refuses. The mechanism follows ADR-0063's owner decisions: the harness sandbox (Claude Code's bubblewrap first), proven by canaries.
