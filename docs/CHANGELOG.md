---
title: "Changelog"
description: "Upgrade notes and substrate notes for every release of @jeger-ai/opengantry. What each release changed is in the release notes."
publish: false
---

# Changelog

Upgrade notes and substrate notes for `@jeger-ai/opengantry`. What each release changed, in short: [`reference/release-notes.md`](reference/release-notes.md). Adopter docs describe **current** behavior without version tags — see [`index.md`](index.md).

Install: `npm install -g @jeger-ai/opengantry` or pin a specific release from the release notes.

---

## Current substrate notes

- **Versions:** `MANIFEST.yaml` `schema_version` **0.5.0**; CLI **5.0.0** (see `package.json`).
- **Law files are YAML:** `MANIFEST.yaml`, `config.yaml`, `ARCHITECTURE.pointer.yaml` and `POLICY.pointer.yaml`.
  - A 3.x JSON file is still read when the YAML form is absent.
  - If both forms exist and differ, the CLI fails closed (`GXT_LAW_FILE_AMBIGUOUS`).
  - `gantry migrate <file>` converts a JSON file, and `gantry doctor` warns until you do ([ADR-0047](../.gitagent/out-of-scope/ADR-0047-config-file-format.md)).
- **Evidence is machine-written:** `gantry verify --record` writes `.gitagent/runs/<MSN>.json` after a full pass on a clean committed tree.
  - A mission without `trace_rows` is verified by that record.
  - The Planner stamp is the newest commit by a Planner email whose subject starts with `[MSN-…]` and which modifies the mission file (RULES §3, §6.1).
- **One path law:**
  - The cage, mission scope, the perimeter, the staged guard, the MCP write guard and `gantry verify --contract` all decide whether a path may change with `judgePath` in `packages/core/src/path-law.ts` ([ADR-0053](../.gitagent/out-of-scope/ADR-0053-one-path-law.md)).
  - All path patterns go through `packages/core/src/path-glob.ts`. A glob matches whole paths. A pattern that names an area covers the path or any folder above it.
- **Architecture boundaries:** keep `TARGET_ARCHITECTURE.yaml` at the repository root and run `gantry arch check` in mission gates.
  - Schema 0.4.0 adds `budget`, `owner`, `registry`, `dependency` and `duplicate` rules.
  - `--ratchet` records a lower `ARCH_BASELINE.json`; `--allow-raise` lets a Planner mission raise it.
- **Verify outputs:** `gantry verify --format sarif|junit` for CI dashboards (`--json` is unchanged).
  - Diagnostics go to stderr, so the document is the only stdout payload.
  - GitHub Code Scanning and GitLab JUnit wiring: [`CI.md`](CI.md).
  - `gantry verify --contract` checks a change against one `verify.yaml` without `.gitagent/`: [Verify a change without missions](guides/verify-contract.md).
- **Typed adapter gates:** `gate_adapter: tsc|eslint` requires a single command. An unquoted `&&`, `||`, `;` or line break fails closed with `GXT_GATE_ADAPTER_MISCONFIG` ([ADR-0041](../.gitagent/out-of-scope/ADR-0041-gate-adapter-routing.md)).
- **External architecture docs:** `gantry arch fetch` for `kind: external` pointers. `gantry doctor` stays offline.
- **Hooks and CI call the CLI:**
  - Each git hook is one line, `gantry hook <name>`.
  - CI runs `gantry ci msn-range|verify-missions|trusted-automation|upgrade-tmp`.
  - Session helpers run `gantry runtime env` and `gantry pin`.
- **Org policy floor:** pinned with `POLICY.pointer.yaml` and read offline from the cache.
  - Its forbidden zones and banned imports join every mission's scope.
  - Its `perimeter_protected_add` paths join the perimeter.
  - If it cannot be read, `gantry perimeter --ci` fails ([ADR-0042](../.gitagent/out-of-scope/ADR-0042-org-policy-bundle.md)).
