---
title: "Operation admission: coverage of existing boundaries"
description: "Discovery inventory for issue #356: which agent operations OpenGantry prevents, detects or only audits, per platform and harness, with evidence and bypasses."
publish: false
---

# Operation admission: coverage of existing boundaries

Status: **discovery, not a support claim.** This page inventories what exists at commit `be464fe9` (2026-11-16) for issue [#356](https://github.com/jeger-ai/opengantry/issues/356), work slice 1. It is the input to the contract in [ADR-0063](../../.gitagent/out-of-scope/ADR-0063-operation-admission-contract.md) (ACTIVE since 2026-11-16). Slice 2 implements the contract as schemas and pure logic, and transcribes this matrix into `packages/core/src/admission-capabilities.ts`, with macOS and Windows capped at `unproven` (MSN-0384). Slice 3 adds the broker state machine and a local broker process for `workspace.write` and `process.spawn` (MSN-0386); it confines nothing, so no cell changes. Slice 4 tests Claude Code's sandbox runtime on an Ubuntu 26.04 host with canaries (MSN-0391, [results](#sandbox-probe-ubuntu-2604-2026-11-17)). On the stock host no cell is proven. With an AppArmor prerequisite the owner installed, the re-run proves three families on that host (MSN-0395; `workspace.write` is not proven, because an inherited fd past a gap reaches the sandbox). The matrix below cannot carry a host condition, so it stays unchanged; the proven cells come from `gantry admission capabilities --probe`. Nothing here changes behaviour, and nothing here is a guarantee to adopters. The published enforcement page, [Enforcement boundary](enforcement-boundary.md), stays the adopter-facing description until a cell is proven by a canary.

**Headline: no cell in the matrix is `prevention`.** OpenGantry has no operating-system-enforced boundary of its own (ADR-0060 decision 1). The mechanisms that act before an effect are agent tool-call guards that judge strings, plus an agent sandbox configuration that `gantry cage policy` prints for a human to merge. Slice 4 tested that configuration at the OS level on one Ubuntu 26.04 host. On the stock host the full runtime does not start, and the configuration that does start can be escaped. After the owner installed an AppArmor profile for bwrap, the full runtime stopped every `process.spawn`, `dependency.materialize` and (with `--strict-network`) `network.connect` canary, and every `workspace.write` canary but one: a file descriptor inherited past a gap reaches the sandbox ([results](#sandbox-probe-ubuntu-2604-2026-11-17)). That is a per-host probe result, not a static cell. Everything else detects after the effect (cage restore, `runtime exec` forbidden-zone scan, `cage check`, verify) or only records it.

## Support levels

| Level | Meaning | Required evidence |
|-------|---------|-------------------|
| `prevention` | The forbidden effect cannot happen. A boundary the candidate cannot reach around refuses it before the effect, including nested processes, inherited handles, alternate executables, path/symlink substitution and alternate transports. | A disposable canary on that platform and harness shows the effect never happens, along every listed path (#356 ADM-T01). |
| `unproven` | Something acts before the effect, but no canary proves it, or an equivalent unmediated path is known. Under #356 R1, a known equivalent path makes preventive support false. | The mechanism, and the bypass paths known so far. |
| `detection` | A deterministic check sees the effect after it happens and fails, restores or halts. The effect has already occurred. | Code and a test that exercises the check. |
| `audit-only` | The effect, or the attempt, is recorded or surfaced (log, report, `ask` prompt), but nothing deterministic judges it. | Code. |
| `unsupported` | No mechanism of any kind for this cell. | A search that found none (listed below). |

A cell holds the strongest level that is honestly available. When a cell lists two levels (for example `unproven` / `detection`), the first is a weak pre-effect guard and the second is the after-effect check behind it.

## Harness columns

| Key | Harness configuration this inventory assumes |
|-----|-----------------------------------------------|
| **CC** | Claude Code with the `gantry cage policy --agent claude-code` fragment merged into `.claude/settings.json` and the read guard registered as a `PreToolUse` hook. Both are opt-in: `gantry init` writes neither, and `templates/integrations/recipes/claude-code.md` ships no hooks. |
| **CU** | Cursor with the shipped `.cursor/hooks.json` (`sessionStart`, `beforeShellExecution`). The read guard is not in the shipped hooks. |
| **CX** | Codex, OpenCode and other CLIs started through `templates/scripts/gxt-shell-agent.sh`, which exports environment variables and `exec`s the agent. No OpenGantry mapping to Codex's sandbox exists yet (ADR-0060 decision 4 is not implemented). |
| **HL** | A headless run under `gantry runtime exec` and/or the session cage `gantry cage -- <cmd>` / `gantry-cage`. |
| **RB** | The repository boundary that applies to every harness: tracked git hooks (`.githooks/*`), `gantry cage check`, `gantry verify`, and the CI workflow `gxt-validate.yml` (perimeter, `ci msn-range`, `ci verify-missions`). |

## Platform rows

| Key | Target | What exists today |
|-----|--------|-------------------|
| **U** | Ubuntu 26.04 x64 | The owner moved the Linux target row from 24.04 to 26.04 on 2026-11-16 (ADR-0063 owner decision Q2). All CI runs on `ubuntu-latest`. The version is not pinned, so no evidence is tied to 26.04 specifically. Claude Code's sandbox uses bubblewrap, which needs unprivileged user namespaces; Ubuntu restricts them through AppArmor since 24.04 (ADR-0060 context), which 26.04 is expected to keep until a probe shows otherwise. Probed on 2026-11-17 (MSN-0391): the stock `bwrap-userns-restrict` profile lets bwrap run, but strips capabilities from its children, so the runtime's seccomp helper cannot start; without the helper the sandbox runs and is escaped over same-user Unix sockets. Re-probed the same day (MSN-0395) on jai01 (Ubuntu 26.04.1, kernel 7.0.0-43, bwrap 0.11.1) after the owner disabled `bwrap-userns-restrict` and installed an unconfined `/etc/apparmor.d/bwrap` profile with `userns`: `@anthropic-ai/sandbox-runtime` 0.0.83 (digest `c6872618…`) ran in policy mode with its seccomp helper. Claude Code proven there (PR #379 review round, 39 canaries): `process.spawn` and `dependency.materialize` (probe digest `07124421…`), and `network.connect` with `--strict-network` (probe digest `6d085771…`). `workspace.write` is not proven: an fd inherited past a gap (fd 20, fds 3–19 closed) reached the sandbox and was written through. `artifact.read` is not proven (launch-environment tokens pass through until PR #376). These hold only with that AppArmor prerequisite, so the static cells below stay unchanged; see [the results](#sandbox-probe-ubuntu-2604-2026-11-17). |
| **M** | macOS 26.2+ Apple Silicon | `cage-macos.yml` runs the cage suites on `macos-latest`. The version is not pinned, so no evidence is tied to 26.2. Claude Code's sandbox uses Seatbelt. |
| **W** | Windows 11 x64 (native, not WSL) | No CI job. The session cage is documented as unsupported (`docs/cage/limits.md`, Platforms): `listDescendantPids` returns `[]` on `win32` (`packages/cage/src/cage-process.ts:50`). Tracked hooks are bash shims. Claude Code's sandbox documents macOS, Linux and WSL2 only, so on native Windows the fragment's `sandbox` keys have no effect. Treat as unverified. |

WSL2 is not counted as Windows (#356 ADM05).

## Matrix

Level per family × harness × platform. Bypass ids (B1…) are listed after the matrix.

### `artifact.read` (secrets and protected reads)

| | U | M | W |
|---|---|---|---|
| CC | `unproven`: `Read(...)` deny rules, read guard, `sandbox.filesystem.denyRead`, `sandbox.credentials.files` (B1–B5) | `unproven`: same (B1–B5) | `unproven`: `Read(...)` rules and read guard only, no shell sandbox (B1–B5, B6) |
| CU | `unsupported` as shipped. `unproven` if the user wires the read guard to `beforeReadFile` / `beforeShellExecution` (B1, B2) | same as U | same as U |
| CX | `unsupported` | `unsupported` | `unsupported` |
| HL | `unsupported`: the cage and `runtime exec` see no reads (`packages/cage/src/cage-report.ts:8-27`) | `unsupported` | `unsupported` |
| RB | `unsupported`: reads never reach git | `unsupported` | `unsupported` |

Evidence: `packages/cage/src/read-guard.ts` (`SHELL_SPLIT` at line 37, path-word filter at lines 64-72), `packages/core/src/secret-paths.ts`, `packages/cage/src/cage-suggest.ts:184` (`cageAgentPolicy`), `docs/cage/read-guard.md`, `docs/cage/policy.md`. Proof is JSON-in/JSON-out only: `src/cli/tests/read-guard.test.ts`, `packages/opengantry-cage/tests/read-guard.test.mjs` (no symlink case) and the golden fragment `src/cli/tests/cage-policy.test.ts`. No test runs a sandbox.

### `workspace.write`

| | U | M | W |
|---|---|---|---|
| CC | `unproven` / `detection`: `Edit(...)` rules and `sandbox.filesystem.denyWrite` on the protected set only. Task scope (`allowWrite`) is not emitted (ADR-0060 decision 3). (B7, B8) | same as U | `unproven`: `Edit(...)` rules only; shell writes are unguarded (B6, B7) |
| CU | `unproven` / `detection`: `beforeShellExecution` returns `ask` on two governance regexes, and agent file edits are not hooked (B9). Behind that: RB. | same as U | same as U |
| CX | `detection` via RB only | same as U | same as U |
| HL | `detection`: the session cage restores the protected set about once a second and halts after `contest_limit`; `runtime exec` compares forbidden zones after exit (B10–B13) | `detection`: same (cage tested in `cage-macos.yml`) | `unsupported` session cage (documented). `runtime exec` scan: `unproven`, never run on Windows |
| RB | `detection`: pre-commit TMVC guard (advisory unless strict), `cage check`, CI perimeter, verify forbidden zones. Committed changes only (B14) | same as U | `unproven`: hooks are bash shims, untested |

Evidence: `packages/cage/src/cage-run.ts:231-291`, `cage-watch.ts`, `cage-rules.ts`, `cage-process.ts:114-126` (halt), `packages/missions/src/forbidden-scan.ts:82-130`, `packages/missions/src/runtime-exec.ts:244,327`, `packages/missions/src/staged-tmvc-guard.ts`, `src/cli/commands/hook.ts`, `packages/cage/src/cage-check.ts`, `packages/missions/src/perimeter.ts:121-127`. Tests: `src/cli/tests/cage.test.ts`, `cage-watch.test.ts`, `cage-check.test.ts`, `runtime.test.ts`, `hook.test.ts`, `perimeter.test.ts`. None asserts an OS-level `EACCES`/`EPERM`.

### `process.spawn`

| | U | M | W |
|---|---|---|---|
| CC | `unproven`: `sandbox.enabled`, `allowUnsandboxedCommands: false`, `failIfUnavailable: true` (a sandbox that cannot start refuses instead of running commands unsandboxed). The harness puts shell commands and their descendants under the filesystem limits above; spawning itself is not admitted or denied. No `Bash(...)` rules are emitted. | same as U | `unsupported`: no sandbox |
| CU | `unproven` / `audit-only`: an `ask` regex on `.gitagent/foreman/`, `RULES.md` and `gantry legislate` (`.cursor/hooks/gxt-before-shell.sh:212,220`) (B9, B15) | same as U | same as U |
| CX | `unsupported` | `unsupported` | `unsupported` |
| HL | `audit-only` / `detection`: `runtime exec` logs stream hashes to `EXECUTOR_LOG.md`; the cage halt signals descendants it enumerates through `ps` (B11, B16) | same as U | `audit-only`: no descendant enumeration (`taskkill /T` at the end of grace) |
| RB | `unsupported` | `unsupported` | `unsupported` |

Evidence: `packages/missions/src/runtime-exec-process.ts:36-40,71`, `packages/cage/src/cage-process.ts:49-69`, `src/cli/mcp/mcp-tools-register.ts:129-138` (`gxt_runtime_exec`). Tests: `src/cli/tests/cage.test.ts:630` (SIGTERM tree, POSIX only), `cage-watch.test.ts:89,116`.

### `dependency.materialize` (owned by #355 and its ADR-0062, PR #362; the boundary is shared)

| | U | M | W |
|---|---|---|---|
| CC | `unsupported` pre-execution: install scripts run inside the sandbox's filesystem limits, but nothing admits or refuses the install, and no network allowlist is emitted (B17) | same as U | `unsupported` |
| CU | `unsupported` | `unsupported` | `unsupported` |
| CX | `unsupported` | `unsupported` | `unsupported` |
| HL | `detection` of manifest and lockfile changes with `--lock-deps` (restore). Install-time scripts have already run (ADR-0048 decision 9, Limit) | same as U | `unsupported` session cage |
| RB | `detection`: `dependency_update` structure check for trusted-automation PRs only (ADR-0057); `cage check` with `dependencies: revert` at base | same as U | `unproven` (hooks untested) |

Evidence: `packages/core/src/dependency-update.ts:55-78` (registry prefix and non-empty `integrity`; the integrity value is not checked against the registry), `packages/missions/src/trusted-automation.ts:53-56,159` (actor = commit author email). No `--ignore-scripts` anywhere in code or CI. Tests: `packages/core/tests/dependency-update.test.ts`, `src/cli/tests/trusted-automation-deps.test.ts`.

### `network.connect`

| | U | M | W |
|---|---|---|---|
| CC | `unsupported`: `sandbox.network` is deliberately omitted (ADR-0060 amendment, 2026-10-29). The harness proxy exists but OpenGantry does not configure it. | `unsupported` | `unsupported` |
| CU, CX, HL, RB | `unsupported` | `unsupported` | `unsupported` |

OpenGantry's own network paths are explicit commands, not mediation: `gantry policy pull` (`packages/plane/src/policy-fetch.ts`), `gantry deps fetch` (`packages/plane/src/deps-fetch.ts`), the architecture fetch (`fetch()`, 2 MiB cap), and `gantry ledger push`/`fetch`.

### `git.publish`

| | U | M | W |
|---|---|---|---|
| CC | `unproven`: `denyWrite` / `Edit` on `.git/config`, `.git/hooks` and `core.hooksPath` protects the hook configuration from shell writes. Nothing admits a push. (B18) | same as U | `unsupported` |
| CU | `audit-only`: pre-push verify, advisory perimeter (B18) | same | same |
| CX | `audit-only`: same | same | same |
| HL | `unproven`: the session push guard refuses a `git push` inside the session that changes a protected path (B18) | same as U | `unsupported` (sh guard untested) |
| RB | `detection`: CI judges commits before merge (perimeter, msn-range, verify-missions). The push itself is not mediated. Branch protection is host configuration outside OpenGantry. | same | same |

Evidence: `packages/cage/src/cage-push-guard.ts:74-82` (hook injected through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`), `:88-145`, `src/cli/commands/hook.ts:156-173`. Tests: `src/cli/tests/cage-watch.test.ts:270,301` (real `git push`, refused), `verify-pre-push.test.ts`, `git-hooks.test.ts`.

### `delivery.mutate` (PRs, merges, releases, issue and comment writes, deploys, package publish)

| | U | M | W |
|---|---|---|---|
| CC, CU, CX, HL, RB | `unsupported` | `unsupported` | `unsupported` |

No code mediates `gh`, the GitHub API or any host API. Candidate-reachable credentials (`GH_TOKEN` and similar in the environment, credential helpers) are not scrubbed. The cage policy denies reads of `~/.config/gh/hosts.yml`, `.git-credentials` and `.netrc` (`secret-paths.ts`), which helps only `artifact.read`. One existing pattern looks like the broker R1 asks for: `npm-publish.yml` publishes through npm trusted publishing (GitHub OIDC, no stored token), so the publish credential lives with CI, not with an agent. That is a deployment control, not admission.

## Bypass paths

| Id | Path | Where it bites |
|----|------|----------------|
| B1 | **Alternate tools:** `Glob`, `Grep`'s `glob` parameter, `WebFetch`, and MCP tools are not judged by the read guard. | `read-guard.ts:28-35` |
| B2 | **Path built at run time / words without `/` or a leading `.`:** `cat $(printf .e; printf nv)`, a variable, or `cat id_rsa` with cwd in `~/.ssh` all pass the shell word filter. | `read-guard.ts:37,64-72` |
| B3 | **Symlink / path substitution:** the read guard matches the resolved string with no `realpath` (`secret-paths.ts:35-45`). Whether Claude Code's permission and sandbox rules follow symlinks is unproven. | read guard, CC rules |
| B4 | **Gaps in the list:** `.git/config` is left out of `denyRead` on purpose (git needs it). `.gitagent/history/credentials` (`gantry arch cred`, `constants.ts:17`) is not on the secret list. Secrets in environment variables are not files. | `secret-paths.ts`, ADR-0060 amendment |
| B5 | **Inherited handles and environment:** a process started before the guard or the sandbox, or a file descriptor passed in, is not re-judged. Unproven in either direction. The sandbox probe cannot test an inherited fd: `srt` passes only stdio into the sandbox. The launch environment passes through: planted `GH_TOKEN`, `GITHUB_TOKEN` and `OGCANARY_GH_TOKEN` reached the sandbox. The generated policy declares no `sandbox.credentials.envVars`; `srt`'s `envVars` deny was checked directly (it withholds a declared variable) but not with a generated policy. | all CC cells |
| B6 | **No shell sandbox on native Windows:** only the tool permission rules remain. | CC/W |
| B7 | **bubblewrap ignores wildcard `denyWrite` entries** other than a trailing `/**`. Those paths fall back to `Edit` rules and the cage. | ADR-0060 amendment |
| B8 | **Scope is not emitted:** writes outside the task's allowed paths are not refused, only writes to the protected set. | ADR-0060 decision 3 |
| B9 | **Regex guards:** quoting, variables, `cd`, or another interpreter evades a command-string regex, and `ask` is not `deny`. Cursor agent file edits are not hooked. | `.cursor/hooks/gxt-before-shell.sh` |
| B10 | **Restore window:** a protected change is live for about one polling interval (1000 ms default) and can be used or committed in that gap. The halt ends the session after the fact. | `cage-watch.ts`, `docs/cage/limits.md` |
| B11 | **Descendants:** the cage enumerates the tree through `ps`, so a process reparented between passes can survive. Background processes that outlive the command write after the final check. `runtime exec`'s timeout signals only the direct child. | `cage-process.ts:49-69`, `runtime-exec-process.ts:71`, ADR-0048 decision 7 |
| B12 | **`runtime exec` zone scan:** zones are `path.resolve`d against the process working directory, so glob zones match nothing. Symlinks and non-regular files inside a zone are skipped. Writes outside TMVC roots are not checked, only forbidden zones and contract imports. | `forbidden-scan.ts:66,85`, `runtime-exec.ts:327-334` |
| B13 | **Outside the protected set:** writes outside the repository, gitignored files outside a scope, and files hidden by `.git/info/exclude` are not seen. | ADR-0048 decision 10, `docs/cage/limits.md` |
| B14 | **Local hooks are candidate-reachable:** `--no-verify`. Before MSN-0381 the tracked shims ran `node dist/cli/index.js` when it existed, so a candidate that wrote `dist/` controlled the hook; they now run an installed `gantry` outside the checkout (no link on the way to it, and no directory that names it, may live in the checkout, checked component by component so a directory link in the checkout pointing elsewhere does not count as outside; PR #369 review round 3) whose reported version matches the pinned major and is at least the pin, unless a human sets `GANTRY_HOOK_LOCAL_BUILD=1`. Since MSN-0385 the MCP launcher (`scripts/mcp-launcher.sh`), the Cursor sessionStart hook and `scripts/gxt-runtime-env.sh` use the same resolver block (a test keeps every copy identical), with their own opt-in `GANTRY_MCP_LOCAL_BUILD=1`, which the git hooks ignore. Every copy first exports a `PATH` without relative entries, entries in the checkout or any `node_modules/.bin` (as `npm run` and direnv add), so the installed bin's `#!/usr/bin/env node`, its `git` and the shell tools never resolve to a planted `node` or `git`; with no `node` left outside the checkout it refuses (PR #369 review round 3). Those scripts, like `.githooks/`, are themselves checkout files: a candidate that edits one chooses what it runs, and only `.githooks` is among the cage's suggested rules. The pin is read from the working tree, so it is a consistency check, not a boundary. The pre-push hook no longer runs `scripts/check-changed-code.sh` (CI does), but `gantry verify --pre-push` still runs each changed mission's `gate_command`, which is checkout code by design: a candidate that writes the gate's script or the mission controls what the hook runs. The pre-commit guard is advisory without strict mode and skipped without a pinned mission. CI under branch protection, with human review of workflow and verifier changes, is the boundary. | `.githooks/pre-commit`, `hook.ts` |
| B15 | **MCP spawn path:** `gxt_runtime_exec` spawns any argv from an MCP client, which never passes through Cursor's shell hook. | `mcp-tools-register.ts:129-138` |
| B16 | **Environment switches:** `GANTRY_CAGE_SESSION` (the only marker that refuses `cage policy`/`suggest` in a session) and the `GIT_CONFIG_*` variables that install the push guard can be unset by the caged process. | `cage-suggest.ts:17,168-171`, `cage-push-guard.ts:74-82` |
| B17 | **Install-time execution:** lifecycle scripts, alternate package managers, `npx`, restored caches and direct downloads all run before any check. The freeze restores files afterwards. | ADR-0048 decision 9, #355 |
| B18 | **Push without the hook:** `git push --no-verify`, `git -c core.hooksPath=…`, a second clone, `gh` or the REST API with a candidate-reachable token. | `cage-push-guard.ts`, `docs/cage/limits.md` |

## Authority surfaces a candidate can reach

R1 requires that decision and signing authority be protected from candidate processes (ADM03, last sentence). At the inventory these authority inputs lived where a process of the same user can read or change them. MSN-0381 (owner decision Q10) moved the first three and MSN-0385 closed its follow-ups (the launchers, the CI note, linked home paths in `gantry cage policy`); their cells stay `unproven` until a canary proves the harness sandbox that denies the new locations:

| Surface | Where | Note |
|---------|-------|------|
| MCP draft-token HMAC key | was `.gitagent/foreman/DRAFT_TOKEN.key`; since MSN-0381 `~/.opengantry/draft-token.json` with the replay ledger (`packages/missions/src/draft-token.ts`) | `gantry cage policy` denies the directory to the sandbox, and a legacy in-repo key refuses draft and execute. Without a proven sandbox the same user can still read the key and sign its own draft: `unproven`. On Linux and WSL2 the sandbox ignores a deny for a path that does not exist yet, so the directory must exist before the session starts. |
| Break-glass anchor | `.gitagent/foreman/BYPASS.sha256`, read since MSN-0381 from the base commit (merge-base of `HEAD` with the default branch, `packages/missions/src/break-glass.ts`) | A working-tree edit or a commit on the branch no longer moves it. A same-user process can still move local refs (a commit on local `main` without a remote, or a rewritten remote-tracking ref). |
| Hook and launcher implementation | an installed `gantry` outside the checkout, same major as `SUBSTRATE.version.json` pins and at least that version (MSN-0381 for the git hooks, MSN-0385 for the MCP launcher, the Cursor sessionStart hook and the runtime-env script); `dist/` only with a human's `GANTRY_HOOK_LOCAL_BUILD=1` (hooks) or `GANTRY_MCP_LOCAL_BUILD=1` (launchers) | See B14. The installed binary lives in the user's home or a system prefix; the sandbox must deny writes there. The scripts that resolve it are checkout files. |
| Break-glass note in CI | `refs/notes/gxt-bypass`; since MSN-0385 counted only when version 2, naming the commit, and SSH-signed by a key `PLANNER.signing.pub` at the pull request's base lists for its signer (`packages/core/src/trusted-automation.ts`) | Before, any well-formed note counted, with no proof of the secret. The note is attribution, not a boundary: an `[MSN-NNNN]` subject passes without one, and a pull request can edit the workflow or the verifier; in this repository the checking `gantry` is built from the base commit. Branch protection and review of workflow changes are the boundary. A Planner key a same-user process can read is as reachable as the secret was: `unproven` locally. |
| Trusted-automation actor | commit author email (`trusted-automation.ts:53-56`) | Forgeable; config is read from the tree under check. |
| Perimeter signature check | `%G?` accepted as `G` or `U` (`perimeter.ts:127`) | No signer identity binding; `U` (validity unknown) passes. |
| Session cage plan | in-memory plan plus journal under the git dir (`cage-journal.ts`) | Tamper-checked by hash (`cage.test.ts:673`); good precedent for broker-held state. |
| Admission broker state (slice 3, MSN-0386; transport MSN-0394) | permit ledger and epoch in broker memory; instance lock in `~/.opengantry/admission/<repo key>/`; journal in `<git dir>/opengantry/admission/journal.jsonl`; socket under `$XDG_RUNTIME_DIR/opengantry/`, reached by the agent only through gantry's MCP server (`gxt_admission_request`, outside the sandbox; `gantry admission launch` sets `GANTRY_BROKER_SOCKET`) | `gantry cage policy` denies the state dir and `.git/opengantry` (and a linked worktree's journal dir). Without a proven sandbox the same user can still read or cut the journal (verify catches a cut through the run-record anchor), connect to the socket, or `ptrace` the broker: every cell stays at its level, none is `prevention`. Sandboxed shell commands get no broker access: no inherited fd reaches them (srt and Node harnesses drop it), and srt's Unix-socket filter makes the socket path unreachable (canary with its rules under `bwrap --seccomp`; the full-srt canary waits for the AppArmor profile). Operator notes: [`reference/admission-broker.md`](../reference/admission-broker.md). |

Reused safely by the design: org policy floors (ADR-0042, fetched only by `gantry policy pull`, tighten-only), the Planner stamp and mission contract seal (RULES §6.1, ADR-0045), the run record (RULES §3) and the digest-only ledger (RULES §9).

## Sandbox probe, Ubuntu 26.04, 2026-11-17

`gantry admission probe` (MSN-0391, [guide](../guides/admission-probe.md)) runs 34 canaries through `@anthropic-ai/sandbox-runtime` 0.0.83, with the policy `gantry cage policy --agent claude-code` generates. Host: Ubuntu 26.04.1, kernel 7.0.0-43, bwrap 0.11.1, `apparmor_restrict_unprivileged_userns = 1`, socat 1.8.1.1 unpacked from Ubuntu's .deb into a scratch dir.

| Configuration | Result | Cells |
|---------------|--------|-------|
| Generated policy, seccomp helper on (what `srt` does, and Claude Code with the helper installed) | Does not start: the helper's nested user namespace is refused by AppArmor's `unpriv_bwrap` stacking. The probe refuses (`GXT_ADMISSION_PROBE_UNAVAILABLE`). | unchanged |
| Generated policy, no seccomp helper (`--diagnostic`; Claude Code without the optional helper) | Runs. **Blocked:** the home secret, both state dirs and `.git/opengantry`, read or written directly, through a symlink, a hardlink, `/proc/self/root` or `..`, and from nested `sh`, `node` and `python3`. Also blocked: a symlink swap, renaming `.git` aside, a new user namespace, an npm postinstall and loopback TCP, direct and through the proxy. The proxy canary authenticates with the proxy's credentials, and a positive control with the port allowlisted reaches the listener. **Escaped:** a same-user Unix socket outside; `systemd-run --user` over the session bus, which wrote outside the sandbox; and tokens in the launch environment (`GH_TOKEN`, `GITHUB_TOKEN`), which pass through. **Untested:** an inherited fd, because `srt` passes only stdio into the sandbox. | unchanged: no family can be proven |
| Broker socket (PR #370) | Without the helper: reachable, and the journal, `broker.json`, policy and `exec/` are unreadable and unchanged. With the helper, every `AF_UNIX` socket is refused, so the broker cannot be reached. On Linux the runtime cannot allow one socket path. | no cell; unproven |

Probe digest `c7be4b17d32e…` (diagnostic, identical over two runs), runtime digest `c6872618befe…`. `network.connect` would stay unproven even with every canary blocked: the generated policy does not set `strictAllowlist`, so Claude Code prompts the user for a new domain.

### With the AppArmor prerequisite (MSN-0395)

The owner then disabled `bwrap-userns-restrict` and installed an unconfined `/etc/apparmor.d/bwrap` profile with `userns` ([the steps, the undo and the trade-off](../guides/admission-probe.md#the-prerequisite-on-ubuntu)). The full mechanism ran: policy mode, seccomp helper applied, runtime digest `c6872618befe…`, socat 1.8.1.1.

| Configuration | Result | Families proven on this host |
|---------------|--------|------------------------------|
| Default policy, first run (probe digest `bdc7a4b28e37…`; superseded) | 33 of 34 canaries blocked. Its inherited-fd canary handed the runtime fd 3, which Node always closes, so it could not fail (PR #379 review). | (`workspace.write` was counted here in error) |
| Default policy (probe digest `07124421a829…`, identical over two runs) | 37 of 39 canaries blocked, the Unix socket and session bus escapes and all eight network canaries included. **Effect:** an inherited fd: fd 20, open on `.git/config` with fds 3–19 closed, was listed and written through inside the sandbox. **Effect:** `GH_TOKEN`, `GITHUB_TOKEN` and a planted token pass through, because the policy has no `sandbox.credentials.envVars` yet (PR #376). The broker socket is refused (EPERM) and its state is protected. | `process.spawn`, `dependency.materialize` |
| `--strict-network` (probe digest `6d085771e525…`, identical over three runs) | The same canary results, with `strictAllowlist` set. SOCKS5, `CONNECT` by hostname, the adjacent port, UDP and `[::1]` are blocked; the three proxy controls reach the listener. | the same, plus `network.connect` |

`artifact.read` stays unproven until the policy denies the token variables. `workspace.write` stays unproven until no inherited fd can reach the harness: the intended fix is a `gantry admission launch` that closes every fd above 2 before it execs the harness (follow-up). Proven rows say what they depend on in `evidence.note`. These results hold only on a host with the prerequisite. The matrix above cannot carry a host condition, so its cells do not change; `gantry admission capabilities --probe [--strict-network]` shows them per host.

## Observations for follow-up (not changed here)

Found during the inventory. Each needs its own issue or mission; this one changes no code.

1. `gxt_execute_legislation` checks the mission path with `assertMcpMissionWritePath` **after** `runLegislate` has written the file (`src/cli/mcp/mcp-execute-legislation.ts:45-55`). The check cannot stop the write it judges.
2. In `assertMcpSubstrateUpgradeWritePaths`, the authorized set is built from the same `plannedWrites` it iterates, so the forbidden-zone branch can never throw. Only the traversal check is effective (`packages/missions/src/substrate-write-guard.ts:53-68`). This matches ADR-0022's wording ("allowed only when explicitly listed"), but the guard does less than its error message suggests.
3. The `runtime exec` forbidden-zone scan resolves zones against cwd and ignores globs and symlinks (B12). The timeout signals the direct child only (B11).
4. The integration recipes (`templates/integrations/recipes/_preamble.md:22`, `claude-code.md`, `aider.md`, `openhands.md`, `antigravity.md`) and the published [Enforcement boundary](enforcement-boundary.md) page call `runtime exec` a "process boundary" that traps TMVC roots. The code checks forbidden zones and contract imports after the worker exits; that is `detection`, and TMVC roots are not checked.
5. The read guard is not wired in the shipped `.cursor/hooks.json` or in any Claude Code template, although the docs give both snippets.
6. The perimeter accepts `%G?` = `U` and binds no signer identity (`perimeter.ts:127`).

## Searched and not found

Across code, scripts and JSON (excluding `node_modules`, `dist`): `seccomp`, `landlock`, `bwrap`/`bubblewrap`, `sandbox-exec`/Seatbelt, `AppContainer`, `firejail`, `nsjail`, `unshare`, `chroot`, `ptrace`, eBPF, `fanotify`, `inotify`, `fs.watch` (watching is `setInterval` polling), `--ignore-scripts`, any `gh`/GitHub API mediation, any network allowlist. The only hits are ADR and docs prose.
