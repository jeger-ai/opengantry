---
id: ADR-0048
title: Cage trust model — built-in floor, additive project rules, relaxation only at run time
status: ACTIVE
match_terms:
  - cage
  - .cage.yaml
  - allow-override
  - cage suggest
  - protected set
  - relax
  - exclude
  - lock-deps
  - dependency freeze
  - allow_only
  - allow-only
  - scope mode
---

## Context

`gantry cage` started with a fixed protected set: CI configs, `.env*`, git hooks and config, lockfiles (report only), and manifest `forbidden_zones` when a manifest exists. Projects need to protect more (migrations, IaC, `Dockerfile`, key files), and some need to relax a rule for one run (for example a dev server that rewrites `.env.local`).

The obvious design, a per-project config file that can add *and* remove rules, is a trap:

- **Untrusted repos.** A cloned repo or a malicious PR can commit a weakened config. Running cage on that checkout silently loses the guarantees people expect from the tool, and "zero-config" stops meaning one thing.
- **The agent edits the policy.** If the caged agent can write the config, or call a tool that writes it, containment becomes the agent agreeing with itself.
- **Wrappers carry flags.** A relaxation flag can also be committed, in `package.json` scripts, a `Makefile` or `.envrc`. Cage cannot tell whether a human typed it.

The same tighten-only shape already governs org policy ([ADR-0042](ADR-0042-org-policy-bundle.md)): the floor comes from outside the repo, and local files can only raise it.

## Decision

1. **Built-in rules are a floor.** Nothing in the working tree can remove or weaken a built-in rule.
2. **`.cage.yaml` only adds.** The file at the cage root has a `protect:` list of `{path}` or `{glob}` entries, each with an optional `mode: revert|report`, plus four optional top-level keys: `mode:`, the default for `protect:` entries that set none, `contest_limit:` (see 7), `dependencies:` (see 9) and `allow_only:` (see 10).
   - Unknown keys, subtractive keys (`relax`, `exclude`, `allow`, …), absolute or `..` paths, YAML aliases, and `mode: report` on a path a built-in rule reverts are rejected before the command runs (`GXT_CAGE_CONFIG_INVALID`, exit 2). Format rules follow [ADR-0047](ADR-0047-config-file-format.md): humans write it, so it is YAML with a strict schema.
   - The top-level `mode:` default applies to the file's own `protect:` entries only. It never touches a built-in rule, and a default of `report` that would land on a path a built-in rule reverts is rejected the same way as a per-entry `mode: report` (amended by MSN-0244).
   - `.cage.yaml` is itself a built-in revert target, present or not. An edit during the session is restored, and a file created during the session is removed.
   - It is read from the working tree, not `HEAD`. Because it can only add, the worst an unreviewed file can do is protect too much. Caps bound that (5,000 files or 64 MiB at the baseline; `GXT_CAGE_LIMITS_EXCEEDED`), and cage warns when the file is untracked or differs from `HEAD`.
3. **Relaxation is a runtime flag, and it is always announced.** `--allow-override <path>` downgrades matching revert rules to report for one run. It never removes the path from the report.
   - It is refused for `git_control` paths, for `.cage.yaml`, and for paths that match no revert rule (`GXT_CAGE_OVERRIDE_INVALID`).
   - Every run that uses it prints a banner on stderr at start and in the exit summary. The JSON report lists `overrides[]` and marks affected rows `overridden: true`.
   - The guarantee is that **relaxations are never silent**, not that they never come from the repo: a committed wrapper script can still pass the flag.
4. **Rule authoring stays outside the agent loop.**
   - No MCP tool reads or writes cage rules ([ADR-0022](ADR-0022-mcp-write-containment.md)).
   - `gantry cage suggest` only proposes. It prints, or writes `.cage.yaml.suggested`, never `.cage.yaml`, and cage never reads the proposal. It refuses to run inside a cage session (`GANTRY_CAGE_SESSION`, `GXT_CAGE_SUGGEST_IN_SESSION`).
   - A human reviews the proposal, moves what they keep into `.cage.yaml`, and commits it.
5. **One plan per session.** Live restore, override validation and the session push guard classify paths with the same rules. The push guard reads the plan the session started with, so an in-session edit to `.cage.yaml` cannot loosen it.
6. **Reports stay digest-only** ([ADR-0034](ADR-0034-hybrid-hub-spoke-metadata-plane.md)). Rows gain `source` (`builtin`, `manifest`, `cage_yaml`) so a reviewer can see where each rule came from.
7. **A path that keeps being rewritten halts the command** (amended by MSN-0244). Cage used to give up after three live restores, mark the path contested and restore it once at exit, which left an agent in a write loop running against the tampered file for the rest of the session. Now, when a revert-rule path is rewritten again after `contest_limit` live restores, cage restores it once more, sends SIGTERM to the command and every descendant it can enumerate, waits a grace period, and SIGKILLs what is left. The run ends with status `halted` and exit `4`, distinct from `3` (restored and finished), and the report names the path (`watch.halt`).
   - The limit resolves `--contest-limit <n>`, then `.cage.yaml` `contest_limit:`, then the built-in default of 3. `0` turns the halt off and keeps the contested-at-exit behaviour. Report-mode paths, overridden paths and `--report-only` runs never halt, because nothing is being restored.
   - The command is not spawned as its own process group: a detached child loses the terminal's foreground group and interactive agents would be stopped on SIGTTIN. The tree is enumerated instead, so a descendant that is reparented between the two passes can survive; the limits list says so.
   - This is enforcement of the same rules, not a new rule, and the limit is not a relaxation: raising it only delays the halt, and the built-in rules still restore every change up to it.