- **Parked experiments:** the contract preflight, the contract drift index, defensive profiles and virtual capture are no longer part of the CLI. Their code is under `examples/`, and a `defensive_profile` config block or a mission's `virtual_capture` field is ignored ([ADR-0052](../.gitagent/out-of-scope/ADR-0052-rewrite-under-structural-law.md) A10).
- **Library use:** the published entry points are `.` (the CLI) and `./kernel` (`verifyMission`, `evaluateScope` and the other kernel exports). Do not deep-import `dist/`.
- **This repository:**
  - Packages: `core`, `git`, `cage`, `plane`, `verify` and `missions` under `packages/`, imported as `#<package>/<module>.js`.
  - `src/cli` holds only the entries, programs, commands and the support layer: `output`, `mcp`, `doctor`, `report`, `init`, `flows` ([ADR-0054](../.gitagent/out-of-scope/ADR-0054-finish-the-package-graph.md)).
  - Contributor workflow: [`DEVELOPMENT.md`](DEVELOPMENT.md); layer rules: [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Upgrade notes

### From v4.x to v5.0.0

On Linux, launchers can now provision private Git state for cage sessions. [Host Git isolation](cage/host-git.md) covers setup and recovery.

- **Breaking: Node.js `^24.15.0 || >=26`.** `engines.node` in `@jeger-ai/opengantry`, `@jeger-ai/opengantry-verify` and `@jeger-ai/opengantry-cage` was `>=24`. Node 24.0 to 24.14 and Node 25 are no longer supported. Check with `node -v` and move to the latest 24.x or to 26 before you upgrade. Under `engine-strict` an install on an older Node fails; otherwise npm prints `EBADENGINE`.
- **sigstore 5.** sigstore 5 and cacache 21 need that floor, which is why 4.x stayed on sigstore 4 (MSN-0352). sigstore 5 brings glob 14 through cacache 21 and clears GHSA-qxr8-q827-836c and GHSA-3g3m-2fjr-6pw4. These advisories could not be reached in 4.x: cacache calls glob only in `rm.all` and `verify`, and sigstore calls neither. Keyless signing keeps the same interface ([ADR-0055](../.gitagent/out-of-scope/ADR-0055-keyless-verify-signatures.md)).
- `@types/node` stays on 24, the lowest supported major.
- **Breaking: three authority inputs moved (MSN-0381, issue #356).** A process running as your user could read or rewrite three inputs that decide what is allowed. They moved; without a proven sandbox that denies the new locations, a process of the same user can still reach them:
  - **MCP draft token.** The HMAC key and replay ledger now live in `~/.opengantry/draft-token.json` (`GANTRY_STATE_DIR` to move the directory; it must be absolute and outside the repository). Delete `.gitagent/foreman/DRAFT_TOKEN.key` and `.gitagent/history/.draft-token-replay.json`: while the old key exists, `gxt_draft_legislation` and `gxt_execute_legislation` refuse with `TOKEN_LEGACY_KEY`, and drafts it signed are never accepted. Re-run `gantry cage policy` and merge the fragment, which now denies `~/.opengantry` (and the `GANTRY_STATE_DIR` set when you run it, each also at its physical path when it is reached through a link). A lock left by a crashed process is never taken over: `TOKEN_STATE_LOCKED` names it; delete it only when no gantry process runs.
  - **Break-glass.** `BYPASS.sha256` is read from the base commit: the merge-base of `HEAD` with `origin/HEAD`. With any remote configured, `origin/HEAD` is required (missing: `BYPASS_BASE_UNKNOWN`, run `git fetch && git remote set-head origin --auto`); `origin/main` and local branches never stand in for it. Only a repository with no remote at all uses local `main` or `master`. A default branch that shares no history with `HEAD` refuses. Commit the anchor to the default branch; a working-tree or branch-only anchor no longer authorizes, and no base or no anchor refuses.
  - **Hooks.** `.githooks/*` run an installed `gantry` on `PATH` outside the repository, never `dist/` or `node_modules/.bin`, and refuse unless that `gantry` reports the major `SUBSTRATE.version.json` pins and at least the pinned version; the shim checks this before it runs the binary, so one global install serves repositories that pin different versions of one major. `gantry upgrade apply` updates the hook files. Install a matching version globally (`npm install -g @jeger-ai/opengantry@<version>`). The pre-push hook no longer runs `scripts/check-changed-code.sh` (checkout code); CI still does.
- **Dependency admission in `gantry verify --contract` (issue #355 slice 3, [ADR-0062](../.gitagent/out-of-scope/ADR-0062-dependency-admission.md)).** A contract without a `dependencies` section is unaffected, and its result stays `opengantry.verify-result.v1` byte for byte. With the section in the base `verify.yaml`:
  - Every run judges the npm dependency files the change touched, with every authority input read from the base commit. The result becomes `opengantry.verify-result.v2` with a mandatory `dependencies` section (`opengantry.verify-dependencies.v1`; zod schema `verifyDependenciesSchema` in `packages/core/src/schemas`). `--sign` and `--sign keyless` cover it.
  - **Readers:** a tool that accepts only `opengantry.verify-result.v1` refuses a v2 result; that is the intent (DEP06). Accept v2 only if you judge `dependencies`. `--check-result` refuses a v1 result for a contract with a policy, and a v1 result that carries the section.
  - **Also held:** any added, changed or removed `.npmrc` (`npm_config_changed`: the candidate's npm configuration is never authority), case variants of dependency file names, and an edited `file:` folder whose lockfile did not change (judged by the folder's new content digest).
  - **Symlinks and unparseable lockfiles (MSN-0388).** A lockfile, `package.json` or `.npmrc` that is a symlink at base or head holds (`dependency_file_symlink`), and a `file:` folder with a symlink in it has no content digest, so it holds whenever anything changed. A lockfile the change did not touch whose head graph does not parse (an unknown field, limits a task contract tightened) holds (`graph_hold`) instead of being skipped. A repository with such files holds on every change under `enforce` until they are regular files. A `file:` folder that is, lies under or contains a submodule is judged the same way, so a submodule bump alone no longer passes, and a tree listing that fails is an error (`GXT_VERIFY_GIT_FAILED`), not an empty list.
  - **`mode: enforce`** fails the run on a hold or fail; **`mode: audit`** reports and labels it. Either way `enforcement` is `audit`: this check cannot prevent install scripts that already ran.
  - **Task contracts:** a task contract (gate.json, a handover `verify.yaml`) whose own `dependencies` section has no base section to tighten is refused (`GXT_VERIFY_CONTRACT_INVALID`); before, it was used unmerged when the base had no `verify.yaml`.
- **Breaking: launchers, break-glass notes and linked home paths (MSN-0385, issue #356).**
  - **Launchers.** `scripts/mcp-launcher.sh` (the Cursor MCP server), the Cursor `sessionStart` hook and `scripts/gxt-runtime-env.sh` resolve `gantry` like the hooks: an installed `gantry` on `PATH` outside the repository that satisfies the `SUBSTRATE.version.json` pin, never `dist/` or `node_modules/.bin`. Without one, the MCP launcher and the runtime script refuse on stderr and the `sessionStart` hook gives the session the reason. `gantry upgrade apply` updates the three files. Install the pinned version globally. Developing OpenGantry itself, start Cursor with `GANTRY_MCP_LOCAL_BUILD=1` to serve the local build; the git hooks ignore it (theirs stays `GANTRY_HOOK_LOCAL_BUILD`, never in Cursor's environment). Every launcher and git hook shim also runs that `gantry` with a `PATH` cut down to absolute entries outside the repository without any `node_modules/.bin`, so `#!/usr/bin/env node` and `git` never pick a `node` or `git` from the checkout (as under `npm run`); without `node` outside the repository they refuse. They start on `#!/bin/bash` instead of `#!/usr/bin/env bash`, so a `bash` in `node_modules/.bin` never runs them; a system without `/bin/bash` cannot start them. `scripts/gxt-runtime-env.sh` and the `sessionStart` hook find the repository from their own location, not the working directory. The resolver cannot protect the shims and launchers themselves: a process that can write in the repository can edit them or change `core.hooksPath`. A directory link in the repository pointing elsewhere no longer makes a `PATH` entry count as outside. Sourcing `scripts/gxt-runtime-env.sh` no longer turns on `set -euo pipefail` in your shell, no longer changes its directory or `PATH`, leaves no helper functions or variables behind, and it refuses shells other than bash.
  - **Break-glass notes.** CI (`gantry ci msn-range`) counts a `gxt-bypass` note only when it is version 2, names the noted commit, and is SSH-signed (namespace `opengantry-break-glass`) by a key that `.gitagent/foreman/PLANNER.signing.pub` on the pull request's base lists for the note's signer. CI holds no secret, so before this any well-formed note passed. The note is attribution and an audit trail, not a boundary: an `[MSN-NNNN]` subject needs no note, and the workflow runs from the pull request head, so protect the default branch and require review of workflow changes. `gantry verify --break-glass` still needs `GANTRY_BYPASS_SECRET`, and now also git's SSH signing key (`gpg.format ssh`, `user.signingkey`, ed25519); without one it refuses with `BYPASS_SIGNING_UNAVAILABLE`. **Migration:** version 1 notes, the unsigned ones every earlier version wrote, no longer count, and CI names the reason. List each person who may break the glass in `PLANNER.signing.pub` on the default branch, then re-run `gantry verify --break-glass` on any commit whose old note a pending pull request relies on and push `refs/notes/gxt-bypass` again. Merged history is not re-checked.
  - **Cursor `beforeShellExecution` hook (MSN-0390).** `.cursor/hooks/gxt-before-shell.sh`, which Cursor runs before every agent shell command, gets the same treatment as the launchers: it starts on `#!/bin/bash`, treats its own repository and the `CURSOR_PROJECT_DIR` Cursor names as inside (it no longer reads `CLAUDE_PROJECT_DIR`), cuts `PATH` down the same way before any lookup, and runs `node` only from outside both, so a `bash` or `node` in `node_modules/.bin` never runs there. Its answers to Cursor are unchanged. Without `node` outside the repository, or when a tool it runs fails, it answers `ask` with the reason instead of checking the command. `gantry upgrade apply` updates the file.
  - **Admission request schema (MSN-0390).** `remoteUrl` in `schemas/admission/admission-request.v1.schema.json` and its zod schema no longer accepts control characters (U+0000–001F, U+007F–009F) in the path; before, only whitespace was refused there.
  - **Cage policy.** `gantry cage policy` also denies each home-directory secret (`~/.ssh`, `~/.aws`, the credentials list) at its physical path when `HOME` or the entry is a link (stow, a linked home). Re-run it and merge the fragment; nothing changes when nothing is linked.
- **`gantry npm ci` (issue #355 slice 4, [ADR-0062](../.gitagent/out-of-scope/ADR-0062-dependency-admission.md) decision 5).** A new subcommand; nothing existing changes. In a repository whose base `verify.yaml` has a `dependencies` policy, `gantry npm ci --base <ref>` replaces `npm ci`:
  - The head lockfile must pass admission (the verify reader, every authority input from the base commit) before any network access, also under `mode: audit`; a project without `package.json` refuses. npm is the one beside the running node (never one from `node_modules/.bin` or the repository, never run by a node inside the repository) and must be exactly the policy's `npm_version`, bundling a node-tar the tar reader was checked against (`npm_tar_unverified` otherwise; 7.5.22 for now).
  - gantry fetches every tarball itself (https, no URL credentials, redirects only under a policy registry base path, streamed to disk with a deadline), checks its `integrity`, then reads its `package.json` without running it, with a tar reader that refuses any archive npm's own `tar` could read differently: install scripts must match `hasInstallScript`; bundled dependencies and shrinkwraps refuse. Input digests are re-checked before materialization.
  - npm installs with `npm ci --offline --ignore-scripts` from an isolated cache seeded with the verified bytes, with fresh user and global config and a clean environment; the result must match the admitted graph before it replaces `node_modules`.
  - An approved install script refuses (`capability_unproven`): no confinement is proven. `--audit-unconfined-scripts` runs it unconfined and labels the receipt `enforcement: audit`. Root lifecycle scripts and non-registry sources (workspaces, `file:`, links) refuse.
  - `--json` prints the receipt `opengantry.dependency-install.v1` (zod schema `dependencyInstallSchema` in `packages/core/src/schemas`), with `prevention: false` and `direct_installers_blocked: false`: `npm install`, `yarn` or `pnpm` run directly are not blocked.
- **Operation admission broker (MSN-0386, issue #356 slice 3; experimental, hidden).** Nothing changes unless you run it, except one new warning on run-record verifies (below). Details: [`reference/admission-broker.md`](reference/admission-broker.md).
  - `gantry admission serve --harness <id> --contract-digest <sha256> [--policy <file>] [--socket <path>]` runs a broker on a Unix domain socket, as your user, outside the sandbox. It runs on Linux only and refuses elsewhere (`GXT_ADMISSION_BROKER_UNSUPPORTED`). `gantry admission stop` stops it.
  - It dispatches `workspace.write` (through a held parent directory) and `process.spawn` (an argv array, no shell, an environment allowlist). Every other family is `unsupported`. It confines nothing, and no capability cell is `prevention`.
  - **Do not allow `process.spawn` in the policy yet.** Policy rules cannot name an executable or argv, so allowing the family allows any executable under any `argv[0]`.
  - Its journal is `<git dir>/opengantry/admission/journal.jsonl`: hash-chained, written under a lock with no stale takeover, fsynced before every effect, and capped at 32 MiB, at which point new dispatches are refused. Refusal receipts have a separate 8 MiB budget; once it is spent, new requests get `denial_budget_exhausted` and are not journaled, while authorized dispatches complete. The denial-budget lockout is permanent; recovery means moving the journal aside, which breaks local anchors to it. Malformed socket input and connections over the cap of 64 are counted in `input-summary.jsonl` (one line per minute at most), not journaled; a message is the first line of a connection, due within 10 s of connecting. Its instance lock and `broker.json` live in `~/.opengantry/admission/<repo key>/`. The policy file must be a regular file of yours, not group or world writable, in a directory that is not either; this is checked at start and at every re-read, and a policy that fails later decides nothing. A broker that crashed leaves both its lock and its socket; delete them only when no broker runs (`GXT_ADMISSION_BROKER_LOCKED`).
  - **Run record:** where a journal, an admission dir or a broker's state dir exists, `gantry verify --record` adds an `admission_journal` anchor (path, count and head digest), and refuses to write over a journal that does not verify (`GXT_ADMISSION_JOURNAL_INVALID`). `gantry verify` then fails with `GXT_RUN_RECORD_MISMATCH` if the journal is missing, cut, rewritten or unreadable, or if the record has no anchor there. Where the whole admission dir is absent (a CI clone), it checks the anchor's format and passes with the warning `admission_journal: not verified here`, never as verified. The field is additive, and older `gantry` versions ignore it.
  - **New warning:** every passing verify of a run record without an `admission_journal` anchor, on a host with no admission state for the repository (every CI clone, every repository that never ran the broker), now shows `admission_journal: not verified here (the run record has no admission journal anchor, …)` in its output and in `git_proof_warnings` of `--json`. Exit codes do not change.
  - **`gantry cage policy`** also denies read and write of `.git/opengantry`, and of a linked worktree's journal dir by its absolute path. Re-run it and merge the fragment.
- **Sandbox canaries (MSN-0391, issue #356 slice 4; experimental, hidden).** Details: [`guides/admission-probe.md`](guides/admission-probe.md).
  - **`gantry cage policy`** sets `sandbox.failIfUnavailable: true`. Claude Code otherwise runs commands unsandboxed when its sandbox cannot start, whatever `allowUnsandboxedCommands` says. With it, Claude Code refuses to start on a host where the sandbox cannot run (missing `bwrap` or `socat`, Ubuntu's user-namespace restriction). Re-run it and merge the fragment, or remove the key if you accept the unsandboxed fallback.
  - **`gantry doctor`** warns about each missing sandbox prerequisite (bwrap, socat, a user namespace with capabilities inside bwrap), only where Claude settings enable the sandbox: the repository's `.claude/settings.json` or `settings.local.json`, `~/.claude/settings.json`, or `/etc/claude-code/managed-settings.json`. It is a warning, never a fail.
  - **`gantry admission probe [--runtime <srt>] [--diagnostic] [--json]`** runs 34 canaries through `@anthropic-ai/sandbox-runtime`, which you supply, with the generated policy. It prints each result, a verdict per family, the broker verdict and the capability cells. It refuses (`GXT_ADMISSION_PROBE_UNAVAILABLE`) where the prerequisite is missing, and refuses a runtime that is not that package (`GXT_ADMISSION_PROBE_RUNTIME`). `gantry admission capabilities --probe` prints the matrix with this host's result; without `--probe` it prints the static matrix, as before.
  - **Result on Ubuntu 26.04 (2026-11-17): no cell is `prevention`.**
    - With its seccomp helper, the runtime does not start: the stock AppArmor `unpriv_bwrap` profile refuses the helper's nested user namespace.
    - Without the helper (`--diagnostic`), every direct and path-trick read or write of the denied paths is blocked, and so is loopback TCP, direct and through the authenticated proxy. A same-user Unix socket and `systemd-run --user` over the session bus escape the sandbox. Tokens in the launch environment pass through. An inherited fd is untested: `srt` passes only stdio into the sandbox.
    - The admission broker's socket is reachable only without the helper; its state stays protected.
  - **Capability schema:** canary evidence gains optional `runtimeDigest`, `host` (kernel, AppArmor restriction, bwrap version) and `note` fields; `schemas/admission/admission-capabilities.v1.schema.json` is regenerated.
- **Sandbox probe re-run and two owner decisions (MSN-0395, issue #356; experimental, hidden).** Details: [`guides/admission-probe.md`](guides/admission-probe.md).
  - **`gantry cage policy --strict-network`** adds `sandbox.network.strictAllowlist: true`, so Claude Code refuses a host outside the allowlist instead of asking. Without the flag the output is byte-identical. Claude Code reads that key only from `~/.claude/settings.json`, managed settings or `--settings`, never from a repository's settings files; the command says so on stderr.
  - **`gantry admission probe --strict-network`** (and `capabilities --probe --strict-network`) probes that policy. `network.connect` can be `prevention` only so.
  - **The inherited-fd canary is a positive check.** It lists `/proc/self/fd` inside the sandbox: no fd above 2 is `blocked`, an fd above 2 outside its `out/` and temp dir is `effect`. Before, it was always `inconclusive` through `srt`. Probe digests change for every host.
  - **Result on Ubuntu 26.04 with the AppArmor prerequisite (2026-11-17):** `process.spawn` and `dependency.materialize` are `prevention`, and `network.connect` too under `--strict-network`. `artifact.read` is not (launch-environment tokens pass through). `workspace.write` is not: an inherited fd above 15 past a closed gap reaches the sandbox, because Node marks fds close-on-exec only up to the first gap above 15 (PR #379 review). The fd canary now plants fd 20 with 3–19 closed and counts any fd outside its `out/` and temp dir. Closing every fd above 2 in `gantry admission launch` is the follow-up.
  - **Network canaries (PR #379 review):** SOCKS5 through the proxy's port, `CONNECT` by hostname, an adjacent port next to an allowlisted one, UDP and `[::1]`, each judged by an outside listener. Proven rows state their conditions in `evidence.note`; the evidence `host` gains `nestedUserns` and the AppArmor bwrap profile state (`admission-capabilities.v1` schema, optional fields). The prerequisite (disable `bwrap-userns-restrict`, install an unconfined `bwrap` profile with `userns`) is documented with its undo and trade-off. The static capability matrix is unchanged: it cannot carry a host condition.
- **`gantry admission launch` closes inherited fds; `probe --via-launch` (MSN-0396, issue #356; experimental, hidden).**
  - `launch` starts the harness through `/bin/bash --posix`, which closes every fd above 2 and then execs it; argv, environment and stdio are unchanged. An fd the launcher inherited past a gap of closed fds no longer reaches the harness or its sandbox. A harness that is not found or not executable is refused before the trampoline runs, and the broker is stopped.
  - **`gantry admission probe --via-launch`** (and `capabilities --probe --via-launch`) starts the control and the inherited-fd canary through `launch`. `workspace.write` can be `prevention` only so, and its row says it requires the harness to be started via `gantry admission launch`. Without the flag the probe record is unchanged and the family stays not proven.
  - **Result on Ubuntu 26.04 with the AppArmor prerequisite (2026-11-17):** with `--via-launch` the canary saw fds 0–2 only, and `workspace.write` is `prevention`, next to `process.spawn` and `dependency.materialize` (and `network.connect` with `--strict-network`). `artifact.read` waits for PR #376.
  - **A harness started any other way still leaks** an fd past a gap into its sandbox. Details: [`guides/admission-probe.md`](guides/admission-probe.md#limits), [`reference/admission-broker.md`](reference/admission-broker.md).
- **Behavior change: a git read that fails is an error, not "no missions changed" (MSN-0389, MSN-0393, issues #355/#356).** `gantry verify --changed-missions`, `gantry mission changed` and `gantry ci msn-range` now exit with an error on a shallow clone that has no merge base with the base ref, and in a single-commit repository where the `HEAD~1` fallback does not exist. Before, they reported that no mission had changed and skipped verification. Fix it by fetching more history (`git fetch --deepen=<n>` or `git fetch --unshallow`), or check out with `fetch-depth: 0` in `actions/checkout`. `gantry deps check --since <ref>` likewise errors on a ref git cannot diff, where it reported 0 checks with status `ok`.
- **Admission relay (MSN-0394, issue #356; experimental, hidden).** The agent reaches the broker through gantry's MCP server, outside the sandbox, because every Unix socket stays blocked inside it. Details: [`reference/admission-broker.md`](reference/admission-broker.md).
  - `gantry admission launch [serve options] -- <harness…>` (`--host-config` included) starts a broker for one harness run, sets `GANTRY_BROKER_SOCKET`, stops the broker when the harness exits, and exits with its status (128+n after signal n). It passes SIGTERM and SIGHUP on; SIGINT already reaches the harness through the terminal, so `launch` does not repeat it.
  - New MCP tool `gxt_admission_request`: one broker message in, the broker's answer out; `unavailable` without a broker, or when the socket is not the one the repository's `broker.json` records for a running broker. The answer is advisory; the broker's journal is the authority. Sandboxed shell commands have no broker access.
  - Why no fd into the sandbox: srt passes only stdio, and Node harnesses mark inherited fds close-on-exec (corrected by MSN-0395: only up to the first closed fd above 15, so an fd past such a gap does reach the sandbox). Host canaries record both, and that srt's Unix-socket filter makes the socket path unreachable. The full-srt canary skips until the AppArmor profile is installed. No cell changes.
- **Admission host brokers (MSN-0392, issue #356, ADR-0063 Q7; experimental, hidden).** Nothing changes unless you pass `--host-config <file>` (`opengantry.admission-host.v1`) to `gantry admission serve` or `gantry admission launch`. Setup: [`reference/admission-host-brokers.md`](reference/admission-host-brokers.md).
  - `git.publish` pushes one commit to a non-default, unprotected branch of the configured repository: `--force-with-lease`, a clean git environment, a broker-private repository, and the ref read back afterwards. The private repository holds a copy of the work tree's object files, never alternates, and the commit's whole history must be in that copy. An object file with a second hard link refuses (run `git repack -a -d` after `git clone --local`). Git never runs inside the candidate's repository, and `serve` resolves the git dir without it, refusing a `.git` file that names another repository or its worktree entry. `delivery.mutate` creates one pull request; an existing open one for the same head and base counts as success, flagged when its title or body differ.
  - The token is a GitHub App installation token held in broker memory: `contents` and `pull_requests` write, one repository. The App key must be under `~/.opengantry/admission/` with mode 0600 or 0400. OIDC refuses as not implemented.
  - An ambiguous outcome is `unknown`. The new `reconcile` message settles it by a read, never a second push or POST. A push is `failed` only when git's porcelain output refuses the ref; any other failure stays `unknown`. A pull request merged or closed before reconciliation still counts, if it is newer than every one seen before the create. A create whose POST may still land stays `unknown` (no new attempt) until the pull request appears. A push stays `unknown` unless the ref holds its commit: a ref back at the old value may have been reset after the push landed. The pull-request floor lives in the hash-chained journal (the dispatch intent's evidence digest, fsynced before the POST), not in the state dir, so a restart with another `GANTRY_STATE_DIR` changes no verdict. A create that may have been sent is never `reconciled-failed` by a read. An API answer over 4 MiB is abandoned while it is read (`unknown` for the create). Stopping the broker waits for a dispatch in flight before the instance lock is released. An operator who knows the effect didn't happen runs `gantry admission reconcile --assume-failed <operation>/<attempt>` with no broker running; it is journaled as an operator assertion, not evidence, and it prints a warning: a wrong assertion can lead to a second pull request, so assert only with independent evidence.
  - GitHub Enterprise Server: set `apiBaseUrl` to `https://HOST/api/v3`.
  - **`gantry cage policy`** now emits `sandbox.credentials.envVars` deny entries for `GH_TOKEN`, `GITHUB_TOKEN` and the enterprise variants. They cover sandboxed Bash commands only. Re-run it and merge the fragment.
  - No capability cell changes. Tested offline only; live proof against GitHub needs the owner's GitHub App.

### From v4.0.2 (criticality verdict, neutral gate schema — v4.0.3)

```bash
npm install -g @jeger-ai/opengantry@4.0.3
```

Existing contracts keep verifying. One result value changes: a tool that reads `contract.format` from a JSON gate contract's result and matches `commitly_gate` must also accept `gate` (below).

- **`criticality` in the verify contract** ([ADR-0051](../.gitagent/out-of-scope/ADR-0051-standalone-verify-contract.md) decisions 13-16): path classes with `never_auto`, a `default_level`, and an optional classifier command. Every `opengantry.verify-result.v1` result now carries `criticality` (`unknown`, source `none`, when the contract has no section). The verdict is covered by `--sign`, and never fails a run.
  - `gantry verify --contract --criticality-record <dir>` (and `gantry-verify --criticality-record`) writes the classifier's input, including the diff, and the verdict, for training. It writes nothing when the contract has no `criticality` section, and the record's `input` is `null` when no classifier ran (none configured, or a `never_auto` class decided).
  - The library exports the `CriticalityLevel` and `CriticalityVerdict` types.
- **The JSON gate contract's schema is `opengantry.gate.v1`.** `gantry verify --contract gate.json` and `@jeger-ai/opengantry-verify` read it. The old name `commitly.gate.v1` is still read as an alias ([ADR-0051](../.gitagent/out-of-scope/ADR-0051-standalone-verify-contract.md) decision 2), so tools that write it need no change now; switch them to the new name before the next major version.
  - **Behaviour change:** the contract result's `contract.format` for a JSON gate contract is `gate` (was `commitly_gate`) for either schema name, including contracts that still say `commitly.gate.v1`. `commitly_gate` is no longer produced; shipped in the 4.0.3 patch by operator decision.
  - The library exports `GATE_SCHEMA`. `COMMITLY_GATE_SCHEMA` and `parseCommitlyGate` are deprecated aliases and go in the next major version.

### From v4.0.1 (agent sandbox settings — v4.0.2)

```bash
npm install -g @jeger-ai/opengantry@4.0.2
```

Nothing to migrate. One new command, in the full package only:

- **`gantry cage policy --agent claude-code`** prints a Claude Code settings fragment built from the cage's rules ([ADR-0060](../.gitagent/out-of-scope/ADR-0060-agent-sandbox-policy.md)): `permissions.deny` `Edit(...)` rules for the restore-rule paths and `Read(...)` rules for the read guard's secrets, and `sandbox` with `enabled: true`, `allowUnsandboxedCommands: false`, `filesystem.denyWrite`, `filesystem.denyRead` and `credentials.files` (`mode: deny`) for the home credential stores. `--contract <verify.yaml>` adds the contract's `forbidden_paths` to the write denies.
  - It never edits `.claude/settings.json`; review the fragment and merge it yourself. `--out <file>` writes it and refuses to replace a file without `--force`. Inside a cage session it is refused.
  - The fragment is stricter than the cage for `.env.example` (a deny rule cannot be narrowed by an allow rule), has no `sandbox.network` key and does not narrow writes to a task's allowed paths. Details: [Agent sandbox settings](cage/policy.md).
  - New error codes: `GXT_CAGE_POLICY_INVALID` (unknown or missing `--agent`, or a contract path that is not root-relative), `GXT_CAGE_POLICY_EXISTS`, `GXT_CAGE_POLICY_IN_SESSION`.

### From v4.0.0 (adopter CI template — v4.0.1)

```bash
npm install -g @jeger-ai/opengantry@4.0.1   # puts gantry on PATH for the next two commands
gantry upgrade plan --stage   # stages the fixed workflow, writes .gitagent/missions/<MSN>.upgrade-v4.0.1.yaml; the Planner commits it
gantry upgrade apply --mission .gitagent/missions/<MSN>.upgrade-v4.0.1.yaml   # replaces .github/workflows/gxt-validate.yml
```

- **Shipped CI workflow fixed:** the `.github/workflows/gxt-validate.yml` that `gantry init --ci` and `gantry upgrade` installed was a copy of this repository's own CI. It ran `npm ci`, `npm run build`, `dist/cli/...` and repository scripts that do not exist in your repository, so its jobs failed. The workflow now installs `@jeger-ai/opengantry@^4` from npm and runs only `gantry` commands.
- **Same job names:** `pr_governance`, `manifest` (`gantry doctor`, plus `gantry perimeter --ci` on pull requests), `msn_commits` (`gantry ci msn-range`) and `mission_verify` (`gantry ci verify-missions`). Branch protection rules on those checks keep working. The repository-only jobs `code_quality` and `npm_pack` are gone; drop them from your required checks if you added them.
- **If `gantry upgrade` already installed the broken workflow:** `gantry upgrade plan --stage` and `gantry upgrade apply` replace it with the fixed one.
- **Mission gates** run with only Node and `gantry` installed. A gate that needs your project's dependencies installs them itself.
- **`gxt-attest-ingest.yml`:** the template you copy from `templates/.github/workflows/` had the same problem and is fixed the same way. Copy it again if you use it.

### From v3.9.0 (packages, structural law, one name, YAML law files — v4.0.0)

v4.0.0 is the major ADR-0052 announced: the same commands, flags, exit codes and `GXT_*` error codes, with the renames and removals 3.x had deprecated done, and the law files humans write in YAML. Upgrade:

```bash
npm install @jeger-ai/opengantry@4          # or: npm install -g @jeger-ai/opengantry@4
gantry upgrade plan && gantry upgrade apply --mission .gitagent/missions/<MSN>.upgrade-v4.0.0.yaml   # managed assets: hook shims, CI workflow, runtime scripts
gantry migrate manifest && gantry migrate config && gantry migrate architecture-pointer && gantry migrate policy-pointer   # each only if the 3.x JSON file exists
gantry doctor
```

- **Breaking: commands removed for simplicity ([ADR-0061](../.gitagent/out-of-scope/ADR-0061-simplify-before-4-0.md)).** Each now fails with "unknown command"; use the replacement:
  - `gantry report` (the localhost dashboard) and `gantry metrics`: `gantry doctor --json`, SARIF and your CI logs.
  - `gantry audit-rigor`: no replacement.
  - `gantry scan`, MCP `gxt_scan`, the KPI gate and the rubric judges: run the producer as the mission's `gate_command` or a verify contract check that exits non-zero on failure (`examples/performance-judge/`). A mission that still declares `kpi_gate`, `llm_verifiers` or `aggregators`, or an org policy with `producers` or `kpi_thresholds`, is refused (`GXT_MISSION_SCHEMA_INVALID`, `GXT_POLICY_DRIFT`) rather than run without them. Verify has no `kpi` phase; `--ci` now covers the perimeter and interrogation only. The `GXT_KPI_*` codes, `.gitagent/kpi/`, `KPI-REPORT.schema.yaml` and the `ARCHITECTURE_RUBRIC`/`PERFORMANCE*` planner templates are gone; delete your copies.
  - `gantry context-feed`: read `findings[]` from `gantry verify --json`; the compact copy in `.gitagent/tmp/NEXT_REMEDIATION.json` is still written and cleared by a passing verify.
  - `gantry init --discover`, `gantry blueprint` and `gantry domains`: write `TARGET_ARCHITECTURE.yaml` by hand (`domain: code|content` still picks the files and rules) and run `gantry arch check`. `.gitagent/discovery-proposal.json`, `.gitagent/verification_plan.json` and the doctor's blueprint drift check are gone.
  - `gantry register`: edit `MANIFEST.yaml` (Rule 4.4). `gantry check-imports` and its `verify --fix` repair (`GXT_BANNED_IMPORT_DETECTED`): declare `banned_imports` in the mission contract or org policy and run `gantry verify --contract`.
  - `gantry triage`, `gantry start` and MCP `gxt_start_orchestration`: `gantry legislate` (it still triages and refuses escalated intents) or the Mission Architect handoff (`gxt_draft_legislation` → `gxt_execute_legislation`).
  - `gantry status` and `gantry check`: `gantry doctor` (it runs the manifest and skills sync; `--json` for scripts). `gantry mission pin` with no argument prints the pinned mission.
  - `gantry onboarding`: `gantry init --tutorial` (the guided first mission graph), then `gantry doctor`.
  - `gantry mission snapshot`: no replacement; `.gitagent/history/start-state.*.json` files are inert, delete them.
  - `gantry tmvc guard`: the pre-commit hook (`gantry hook pre-commit`) runs the same TMVC guard on the staged index; `gantry hook install` or `GANTRY_TMVC_GUARD_STRICT=1` makes it block.
  - `gantry perimeter check`: `gantry arch check` (same engine). `gantry perimeter --ci` is unchanged.
  - `gantry verify --fix` no longer edits source: the import-layer quarantine repair is gone, so `--fix` prints the failed phase's fix hints and prompts (`--non-interactive` prints them all). The import scanner no longer skips regions that repair marked; remove leftover quarantine blocks by hand.
  - `gantry doctor` keeps only the checks that decide whether a repository works: manifest presence and the manifest and skills sync, the Planner identity, `core.hooksPath`, the substrate version, the law-file form and the `receipt_signature` notice. The advisory checks are gone (typed-adapter preflight, detected agent wiring, org policy, the architecture pointer, `EXECUTOR_LOG.md` integrity, `TARGET_ARCHITECTURE.yaml`, flight telemetry, the ledger line, break-glass provisioning, the Planner signature and allowed signers, `example.verify.yaml` and the last agent error), and so are `doctor --policy`, its `[policy]` argument, `--gate-adapter`, `--adapter-baseline` and the MCP `gxt_doctor` inputs `policy_path`, `gate_adapter` and `adapter_baseline`. The org bundle's `expected_digests` is checked by `gantry policy diff`, which fails with `GXT_POLICY_DRIFT` on a mismatch.
  - Merged, the old spellings are gone: `gantry pin`/`unpin` are `gantry mission pin`/`unpin`; `gantry hooks install|status|uninstall` are `gantry hook install|status|uninstall`; `gantry release check --tag <t>` is `gantry deps check --since <t>`; the `gantry deps status` alias is gone (`deps check`). Run `gantry upgrade apply` so the shipped Cursor session hook, runtime helper and CI workflow use the new names.
  - MCP keeps 12 tools: the legislation handoff, verify, the runtime and doctor. `gxt_attest`, `gxt_policy_status`, `gxt_ledger_verify`, `gxt_deps_check`, `gxt_upgrade_plan` and `gxt_upgrade_apply` are gone; their CLI commands stay. `gantry upgrade plan --stage` now stages the managed files and drafts the upgrade mission, which only `gxt_upgrade_plan` could do before.
  - The verify-run ring `.gitagent/tmp/verify-runs/` is no longer written (nothing read it); delete the directory. JUnit phase cases are unchanged.
  - Mission verify output is digest-only (`envelope_schema_version` 4): the `--json` payload, MCP `gxt_verify`, `--json-out` and `NEXT_REMEDIATION.json` drop the gate's `stdout` text and each finding's `evidence`, `fingerprint` and `semantic_fingerprint`. Agents read the gate's output from the log at `gate_log_path` when it is present, and the code at a finding's `offending_file` and `line` when a structured producer reported them. The `findings_digest` field and the `GXT_FINDINGS_RECURRED` code stay, but the digest is now computed from each finding's failed gate, file and rule: a digest ring written before the upgrade can miss one recurrence, and two violations of the same rule in the same file now count as the same finding.
  - The verdict token kernel exports (`mintVerdictToken`, `verifyVerdictToken`, `buildVerdictExpectedClaims`, `verdictClaimsFor`, `clearVerdictClaimsCache`, `PASSED_FINDINGS_DIGEST`, `VERDICT_TOKEN_SCHEMA_VERSION`, `resolveOrgId`), the pepper keyring (`GANTRY_PEPPER_KEYRING`) and `gantry receipt principal-hmac` are removed: pin 3.x, or read the committed run record (`.gitagent/runs/<MSN>.json`) instead.
  - `gantry attest` (and `attest --export`), `gantry receipt list` and `gantry receipt show`: `gantry verify --record`, the committed run record and `gantry ledger list`. The run record is the only receipt; local receipts under `.gitagent/history/receipts/` are inert, delete them. `gantry ledger export --format soc2-pack` copies `.gitagent/runs/*.json` instead of receipts.
  - `gantry verify --receipt` and `--sign-receipt` are gone. A passing verify's ledger `receipt` entry is `{verify_status: passed, run_record_sha256}` (the digest only when the mission has a run record); pre-4.0 entries keep verifying.
  - The `receipt_signature` tier is gone: an org policy whose `config_floor` sets it is refused (`GXT_POLICY_DRIFT`), and `.gitagent/config.yaml` or `config.json` that sets it gets a doctor warning and is otherwise ignored.
  - `gantry verify --export` writes envelope 2.0 (`envelope_schema_version` `2.0.0`): `payload_b64` is the canonical run record, and `--sign` adds a signature with the git signing key. It needs a passing verify judged by a run record; a failed verify, `--break-glass` or a mission without a record writes no envelope and exits with an error. `gantry ledger append --from-envelope` reads 2.0 only and appends a `receipt` entry with the record's `msn_id` and `run_record_sha256`.
  - The org pepper is gone: `GANTRY_ORG_ID`, `GANTRY_ORG_PEPPER`, `GANTRY_ORG_PEPPER_VERSION`, `GANTRY_REPO_ID` and `.gitagent/foreman/ORG.export.local` are no longer read; delete the local file and the CI variables. Ledger entries carry no `org_id` or `repository_hash`, and `gantry ledger append` works without org configuration; pre-4.0 entries that carry them keep verifying.
  - Cross-repository dependencies: same-org proof is fetch access to the dependency's ledger ref (it shows read access to that ref, not organization membership or authorization), and `require.signed` needs a good signature from a key you trust (`git log --format=%G?` is `G`) on the receipt entry's commit in your repository (unsigned or unverifiable is `GXT_DEPENDENCY_UNSIGNED`). `GXT_DEPENDENCY_ORG_MISMATCH` is gone, and a mission whose `depends_on[]` still declares `expected_repository_hash` is refused (`GXT_MISSION_SCHEMA_INVALID`).
  - The ledger no longer writes `dependency_check` entries; dependency results stay in the verify and `gantry deps check` output.
  - `gantry events push` and the event spool (`.gitagent/history/events/`): no replacement; delete the directory. The `gxt-attest-ingest.yml` workflow drops its events and attribution steps and exports the envelope when `PLANE_INGEST_URL` and `PLANE_INGEST_TOKEN` are set; run `gantry upgrade apply`.
- **Breaking: one env prefix.** Every `GXT_*` environment variable is `GANTRY_*`: `GANTRY_REPO_ROOT`, `GANTRY_MISSION_FILE`, `GANTRY_MSN_ID`, `GANTRY_SKILL_KEY`, `GANTRY_FORBIDDEN_ZONES`, `GANTRY_ALLOWED_IMPORTS`, `GANTRY_BANNED_IMPORTS`, `GANTRY_EXECUTOR_LOG`, `GANTRY_LAST_ERROR_FILE`, `GANTRY_AUDIENCE`, `GANTRY_BYPASS_SECRET`, `GANTRY_MSN_SCAN_DEPTH`, `GANTRY_REQUIRE_INTERROGATION`, `GANTRY_TMVC_GUARD_STRICT`; `GXT_TMVC_ROOTS` is `GANTRY_TMVC_ROOTS_ABSOLUTE` (`GANTRY_TMVC_ROOTS` keeps its repository-relative list). Scripts and agent instructions that read the old names must switch; `gantry runtime env` prints the new ones and the shipped Cursor session hook reads them. `GXT_*` error codes are unchanged.
- **Breaking: the `gapman` names are gone.** The `gapman` bin, the `GAPMAN_*` env and `gapman.*` git config fallbacks and the `gapman` skill-key alias are removed (`gantry`, `GANTRY_*`, `gantry.*`); the strict pre-commit flag is `gantry.tmvcGuardStrict`. The deprecated kernel export `verifyMissionAsync` is removed; `verifyMission` stays.
- **Breaking: law files are YAML.** `gantry init` writes `.gitagent/foreman/MANIFEST.yaml`, `.gitagent/config.yaml`, `.gitagent/ARCHITECTURE.pointer.yaml` and `.gitagent/foreman/POLICY.pointer.yaml`. The 3.x JSON files are still read when the YAML form is absent; both present and different fails closed (`GXT_LAW_FILE_AMBIGUOUS`). `gantry migrate <file>` converts each deterministically and `gantry doctor` warns until it is done.
- **Breaking: parked features.** The contract drift index, the contract preflight (`gantry contract preflight`, `gxt_preflight_contract`), defensive profiles and virtual capture left the CLI (ADR-0052 A10); their code lives under `examples/`. `better-sqlite3`, `sqlite-vec`, `ajv` and `ajv-formats` are no longer dependencies.
- **Evidence is machine-written.** A mission with no `trace_rows` is verified by its run record `.gitagent/runs/<MSN>.json`, written by `gantry verify --record` on the tree it ran on (RULES §3). Trace rows in mission YAML are still read for 3.x missions and no longer required.
- **Hooks and scripts call the CLI.** Each git hook is one line, `gantry hook <name>`; the pre-push hook reads the ref lines git passes. `scripts/validate-gxt.sh`, `verify-pr-missions.sh`, `gxt-manifest-lib.mjs`, `gxt-resolve-mission.sh`, `gxt-pin-mission.sh` and `gxt-cursor-env.sh` are gone; CI and the runtime helpers call `gantry ci …`, `gantry runtime env` and `gantry pin`. `gantry upgrade apply` installs the new shims.
- **Structure under law.** This repository (and any adopter who wants it) runs `gantry arch check` with `budget`, `owner`, `registry`, `dependency` and `duplicate` rules in `TARGET_ARCHITECTURE.yaml` 0.4.0, against a committed `ARCH_BASELINE.json` that only `--ratchet` moves; registries under `.gitagent/registry/` make a new error code, env name, subcommand, MCP tool or dependency a Planner edit.
- **Behaviour change: protected directories.** The cage, mission scope and `gantry verify --contract` judge paths with one rule table (`packages/core/src/path-law.ts`, [ADR-0053](../.gitagent/out-of-scope/ADR-0053-one-path-law.md)). Every cage pattern now also covers a directory: a directory named like a protected file (`.env/`, `x.pem/`) has its contents protected by that rule. Nothing else the cage protects, restores or reports changes.
- **Behaviour change: org perimeter.** The org policy's `manifest_constraints.perimeter_protected_add` is now applied as [ADR-0042](../.gitagent/out-of-scope/ADR-0042-org-policy-bundle.md) says. Those paths join the perimeter for `gantry perimeter` and for trusted automation's `bounded_content` rule. If the org policy cannot be read, `gantry perimeter --ci` fails with a violation that names `(org policy)` (locally it is an advisory) and trusted automation is not eligible. Trusted automation also uses the default protected paths when `MANIFEST` lists none. Repositories whose org floor does not set the field see no change.
- **Behaviour change: verify judges the mission's changed paths.** `gantry verify` now fails a mission whose commits touch a forbidden zone: the contract phase lists the paths changed from the Planner stamp to the head the evidence is bound to (the run record's head, or `HEAD` for `--record` and missions with trace rows) and fails `GXT_FORBIDDEN_ZONE` with one finding per path in a forbidden zone of the skill, the org floor or the contract. A path outside the effective roots is a warning in 4.0. The mission file, its run record and `EXECUTOR_LOG.md` are not judged; `.gitagent/` is never outside the roots. Missions without a contract are judged under the skill's roots and zones. Exit codes are unchanged.
- **Kernel:** `VerifyOptions` gains `warn?: (message: string) => void`, where verify sends its diagnostics. `verifyMission` keeps printing them to stderr; a direct caller of `buildVerifyResultPayload` that sets no `warn` no longer gets them on stderr.
- **Slim cage package:** `@jeger-ai/opengantry-cage` bundles the CLI's own cage entry. The bin, the files and the push guard are unchanged. In the full package, `gantry-cage cage-guard pre-push` now runs the push guard instead of caging a command named `cage-guard`.
- **This repository:** the source moved into the packages `verify` and `missions`, and `src/cli/lib/` is gone (`src/cli/output`, `mcp`, `doctor`, `report`, `init`, `flows`). The generated version file is `src/cli/version.gen.ts`. Adopters are unaffected: the published entry points are `.` and `./kernel` ([ADR-0054](../.gitagent/out-of-scope/ADR-0054-finish-the-package-graph.md)).
- **Path patterns:** every path pattern is read by one matcher.
  - **Fix:** a folder in `perimeter_protected` (such as `.gitagent/registry/`) now protects the files under it. Before, it protected nothing.
  - **Narrower:** `**/name` protects only files named exactly `name`. Before, it also matched any path ending in `name`, such as `x.gxt-skill.yaml`.
  - In verify contracts, `dir/**` no longer matches a file named `dir`.
- **Planner stamp:** the stamp is now the newest Planner-email `[MSN-…]` commit that modifies the mission file. A later Planner-email commit that leaves the mission file alone no longer displaces it (RULES §3, §6.1).
- **Config:** a `defensive_profile` block and a mission's `virtual_capture` field are ignored. `ledger.mode` is no longer inferred from a defensive preset, so set it explicitly if you relied on one.
- **Dependencies:**
  - `@modelcontextprotocol/sdk` needs at least 1.32.1. Versions up to 1.31.0 have four published advisories, one rated high.
  - The lockfile carries hono 4.13.13 for a moderate advisory.
  - `@clack/prompts` 1.8 (the interactive `gantry init` and `verify --fix` prompts) and zod 4.6.7.
  - For development: eslint 10.13, typescript-eslint 8.72 and `@types/node` 24.19.
  - The iii integration example's lockfile is refreshed: it pinned 3.8.3 and the vulnerable SDK.
- **`gantry arch check` resolves alias imports.** A `forbid_import_layer` rule now also fires for an import written through a `tsconfig.json` path or a `package.json` subpath import (`#core/…`, `#missions/…`); before, only relative specifiers were resolved, so the cross-package rules of this repository's own law could not fire. An alias no mapping names still counts as a bare package (layer `other`).
- **Domain code returns its warnings.** The `warn` callback and the `Diagnostics` sink that step 5 of ADR-0054 introduced are gone; what they carried is now data on the result: git-proof advisories in `warnings[]`, a ledger append as `{kind: appended|disabled|failed}`, the dependency check's ledger outcome beside its results, a missing init template on the plan, the lines a `.gitignore`/`.prettierignore` merge appended as `merged`, and the upgrade plan summary printed by the CLI from the result. Visible effects:
  - **Fix:** a git-proof advisory (an unsigned Planner stamp under the warn tier, an arch override) was printed twice by human `gantry verify`; it is printed once.
  - **Fix:** a failed ledger append of the dependency check during `gantry verify` was dropped; it is now reported with the run's other warnings.
  - `gantry upgrade --apply --json` and the MCP `gxt_upgrade_apply` result carry `warnings` and `merged`; `gantry upgrade --json` is unchanged (its stable payload projects fields by name).
  - Kernel: `VerifyOptions.warn` is gone; `verifyMission` and `buildVerifyResultPayload` return the warnings on the payload as before.
- **One scope law.** `packages/missions/src/scope-law.ts` builds the path law of a skill, an org floor and a mission contract once (`skillScopeLaw`, `missionScopeLaw`, `perimeterLaw`); the effective scope carries it as `law`, and the staged guard, the kernel scope check, the MCP write guard, the contract scan, `gantry perimeter` and trusted automation judge it instead of each building its own rule table. The perimeter is part of the mission law as planner rules with sources `manifest` and `org` (ADR-0053 decision 2). **Behaviour change (ADR-0053 decision 5):** a trusted-automation rule's `allowed_paths` now cover, so a directory entry allows the files under it; before, only a whole-path glob match did. Everything else is unchanged.
- **Cage rule table as data.** The built-in `lockfile` rule is one row whose effect is the dependency freeze (`report`, or `revert` under `dependencies: revert` / `--lock-deps`) instead of a second row added under a freeze; with that, core's `judgePath` decides ties by table order alone (the clause that preferred an overridden judgment existed for the duplicate row). A cage classification carries its `source`, so `cage check` and the config validation read it instead of recomputing it. The scope area no longer lists the git dir: rules come before areas, so `.git/config` is `git_control`'s whether or not a scope is set. Reports, modes, sources and exit codes are unchanged.
- **One reporter per verify run.** The verify command builds its reporter once (from `--json`, `--format`, `--audience`; an in-process caller without an audience inherits the command's) and every presenter, the pinned-mission banner, the `--record` line and the ledger warnings write through it; `Reporter.forVerify` no longer reads the process reporter. The `humanReport()` channel is gone (every caller sat behind a sink switch that had already chosen the human path). `Reporter.nextSteps` prints an audience's next-steps block once for verify and `gantry init`. `gantry upgrade` awaits its apply (the command returned before it finished, so the reporter reset underneath it) and writes JSON through the one serializer, as `gantry arch check --json` and `gantry planner show --json` now do. The slim cage bin registers only the guard subcommand in guard mode. No output change.
- **The two check scripts are law.** `scripts/check-lib-cycles.mjs` is the structural rule `kind: cycles` (schema 0.4.0): no runtime import cycle among the counted files, alias-aware, with `import type` and `export type … from` not counted as edges; one finding names each cycle's members. `scripts/check-import-layers.mjs` is gone; `gantry arch check --json <files>` is the import-layer gate (same `{ schema_version, ok, violations[] }` shape, the rule ids of `TARGET_ARCHITECTURE.yaml`), and `gantry verify --fix` repairs from it. A top-level `exclude` in `TARGET_ARCHITECTURE.yaml` names the files under the scan roots that no rule judges and no budget counts; the dogfood law excludes `**/tests/**` once instead of on every budget rule and every owner and registry rule's `applies_to`. The `dependency` rule now also judges the `scope` and `range` the registry records against the manifest.
- **The law files are read in one place.** `packages/git/src/repo-text.ts` holds `readLawFileAt`, `lawFileRelAt`, `writeLawFileYaml` and `repoAbs`; the per-file wrappers (`readManifestSource`, `manifestRelPath`, `manifestPath`, `readGxtConfigSource`, `readArchitecturePointerSource`, `architecturePointerPath`, `readPolicyPointerSource`, `policyPointerRel`, `policyPointerPath`) and core's JSON-only `parseGxtConfig` are gone. `gantry migrate <file>` reads the file as every reader does, so both forms present and different fail closed (`GXT_LAW_FILE_AMBIGUOUS`) instead of reporting `already_yaml`, and it validates a 3.x `config.json` (an object) and `POLICY.pointer.json` (the pointer shape) before writing the YAML form. `gantry policy pull` without a pointer names `POLICY.pointer.yaml`. The 3.x-form doctor warning lives with the other doctor checks.
- **The missions package names what it is.** `packages/missions/src/verify/verify-*.ts` is `mission-verify/*.ts` (no collision with `packages/verify`), `missions/` is `mission/`, `arch/cage/target-architecture.ts` is `arch/target-architecture.ts`, `mcp/mcp-write-guard.ts` is `substrate-write-guard.ts`, and `policy/policy-resolve.ts` folded its one function into `gxt-config.ts`; every `#missions/…` import follows. The domain's verify options are `VerifyEvaluation` (the fields it reads); the CLI's `VerifyOptions` (`src/cli/flows/verify-options.ts`, re-exported by the kernel) extends it with presentation and recording. `audience-output` lives in `src/cli/output`; `OutputAudience` with the tagged steps in `mission-verify/hints.ts`. 241 declarations no other file imports are no longer exported and 12 nobody used are deleted (missions exports 841 → 563); the package declares the dependencies it has (core, git, plane).
- **One command boundary.** `gantry upgrade --json` failures use the common envelope (`status`, `error_code`, `message`, `fix_hints`, `exit_code`) with the registered codes `GXT_UPGRADE_MISSION_REQUIRED`, `GXT_UPGRADE_INVALID_MISSION`, `GXT_UPGRADE_STAGING_MISSING`, `GXT_UPGRADE_STAGING_DRIFT`, `GXT_UPGRADE_HASH_MISMATCH` and `GXT_UPGRADE_EMPTY_MANIFEST` (they mapped to `GXT_VERIFY_FAILED` before; the exit code stays 2; the MCP `gxt_upgrade_*` error bodies are unchanged). `gantry ci`, `gantry hook`, `gantry perimeter` and `gantry arch` report a thrown failure the way every other command does (`[GXT_…] message` and a `Fix:` hint on stderr, the error's exit code). `gantry start` prints one next-steps heading (the audience's when `--audience` is set). `gantry init --tutorial` has one tutorial exit.
- **Delivery facts stay in the CLI.** The templates directory is resolved in `src/cli/init/templates-root.ts` and passed to the domain: `loadIntegrationCompat`, `inferInitProfileFromRepo`, `runUpgradePlan` and `runUpgradeApply` require `templatesRoot` (the MCP `gxt_upgrade_*` handlers pass it) instead of guessing it from their own location. The generated version file is `src/cli/version.gen.ts`: `runUpgradePlan` takes `packageName` and `buildVerifyExportDocument` takes the CLI version, so no package holds generated source and `tsc -b packages/core` builds from a clean checkout.
- **New: dependency bumps pass without a mission.** Trusted automation gains the structural kind `dependency_update` ([ADR-0057](../.gitagent/out-of-scope/ADR-0057-dependency-update-automation.md), #193). A bot listed in `allowed_actors` passes `gantry ci msn-range` and `verify-missions` with a change that only bumps npm dependencies:
  - in `package.json`, only version strings of dependencies it already declares;
  - in `package-lock.json` / `npm-shrinkwrap.json`, every new or changed install entry resolves to an allowed registry (`allowed_registries`, default `https://registry.npmjs.org/`) with an `integrity` hash; a local folder's entry (a `file:` dependency) may change but not appear;
  - `max_net_loc` (hard cap 200) does not count lockfile lines.

  A new dependency, a script change, a git or tarball URL or another registry fails as before. When no `trusted_automation` rule allows a change, the mission checks now list every rule's reason. `gantry init`'s `config.yaml` now has a `dependency-bumps` rule for Dependabot; add it to an existing config to get the same.
- **New, opt-in: read guard.** `gantry-cage read-guard` (also `gantry read-guard`) is an agent hook for Claude Code (`PreToolUse`) and Cursor (`beforeReadFile`, `beforeTabFileRead`, `beforeShellExecution`) that refuses tool calls reading `.env` files, `.git/config`, `.git-credentials`, private SSH keys and the credential stores under your home directory (`.ssh`, `.aws`, `.azure`, `.gnupg`, gcloud, `gh`, kube, docker, `.netrc`, `.npmrc`, `.pypirc`), so they stay out of the model's context. Register it in `.claude/settings.json` or `.cursor/hooks.json` ([Read guard](cage/read-guard.md), [ADR-0056](../.gitagent/out-of-scope/ADR-0056-agent-read-guard.md)). Shell commands are judged by their words, best effort. The cage's secrets rule and the guard share one list in `packages/core/src/secret-paths.ts`; the rule is unchanged.
- **Also new:** `gantry ci msn-range|verify-missions|trusted-automation|upgrade-tmp`, `gantry migrate …`, one reporter for human, `--json`, SARIF and JUnit output with `--audience` as a presenter parameter, zod schemas with the YAML JSON-Schema files generated from them, a conformance suite the published commands must pass byte for byte.
- **Unchanged:** the cage trust model and the diff check, the ledger, receipts, exit `3` and `4` for the cage, `verifyMission`.

#### Added after 3.9.0 and released in 4.0.0 (cage dependency freeze, standalone verify contract and cage scope mode)

- **New, opt-in:** `.cage.yaml` top-level `dependencies: revert`, or `--lock-deps` on `gantry cage -- <cmd>` / `gantry-cage`, `gantry cage watch` and `gantry cage check`, freezes dependencies. Lockfiles become restore-rule paths, and a new built-in `dependency_manifest` rule covers `package.json`, `pyproject.toml`, `Pipfile`, `requirements*.txt`, `Cargo.toml`, `go.mod`, `Gemfile` and `composer.json` at any depth, except under a `vendor/` directory (vendored install output). Without either, nothing changes: lockfiles are listed and kept, manifests are not protected (MSN-0275, [ADR-0048](../.gitagent/out-of-scope/ADR-0048-cage-trust-model.md) decision 9).
- **Only tightens:** `dependencies: report` is the default; `mode: report` on a frozen path is refused (`GXT_CAGE_CONFIG_INVALID`). `--allow-override <path>` still relaxes one frozen path for one session run, announced. `cage check` reads the setting from the base commit; `--lock-deps` adds to it.
- **Caps apply:** frozen lockfiles are snapshotted for restore, so a lockfile over `--max-file-bytes` (default 5 MiB) stops a frozen run with exit `2` (`GXT_CAGE_FILE_TOO_LARGE`).
- **Report additions:** `dependencies` (`revert` or `report`) in the session report, `gantry.cage-check.v1` and `gantry.cage-watch.v1`; rows can carry rule `dependency_manifest`. Schemas keep their names; existing fields are unchanged. The session journal records `lock_deps` so kill -9 recovery rebuilds the frozen plan; journals from earlier versions read as unfrozen.
- **Limit:** the freeze restores files; it does not block installs. Install scripts run by an agent's `npm install` have executed before cage restores `package.json`.
- **Structural law (this repository):** `gantry arch check` runs over the whole tree in `dev-validate-core.sh` with budgets against `ARCH_BASELINE.json`, concept owners, the registries, the dependency registry and script duplicates; `npm run build` no longer needs the baseline script. A mission that grows a layer must run `gantry arch check --ratchet --allow-raise` and record it (MSN-0286).
- **Cage package (this repository):** `src/cli/lib/cage/` is gone; import the cage as `#cage/<module>.js`. The slim package's bundle path changed inside its own tarball only (MSN-0283).
- **Packages (this repository):** `npm run build` now runs `tsc -b`; `dist/packages/` appears next to `dist/cli/`. Hooks, tests and the MCP launcher keep using `dist/cli/index.js`. Adopters are unaffected; the published tarball carries `dist/packages/` (MSN-0282).
- **Registries and baseline (this repository):** a new `GXT_*` error code, env name, subcommand, MCP tool or dependency needs an entry in `.gitagent/registry/` in the legislation commit; `ARCH_BASELINE.json` counts may not rise. Adopters are unaffected: nothing is shipped in templates yet (MSN-0281, [ADR-0052](../.gitagent/out-of-scope/ADR-0052-rewrite-under-structural-law.md)).
- **New: `gantry verify --contract [file]`.** Decides whether a change may land from one contract, without `.gitagent/`: `verify.yaml` (`opengantry.verify.v1`) or a COMMITLY hangar `gate.json` (`commitly.gate.v1`). It checks the paths changed since the base (`allowed_paths`, `forbidden_paths`), added lines against a budget, regex rules over added lines, and check commands (`expect: exit0|empty`, `heavy`, `quick_run`, a `failures` baseline). Modes `--worktree`, `--quick`, `--baseline`, `--check-result`; exit `0` pass, `1` fail, `2` cannot run. Guide: [Verify a change without missions](guides/verify-contract.md); [ADR-0051](../.gitagent/out-of-scope/ADR-0051-standalone-verify-contract.md) (MSN-0277).
- **Trust:** a contract git tracks is read from the base commit and needs `--base` (its own `base:` is ignored), so a pull request can weaken neither its contract nor its baseline; a tracked contract the base does not have exits `2` (`GXT_VERIFY_CONTRACT_NOT_AT_BASE`), a baseline for another contract version too (`GXT_VERIFY_BASELINE_STALE`).
- **Imports and layers:** `imports` and `layers` rules over the JS/TS and Python imports a change adds, with `path_aliases` and `python_paths`; a task contract (`gate.json`, a handover contract) also gets the base `verify.yaml`'s rules, tighten-only. `--sign` signs the result in the receipt signature format; `--check-result --allowed-signers <file>` requires a good SSH signature and names the signer (MSN-0279).
- **Formats:** `--format sarif|junit` with `--contract` prints the result as SARIF 2.1.0 (rule ids `verify/outside-allowed-paths`, `verify/forbidden-path`, `verify/size`, `verify/rule`, `verify/import`, `verify/layer`, `verify/check`, `verify/uncommitted`) or JUnit XML (suite `gantry-verify-contract`) on stdout, with the summary on stderr; `--baseline` and `--check-result` stay text or JSON (exit `2`). `--out` still writes `opengantry.verify-result.v1`.
- **New: `gantry adapt`.** `gantry adapt <plan> --from lights-on [--step <n>] [--allow-new <dir>] [--check <cmd>] [--out verify.yaml]` turns another framework's plan into a `verify.yaml` and prints the `--allow-only` cage scope for the step ([ADR-0059](../.gitagent/out-of-scope/ADR-0059-plan-adapters.md)). The listed files become `allowed_paths`; the run's machinery, lockfiles, plans and the contract become `forbidden_paths`. Unreadable plans stop with `GXT_ADAPT_PLAN_INVALID` (exit `2`). The library exports `adaptPlan`.
- **New: test integrity.** A `tests` section in `verify.yaml` (`files`, optional `allow_reduction`) fails a change that weakens the tests judging it ([ADR-0058](../.gitagent/out-of-scope/ADR-0058-test-integrity.md)). Over the changed test files (JS/TS and Python), the run fails when:
  - the assertion count goes down;
  - skip or focus markers are added (`.skip`, `.only`, `xit`, `@pytest.mark.skip`, …);
  - trivially true assertions are added (`expect(true)`, `assert True`);
  - empty catch or except blocks are added.

  Totals are compared, so splitting or moving tests passes. The result gains `tests` (`null` without the section; the two verify-contract conformance goldens are re-recorded for it), SARIF gains `verify/test-*` rule ids, and a task contract inherits the repository's `tests`.
- **New, opt-in: keyless signatures.** `--sign keyless` (with `--out`) signs the result with Sigstore through the CI job's OIDC identity (`id-token: write` in GitHub Actions, or `SIGSTORE_ID_TOKEN`); the `signature` is `{ kind: "sigstore", payload_encoding, bundle }`. `--check-result --certificate-identity <regexp>` (and `--certificate-oidc-issuer`, default GitHub Actions) requires one by a matching identity. Without an identity, `GXT_VERIFY_SIGN_NO_IDENTITY` (exit `2`) before any network call; a Fulcio or Rekor failure is `GXT_VERIFY_SIGN_FAILED`. The only network path in verify, loaded only for these flags ([ADR-0055](../.gitagent/out-of-scope/ADR-0055-keyless-verify-signatures.md)); `sigstore` ^4.1 is a new runtime dependency (version 5 needs Node 24.15; 4.1 keeps every Node 24.x supported). `--sign` without a value is unchanged.
- **New package: `@jeger-ai/opengantry-verify`.** `npx @jeger-ai/opengantry-verify [contract] --base <ref>` is `gantry verify --contract` with the contract as its argument (bin `gantry-verify`, also in the full package), and the package exports the library API (`runVerifyContract`, `checkVerifyResult`, `writeVerifyBaseline`, `parseVerifyContract`, `verifyResultSarif`, `verifyResultJUnit`, `signVerifyResultKeyless`, `checkKeylessSignature`, `GantryUserError`, the schema constants and types) with type declarations. Bundled from the same sources like the slim cage; runtime dependencies `commander` and `sigstore` (loaded only for keyless signatures). Published at the version of `@jeger-ai/opengantry` by `npm-publish.yml`. In this repository the internal workspace package `packages/verify` is now named `@jeger-ai/opengantry-verify-runtime`.
- **Unchanged:** `gantry verify --mission` and its formats; its SARIF and JUnit writers now live in `packages/verify/src/export.ts` and the output is byte-identical.
- **New, opt-in: scope mode.** `.cage.yaml` top-level `allow_only: [globs]`, or `--allow-only <glob>` (repeatable) on the session, `gantry cage watch` and `gantry cage check`, protects every file git would track outside the allowed area under the new `out_of_scope` rule; with both, a path must match each. Gitignored files outside the area are not policed. Without either, nothing changes (MSN-0276, [ADR-0048](../.gitagent/out-of-scope/ADR-0048-cage-trust-model.md) decision 10).
- **Scope needs git:** the out-of-scope baseline is a git tree written through a temporary index (your index and refs are untouched; no size cap). Outside a git work tree a scope run exits `2` (`GXT_CAGE_SCOPE_NOT_GIT`); a bad `--allow-only` value exits `2` (`GXT_CAGE_SCOPE_INVALID`).
- **Report additions:** `scope` and `scope_sources` in the session report, `gantry.cage-check.v1` and `gantry.cage-watch.v1`; the journal records the scope tree and `allow_only` globs (older journals read as unscoped).

### From v3.8.3 (cage check, cage watch, docs layout — v3.9.0)

```bash
npm install @jeger-ai/opengantry@3.9.0
npm install @jeger-ai/opengantry-cage@3.9.0
```

- **Docs layout:** `docs/` is organized into `cage/`, `start/`, `guides/`, `concepts/` and `reference/`, each page with frontmatter (`title`, `description`, `section`, `order` or `publish: false`) so opengantry.ai builds its navigation from it. `ADOPTION`, `FEATURES`, `INTEGRATIONS`, `KATA`, `DOMAINS`, `AGENT-GRAPH`, `CI`, `COMPLIANCE-ISO` and `USE-CASES` stay at their paths as moved pages with `moved_to:` and anchor maps, so links from released CLI hints, shipped templates and ADRs keep resolving. Release highlights moved from this file to `reference/release-notes.md`. `npm run validate` now runs `scripts/assert-docs-structure.mjs` (rules in `docs/STYLE.md`) (MSN-0270).

- **Gates in linked worktrees:** a gate that relied on an inherited `GIT_DIR` from a hook now runs git against the repository at its working directory, the repository root, which is the same repository for a normal checkout and for a linked worktree. Nothing changes for gates run outside hooks (MSN-0266).

- **Managed CI workflows:** `gantry upgrade apply` updates `.github/workflows/gxt-validate.yml` and `gxt-attest-ingest.yml`. The new install steps and the guard on the iii offline validate key on `examples/iii-integration/package-lock.json`; without that file they are skipped, so nothing changes for repositories that do not carry the example.
- **Repositories with the example:** a mission gate that runs `examples/iii-integration/scripts/validate-offline.mjs` no longer has to run `npm ci` in the example itself.
- **Cage push guard (session cage):** a `git push` from inside `gantry cage -- <cmd>` is now also refused when an outgoing commit renames a protected file away or a merge commit edits a protected path; before, only the rename's new path and no merge edits were checked.
- **`gantry cage check`** is new; in CI, check out with full history (`fetch-depth: 0`) so the base commit is present.
- **`gantry cage watch`** is new and needs a terminal; it shares the cage journal, so it refuses to start while a `gantry cage -- <cmd>` session runs in the same repository, and the other way round.

### From v3.8.2 (`gantry-cage` command, zod 4, trusted publishing — v3.8.3)

```bash
npm install @jeger-ai/opengantry@3.8.3
npx @jeger-ai/opengantry-cage@3.8.3 -- claude   # the slim cage; its command is now gantry-cage
```

- **Full package:** `gantry-cage` is new; `opengantry-cage` keeps working as an alias of the same entry point. Nothing to change in scripts, though new docs and examples use `gantry-cage`.
- **Slim package:** a global install of `@jeger-ai/opengantry-cage` now provides `gantry-cage` instead of `opengantry-cage`. `npx @jeger-ai/opengantry-cage -- <cmd>` works as before.
- **`npx -p @jeger-ai/opengantry opengantry-cage`** still works; the documented form is now `npx -p @jeger-ai/opengantry gantry-cage`.
- **zod 4:** the CLI now depends on zod 4.6.5 instead of 3.25.76. It is used only inside the MCP server and is not part of the `./kernel` API, so nothing changes for code that imports `@jeger-ai/opengantry/kernel`; a project that uses its own zod 3 keeps it, npm installs both side by side.
- **Provenance:** both packages carry npm provenance again from this release on; verify with `npm audit signatures`.

### From v3.8.0 (cage contested-file halt, signals, kill -9 recovery, fail-closed caps, slim package — v3.8.2)

```bash
npm install @jeger-ai/opengantry@3.8.2
npx @jeger-ai/opengantry-cage@3.8.2 -- claude   # the slim cage, new in this release
```

No 3.8.1 was published: the contested-file halt once listed under that version first shipped in 3.8.2, so upgrade from 3.8.0 straight to 3.8.2.

- **Behaviour change, contested files:** a protected path rewritten again after 3 live restores now terminates the wrapped command and every process it started, and cage exits `4` instead of `3`. Scripts and CI that treat any non-zero cage exit as failure need no change; scripts that check for exactly `3` should also accept `4`.
- **Keep the old behaviour:** pass `--contest-limit 0` or set `contest_limit: 0` in `.cage.yaml`. The path is then marked contested and restored once at exit, as in v3.8.0.
- **Legitimate rewriters:** a dev server or tool that rewrites a protected file (for example `.env.local`) will now halt the session. Run it with `--allow-override <path>` for that run; overridden and report-mode paths never halt.
- **New `.cage.yaml` keys:** top-level `mode:` (default for the file's own entries only) and `contest_limit:`. Both fail closed when invalid (`GXT_CAGE_CONFIG_INVALID`, exit 2).
- **Behaviour change, signals:** SIGTERM or SIGHUP sent to cage, or SIGINT when its stdin is not a terminal, used to be forwarded to the command while cage waited; background jobs of a nested shell kept running. Cage now terminates the whole enumerated tree, restores, and exits `3` if anything was restored, otherwise with the command's own exit code (`128 + N` when the signal killed it). Ctrl-C on a terminal is unchanged: it reaches the agent and cage keeps running.
- **Behaviour change, caps:** a revert-rule file over `--max-file-bytes` (default 5 MiB), or revert-rule bytes over the 64 MiB snapshot budget, now exit `2` before the command runs (`GXT_CAGE_FILE_TOO_LARGE` lists every path and size; `GXT_CAGE_SNAPSHOT_BUDGET_EXCEEDED` gives the total). Before, the run started and the file was `detect_only`: reported, never restored. Raise `--max-file-bytes`, or pass `--allow-override <path>` to report that path instead (announced in every report). `--report-only` is unaffected.
- **New journal:** each session writes `<git dir>/gantry-cage-journal/` (files `0600`, with copies of protected file bytes such as `.env`) and removes it at a clean exit. After a `kill -9` on cage, the next cage run in that repo recovers it first. Two new exit-2 cases: an earlier cage session still running (`GXT_CAGE_SESSION_ACTIVE`) and a journal that fails its hash check (`GXT_CAGE_JOURNAL_CORRUPT`; inspect it, then remove the directory).
- **Report additions:** `watch.contest_limit` and `watch.halt` (`path`, `rule`, `live_restores`, or null), status `halted`, `trapped_signal` and `recovery`; `detect_only` is no longer produced for revert-rule files. Existing fields are unchanged and `report_schema` stays `gantry.cage-report.v1`.
- **New package:** `@jeger-ai/opengantry-cage` is published from `packages/opengantry-cage/` with v3.8.2, at the same version as `@jeger-ai/opengantry`. `npx -p @jeger-ai/opengantry opengantry-cage` keeps working.

### From v3.7.1 (per-project cage rules — v3.8.0)

```bash
npm install @jeger-ai/opengantry@3.8.0
```

- **No behavior change without `.cage.yaml`:** the built-in protected set, live restore and the push guard work as in v3.7.1.
- **New built-in target:** `.cage.yaml` is now always protected (`cage_config`). An agent that creates or edits it during a session sees the change restored.
- **New exit-2 cases:** an invalid `.cage.yaml`, an invalid `--allow-override`, or a protected set over 5,000 files / 64 MiB aborts before the command runs.
- **Report additions:** change rows gain `source` and `overridden`; the report gains `cage_config` and `overrides`. Existing fields are unchanged and `report_schema` stays `gantry.cage-report.v1`.
- **Wrapped command `suggest`:** `gantry cage suggest` is now a subcommand. To run a program named `suggest` inside the cage, use `gantry cage -- suggest`.

### From v3.7.0 (cage live restore and push guard — v3.7.1)

```bash
npm install @jeger-ai/opengantry@3.7.1
```

- **Behavior change (cage only):** live restore is now the default. Protected files are restored while the command runs, not only at exit. Pass `--no-watch` to keep the v3.7.0 exit-only behavior (for example in scripted runs that inspect protected files mid-run).
- **Push guard:** `git push` run inside a cage session is refused when outgoing commits touch CI configs, secrets or manifest forbidden zones. Your repo hooks still run (chained). `--no-verify` skips it.
- **Report additions:** `--json` gains `watch` and `push_guard` objects; existing fields and change-row keys are unchanged, `report_schema` stays `gantry.cage-report.v1`.

### From v3.6.0 (zero-config cage — v3.7.0)

```bash
npm install @jeger-ai/opengantry@3.7.0
```

- **New command, no behavior change elsewhere:** `gantry cage -- <command...>` and the `opengantry-cage` bin are additive. Existing missions, verify, and hooks are unchanged.
- **Cage checks once, after the command exits.** Use it for one-shot, headless agent runs (`claude -p …`, `aider --message … --no-auto-commits --yes-always`), not interactive sessions. It restores the working tree, not git history or a remote.
- **Exit code 3** means protected files changed (reverted, or `detect_only` / `revert_failed`). Wrappers that treat any non-zero exit as failure will see it.
- **`.git/config` is protected:** an agent's `git push -u` upstream entry is reverted after the run.

### From v3.5.0 (typed-adapter guard, pre-commit TMVC gate, contract index — v3.6.0)

```bash
npm install @jeger-ai/opengantry@3.6.0
```

- **Behavior change (fail-closed):** missions with `gate_adapter: tsc` or `gate_adapter: eslint` whose `gate_command` contains an unquoted `&&`, `||`, `;`, or line break are now rejected at `gantry legislate` and when `gantry verify` loads the mission (`GXT_GATE_ADAPTER_MISCONFIG`). Typed adapters parse one tool's stdout, so chained commands never produced reliable findings. Fix: wrap the sequence in one script (for example `npm run lint:json`), or set `gate_adapter: generic`. Pipes (`|`), quoted operators, backslash-newline continuations, and trailing newlines from YAML block scalars are still accepted. Check before upgrading: `grep -l "gate_adapter: \(tsc\|eslint\)" .gitagent/missions/*.yaml`.
- **Pre-commit TMVC gate (opt-in):** `gantry hooks install` sets local `gxt.tmvcGuardStrict` so the tracked `.githooks/pre-commit` blocks staged paths outside the pinned mission. `gantry hooks uninstall` clears it. `git commit --no-verify` is the only bypass. Run `gantry upgrade` to stage the updated `templates/.githooks/pre-commit`.
- **Contract drift index (optional):** new dependencies `better-sqlite3` (native module, prebuilt binaries for common platforms) and `sqlite-vec`. They are loaded lazily and only when you pass `--embedding-file` / `--auto-embed`; other commands never import them. `--auto-embed` and `gantry contract embed` call OpenAI and need `OPENAI_API_KEY`. The index file `.gitagent/planner/contracts.sqlite` should be gitignored.
- **No public API change:** the `src/cli/lib` folder restructure (MSN-0228) only moves internal files. Deep `dist/cli/lib/*` imports have not resolved through the `exports` map since v3.2.2.

### From v3.4.0 (launcher, verify exports, preflight — v3.5.0)

```bash
npm install @jeger-ai/opengantry@3.5.0
```

- **Not breaking** for callers that already treat `gantry verify --json` as the only stdout payload. `--format sarif` and `--format junit` now do the same: the document is the only stdout payload; diagnostics stay on stderr. Scripts that parsed mixed stdout from those formats need to read stderr separately. Do not pipe stderr into the SARIF or JUnit file.
- **Cursor MCP:** `.cursor/mcp.json` `command` is `./scripts/mcp-launcher.sh` for the specimen and for adopters. There is no parity exemption for that file. Do not point Cursor at a raw `node` binary. The launcher uses `node dist/cli/index.js mcp serve` when a local build exists; otherwise `gantry mcp serve` from `PATH`.
- **Experimental:** `gantry contract preflight` (MCP `gxt_preflight_contract`) is advisory. Jev reads every skill from `MANIFEST.json`. A 2000ms timeout or any non-OK HTTP status, including 500, falls open to the offline heuristic. A missing `TYPESAFE_API_KEY` is an explicit error before fetch. Wiring: [`CI.md`](CI.md).

### From v3.3.0 (mission contracts — v3.4.0)

```bash
npm install @jeger-ai/opengantry@3.4.0
gantry upgrade   # pulls MISSION.schema.yaml contract + contract_sha256 fields
```

- **Not breaking.** Draft token v2 remains accepted; v3 is required when the token carries a `contract` block. Live Cursor MCP servers that still reject `contract` on `gxt_draft_legislation` should use `gantry legislate --from-intent --yes --contract-file`.
- **CLI:** `gantry contract propose|check|show`; `gantry legislate --from-intent` (optional `--contract-file`).
- **MCP:** `gxt_propose_contract` (autoformalize the cage before draft).
- **Verify:** new `contract` phase after `git_proof` — tamper (`GXT_CONTRACT_TAMPERED`) plus import-site scan (`GXT_CONTRACT_IMPORT_*`).
- **Runtime:** `gantry runtime env` exports `GXT_ALLOWED_IMPORTS` / `GXT_BANNED_IMPORTS`. `gantry runtime exec` ends the flight as `contract_violation` (exit 3) on import-site breaches.
- **Empty TMVC roots:** check / verify / runtime scan git-dirty scannable sources (not the whole tree, not nothing); missing/deleted paths are skipped; a repo with no `HEAD` still includes the index and untracked files.

### From v3.2.6 (org control plane — v3.3.0)

```bash
npm install @jeger-ai/opengantry@3.3.0
gantry upgrade   # pulls ORG-POLICY.schema.yaml (managed_strict) + POLICY.pointer.json scaffold
```

- **Breaking (kernel):** `verifyMission` now returns `Promise<VerifyResultPayload>`. TypeScript consumers fail at compile time until they `await`. A plain-JS sync caller cannot be warned at runtime. `verifyMissionAsync` remains as a `@deprecated` alias and emits one `DeprecationWarning` with code `GXT_DEP_VERIFY_MISSION_ASYNC` (honours `--no-deprecation` / `--throw-deprecation`; never writes to `--json` stdout). The alias will be removed in 4.0. CLI `--json-out` is **kept**.
- **Adapters:** `GateSpec.adapter` is required in memory; Commander `--gate-adapter` uses `.choices()`. Success-substring is a post-close log `includes` check (no stream scanner).
- **Ledger / deps:** ledger commits use `hash-object --stdin` + `mktree` + `commit-tree`. Unreadable tip is `GXT_LEDGER_CHAIN_BROKEN` (fail-closed). `gantry release check` exits non-zero on failed `depends_on`.
- **Policy:** `resolveOrgPolicy` returns `ok | fail{code}`. Only `config_floor` is enforced in 3.3.0 (ADR-0042).
- **Opt-in policy floor:** add `.gitagent/foreman/POLICY.pointer.json`, then `gantry policy pull`. Doctor and verify never fetch. Merge is tighten-only (ADR-0042). Do not pin a pointer on a repo until the cache is populated or verify will fail closed.
- **Opt-in ledger:** `.gitagent/config.json` `ledger.mode: local` (default remains `off`). `strict_enterprise` defensive preset defaults ledger mode to `local` when `ledger.mode` is unset. Unsigned entries are checksums, not proofs.
- **Cross-repo deps:** add mission `depends_on[]`, run `gantry deps fetch` in CI before verify, then `gantry release check --tag <prev>`.
- **Receipts:** schema stays **0.2.0**. Policy/findings digests live in ledger entries, not receipts (ADR-0036/0037).
- **MCP:** read-only `gxt_policy_status`, `gxt_ledger_verify`, `gxt_deps_check`. `gxt_verify` remains the mutating verify path.

### From v3.2.5 (gantry report + ADR-0040 — v3.2.6)

```bash
npm install @jeger-ai/opengantry@3.2.6
```

- **`gantry report`:** localhost overview at `http://127.0.0.1:3134/` (port walks on `EADDRINUSE`) — repo git metrics, mission timeline, last verify status, drill-down at `/verify`. Use `--json` for the same view models.
- **Findings blame v3:** verify failures may include semantic fingerprints and a capped verify-run ring under `.gitagent/verify-runs/` (replaces `verify-last.json`).
- **Kernel:** optional `gateExecAdapter` on `verifyMission` for in-process gate execution (iii worker pattern).

### From v3.2.2 (docs — v3.2.3)

```bash
npm install @jeger-ai/opengantry@3.2.3
```

- **Docs:** [`MANIFESTO.md`](MANIFESTO.md) (North Star positioning); [`AGENT-LOOP.md`](AGENT-GRAPH.md) renamed to [`AGENT-GRAPH.md`](AGENT-GRAPH.md) — update inbound links and site slugs (`agent-graph`).
- **Terminology:** user-facing copy uses mission/verify **graph** and **retry edge**; manifesto **Inner/Outer Loop** titles unchanged (DevEx locus only).

### From v3.2.1 (breaking kernel exports — v3.2.2)

```bash
npm install @jeger-ai/opengantry@3.2.2
gantry upgrade apply   # or gantry init --force for managed CI assets
```

- **Programmatic imports:** use `@jeger-ai/opengantry/kernel` only — deep imports such as `@jeger-ai/opengantry/dist/cli/lib/...` no longer resolve.
- **Public API:** `evaluateScope`, `verifyMission`, `mintVerdictToken`, `verifyVerdictToken` (see `examples/iii-integration/`).
- **Git subprocesses:** gantry sets `GIT_OPTIONAL_LOCKS=0` on all git spawns (concurrency-safe verify on shared repos).

### From v2.3.0 (breaking Planner/Executor rename)

```bash
npm install @jeger-ai/opengantry@2.3.1
gantry init --force   # or gantry upgrade apply with a signed substrate mission
gantry planner set "$(git config user.email)"
```

Old `gantry teacher`, `WORKER_LOG.md`, `GXT_TEACHER_EMAILS`, and `GXT_WORKER_LOG` **no longer work** — update scripts and CI env vars.

### From v1.x

```bash
npm install @jeger-ai/opengantry@latest
gantry upgrade apply   # or gantry init --force for managed CI assets
```

Pulls `pr_governance`, `verify-pr-missions.sh`, stale-evidence verify, and updated workflow.

### PR and validate base ref

- **PR policy:** one mission per PR; target your repo **integration branch** only. CI `pr_governance` compares the PR base to `github.event.repository.default_branch` by default. When your integration branch differs (e.g. GitFlow with `develop`), set repository variable **`GXT_INTEGRATION_BRANCH`**. Stacked PRs fail `pr_governance` and local `verify-pr-missions.sh` purity when rebased onto the integration branch.
- **Local validate base ref:** `npm run validate` / `./scripts/dev-validate.sh` default to `origin/main`; pass your integration ref explicitly when it differs (e.g. `./scripts/dev-validate.sh origin/develop`).

---

## Maintainers

**npm publish:** push an annotated tag `v<semver>` on `main` after CI is green — [`.github/workflows/npm-publish.yml`](../.github/workflows/npm-publish.yml) runs `npm run validate` then `npm publish --provenance --access public` (requires `NPM_TOKEN` repo secret).

**Release-squash policy:** a release MUST NOT ship under an MSN that has no committed mission file. When multiple planned missions consolidate into one release mission, the surviving mission file MUST name the squashed MSN range, `EXECUTOR_LOG.md` trace quotes MUST reference the surviving `MSN-XXXX` id, and the release MUST pass `gantry verify --mission` before tagging.

Historical maintainer backlog: [`archive/BACKLOG.md`](archive/BACKLOG.md).