8. **A protected file the snapshot cannot hold stops the run before it starts** (amended by MSN-0254). The baseline keeps revert-rule bytes in memory, bounded by the per-file cap (`--max-file-bytes`, default 5 MiB) and the total budget (64 MiB). A file over the cap, or a set whose revert-rule bytes exceed the budget, used to be captured `detect_only`: hashed, change-detected, but never restored, which left a protected path that cage silently could not defend. Now such a baseline ends the run before the command spawns, exit `2` with `GXT_CAGE_FILE_TOO_LARGE` (every offending path and size listed) or `GXT_CAGE_SNAPSHOT_BUDGET_EXCEEDED` (the total against the budget): the same fail-closed shape as the decision 2 scan caps (5,000 files or 64 MiB, `GXT_CAGE_LIMITS_EXCEEDED`). `detect_only` is no longer produced.
   - Exit `2` is a setup refusal, distinct from exit `3` (a protected path changed and was restored or reported) and exit `4` (the contested-file halt).
   - The ways through are the ones this ADR already allows: a higher `--max-file-bytes` on the command line, or `--allow-override <path>` (decision 3, always announced) to report that path instead of restoring it. `--report-only` keeps no bytes and is unaffected. Nothing in the working tree can lift the cap.
9. **Dependencies can be frozen, and freezing only tightens** (amended by MSN-0275). By default the built-in `lockfile` rule reports and dependency manifests are not protected, because package managers rewrite lockfiles as part of ordinary work. A task that needs no new packages can freeze them: `.cage.yaml` top-level `dependencies: revert`, or `--lock-deps` on the session (`gantry cage -- <cmd>`, `gantry-cage`), `cage watch` and `cage check`.
   - Under the freeze, the `lockfile` rule (the 13 built-in lockfile names) is `revert`, and a built-in `dependency_manifest` rule matches `package.json`, `pyproject.toml`, `Pipfile`, `requirements*.txt`, `Cargo.toml`, `go.mod`, `Gemfile` and `composer.json` by basename anywhere in the tree (the same scan and skip dirs as `.env*`), also `revert`, except under a `vendor/` path segment: `composer install` and `cargo vendor` write one manifest per installed package there, which is install output, not the project's manifests. Lockfiles have no such exception. Freezing the lockfile alone would not be enough: a dependency or a `postinstall` script added to `package.json` would come back with the next non-frozen install.
   - Decisions 1-2 hold: `dependencies: report` is the default and loosens nothing, and a `protect:` entry with `mode: report` on a frozen path is refused as a downgrade of a built-in rule. There is no flag that turns the freeze off; the flag and the key only add.
   - Decision 3 holds: `--allow-override <path>` can relax a frozen path for one run, announced like any other override.
   - Decision 5 holds: the setting is part of the session plan, of the serialized plan the push guard reads, and of the journal, so an in-session `.cage.yaml` edit cannot change it and kill -9 recovery rebuilds the frozen plan. `cage check` reads it from the base commit like every other rule ([ADR-0050](ADR-0050-cage-diff-check.md)); `--lock-deps` on check adds to the base rules and never removes from them.
   - Decision 8 holds: frozen files are revert-rule bytes, so a lockfile over `--max-file-bytes` stops the run with `GXT_CAGE_FILE_TOO_LARGE`.
   - Reports name the rule (`lockfile`, `dependency_manifest`, both source `builtin`), and the session report, `gantry.cage-check.v1` and `gantry.cage-watch.v1` carry an additive `dependencies: "revert" | "report"` field so a reviewer can see whether the freeze was on.
   - **Limit:** cage restores files; it does not block the install. When an agent runs `npm install` against a tampered `package.json`, install-time scripts (`postinstall`, build scripts) have already run on the machine by the time cage restores the file. The freeze keeps an injected dependency out of the working tree, commits and PRs (session restore, push guard, `cage check` in CI); it does not stop install-time execution. That needs the package manager's own controls (`ignore-scripts`, a frozen install such as `npm ci`) or a harness that blocks the command.
10. **A scope protects everything outside an allowed area, and only tightens** (amended by MSN-0276). The protected set is a blocklist. A build task usually knows the opposite, the few directories an implementer may touch, so a scope turns the cage into a per-task sandbox without missions: `.cage.yaml` top-level `allow_only: [globs]`, or the repeatable `--allow-only <glob>` on the session, `cage watch` and `cage check`.
   - A glob that matches a path, or a directory above it, puts the path in scope. With both the key and the flag, a path is in scope only when it matches a glob of each list, so neither source can widen the other.
   - Every path outside the scope that git would track (tracked files, and untracked files that are not gitignored) gets the built-in `out_of_scope` rule in revert mode. Gitignored files outside the scope (dependencies, build output, caches) are not policed, so builds and installs keep working; paths under `.git` stay with `git_control`. Other rules still apply inside and outside the scope and keep their own rule id (a `.env` inside the scope is still `secrets`); a report-mode path outside the scope, such as an unfrozen lockfile, becomes `out_of_scope` and is restored.
   - Decision 2 holds: an empty `allow_only:`, a non-string entry or an absolute or `..` glob is refused (`GXT_CAGE_CONFIG_INVALID`; a bad flag value `GXT_CAGE_SCOPE_INVALID`). A `protect:` entry with `mode: report` on an out-of-scope path is not a downgrade: the path stays restored, because revert beats report.
   - Decision 3 holds: `--allow-override <path>` relaxes one out-of-scope path for one session run, announced.
   - Decision 5 holds: the scope is part of the session plan, the push guard's plan and the journal (the `--allow-only` globs), so an in-session `.cage.yaml` edit cannot change it. `cage check` reads `allow_only:` from the base commit ([ADR-0050](ADR-0050-cage-diff-check.md)); `--allow-only` intersects with it.
   - Decision 8 is not weakened, and does not apply: the out-of-scope baseline is not held in memory. At start the working tree is written to the repository's object store as a git tree through a temporary index (the real index, HEAD and refs are untouched), changes are found by blob id, and a restore reads the blob back through the checkout filters, with the file mode and symlink target. The journal names the tree, so kill -9 recovery restores out-of-scope changes. A scope needs a git work tree at the cage root; elsewhere the run refuses before the command spawns (exit `2`, `GXT_CAGE_SCOPE_NOT_GIT`).
   - Reports carry `scope` (the globs) and `scope_sources` (`cage_yaml`, `flag`).
   - **Limits:** cage restores, it does not block, so a write outside the scope can be used or committed before the next check; the push guard and `cage check` cover commits. A scope does not see gitignored files. A root `.gitignore` edit is itself out of scope and restored, after which the file it hid is caught on the next check, but a file hidden through `.git/info/exclude` or a global excludes file is not restored. Untracked files hashed for the baseline stay in the object store as unreachable objects until git's garbage collection removes them. A scope is not a mission contract ([ADR-0045](ADR-0045-mission-contracts.md)): no Planner seal, no import rules, no evidence; missions remain the tool for Planner-approved scope that a reviewer can verify.

## Consequences

- Zero-config keeps one meaning: without `.cage.yaml`, a run behaves exactly as before. With it, the protected set only grows.
- Projects that need a relaxation pass it on the command line and accept that it shows up in every report. There is no quiet way to turn a built-in rule off.
- A legitimate rewriter of a protected path, such as a dev server that regenerates `.env.local`, now halts the session instead of being tolerated after three restores. The operator passes `--allow-override .env.local` for that run (announced, as always) or sets `contest_limit: 0` in `.cage.yaml` to keep the old contested behaviour.
- Proposals to make cage rules subtractive in a file, to let an MCP tool edit them, or to let `cage suggest` write `.cage.yaml` directly reopen this ADR and need a Planner mission that supersedes it.
- A project that freezes dependencies cannot add or upgrade a package in a caged run without an announced `--allow-override`, and `cage check` fails a PR that changes a lockfile or manifest once the freeze is committed at base. Dependency updates then go through a run or a PR where the freeze is deliberately off, which is the point.
- A task run with a scope cannot leave edits outside its area in the working tree, and `cage check` fails a PR that touches paths outside a scope committed at base. Shared files a task legitimately needs (a route table, a schema) must be in its scope, or the change is restored; that is the point, and `--allow-override` covers the exception for one run.
- A repository with a protected file over 5 MiB, or more than 64 MiB of protected bytes, now refuses to start a cage session instead of running with a hole in the protected set. The operator raises the cap or passes `--allow-override` for that path, and either shows up in the report.
- Cage still restores rather than blocks individual writes: a change can be used in the gap before the next check, and past the contest limit cage terminates the command rather than preventing the write. This ADR is about who can change the rules and how far cage goes when they are broken; missions remain the tool for scope enforced on every write. Blocking at the operating-system level is left to the agents' own sandboxes, configured from the cage's rules ([ADR-0060](ADR-0060-agent-sandbox-policy.md)).
