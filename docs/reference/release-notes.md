---
title: "Release notes"
description: "What changed in each release of @jeger-ai/opengantry and its slim cage and verify packages. Upgrade steps and behaviour changes are in CHANGELOG.md."
section: reference
order: 6
---

# Release notes

Install the latest release with `npm install -g @jeger-ai/opengantry`, or pin a version from this list. Upgrade steps and behaviour changes for each version are in [`CHANGELOG.md`](https://github.com/jeger-ai/opengantry/blob/main/docs/CHANGELOG.md).

## 4.0

- **4.0.2** `gantry cage policy --agent claude-code` prints Claude Code sandbox and permission settings built from the cage's rules and the read guard's secret list, for you to review and merge into `.claude/settings.json`; `--contract` adds a verify contract's forbidden paths. Full package only. Details: [Agent sandbox settings](../cage/policy.md).
- **4.0.1** The CI workflow `gantry init --ci` and `gantry upgrade` install works in your repository: it installs `@jeger-ai/opengantry` from npm and runs only `gantry` commands, with the job names `pr_governance`, `manifest`, `msn_commits` and `mission_verify`. 4.0.0 shipped a copy of this repository's own CI, which built the CLI from source and failed elsewhere. If `gantry upgrade` already installed it, `gantry upgrade plan --stage` and `gantry upgrade apply` replace it. The `gxt-attest-ingest.yml` template is fixed the same way.
- **4.0.0** The major the rewrite record announced: the same commands, flags, exit codes and `GXT_*` error codes; the deprecated names gone; law files in YAML.
  - **Fewer commands.** `report`, `metrics`, `audit-rigor`, `context-feed`, `scan` (with the KPI gate), `blueprint`, `init --discover`, `domains`, `register`, `check-imports`, `triage`, `start`, `status` and `check` are gone; `pin`/`unpin`, `hooks` and `release check` moved under `mission`, `hook` and `deps check --since`; MCP keeps 12 tools, and `gantry upgrade plan --stage` stages a substrate upgrade from the CLI ([upgrade notes](https://github.com/jeger-ai/opengantry/blob/main/docs/CHANGELOG.md) name the replacements).
  - **One env prefix.** Every `GXT_*` session variable is `GANTRY_*` (`GXT_TMVC_ROOTS` is `GANTRY_TMVC_ROOTS_ABSOLUTE`); the legacy CLI alias bin, its env and git-config fallbacks and its skill alias are removed (`gantry`, `GANTRY_*`, `gantry.*` only); `verifyMissionAsync` is removed.
  - **YAML law files.** `gantry init` writes `MANIFEST.yaml`, `config.yaml`, `ARCHITECTURE.pointer.yaml` and `POLICY.pointer.yaml`; the 3.x JSON files are still read; `gantry migrate <file>` converts them and `gantry doctor` says when to.
  - **Machine-written evidence.** `gantry verify --record` writes a run record a rowless mission is verified by; trace rows are optional.
  - **Hooks and scripts call the CLI.** One-line hook shims (`gantry hook <name>`), `gantry ci …` in CI, the runtime helper scripts removed.
  - **Structural law.** `gantry arch check` gains `budget`, `owner`, `registry`, `dependency` and `duplicate` rules with a ratcheting baseline; registries under `.gitagent/registry/`.
  - **Packages.** `core`, `git`, `cage`, `plane`, `verify` and `missions` are workspace packages; `src/cli` is only the command line and the MCP server. Zod replaces ajv, there is one output reporter, and a conformance suite freezes the public commands.
  - **One path law.** The cage, mission scope and `gantry verify --contract` decide whether a path may change with one rule table in core. One behaviour change: a directory named like a protected file (`.env/`, `x.pem/`) now has its contents protected too.
  - **Org perimeter applied.** The org policy's `manifest_constraints.perimeter_protected_add` was accepted and ignored. Its paths are now protected by `gantry perimeter` and by trusted automation, and an org policy that cannot be read fails `gantry perimeter --ci`.
  - **Parked.** The contract drift index, contract preflight, defensive profiles and virtual capture live under `examples/`; `better-sqlite3`, `sqlite-vec`, `ajv` and `ajv-formats` are gone from the dependencies.
  - **Cage.** Dependency freeze (`dependencies: revert`, `--lock-deps`), scope mode (`allow_only:`, `--allow-only`), `gantry verify --contract` without `.gitagent/`.
  - **Plan adapters.** `gantry adapt --from lights-on` turns a plan's file lists into a `verify.yaml` and the cage scope for that step.
  - **Test integrity.** A `tests` section in `verify.yaml` fails a change that deletes tests, lowers the assertion count, adds `.skip`/`.only`, asserts `true` or swallows errors in an empty catch.
  - **Standalone verify in CI.** `gantry verify --contract --format sarif|junit` prints the result for code scanning and test dashboards; `--sign keyless` signs it with Sigstore through the CI job's OIDC identity, and `--check-result --certificate-identity` checks who signed it. The new package `@jeger-ai/opengantry-verify` ships it on its own: `npx @jeger-ai/opengantry-verify --base origin/main`, and a typed library API.
  - **Dependency bumps without a mission.** Dependabot's npm bumps pass the mission checks under the new trusted-automation kind `dependency_update`, which refuses anything that is more than a bump.
  - **Read guard.** `gantry-cage read-guard` is a Claude Code and Cursor hook that refuses tool calls reading `.env` files, git credentials, SSH keys and cloud credentials, so they never reach the model.
  - **Dependencies:** `@modelcontextprotocol/sdk` 1.32.1 at least (earlier versions have published advisories), `@clack/prompts` 1.8 and zod 4.6.7; hono 4.13.13 in the lockfile.

## 3.9

- **3.9.0** Two new cage commands bring the cage to every agent: `gantry cage check` checks commits and `gantry cage watch` asks you about every change to a protected file on disk.
  - **`gantry cage check`** checks the commits in `base..head` against the cage rules and exits `3` when one changes a protected path, so the cage reaches every agent whose work ends in a commit, including IDE, desktop and cloud agents that cannot be wrapped. The rules come from the base commit, every commit in the range counts, and `--json` emits a digest-only report. Full package only. The docs now lead with the check in CI and keep the session cage for scripted, non-interactive runs.
  - **`gantry cage watch`** watches the protected files on disk in its own terminal, gitignored `.env` and `.git` hooks included, and asks you to accept or reject every change; no answer within 20 seconds restores it, accept applies only to the content shown, and a path rejected three times is restored without asking. Full package only.
  - **Session push guard** also refuses a push whose commits rename a protected file away or edit a protected path inside a merge commit.
  - **Documentation reorganized** into cage, start, guides, concepts and reference sections, with navigation built from frontmatter and a structure check in validate. Old page paths remain as pointers.
  - **Cage on macOS.** The cage resolves its root to the real path, so a root reached through a symlink, as every macOS temp directory is, keeps its git control rules. A macOS CI job runs every cage test. Linux and macOS are the tested platforms; Windows is not supported yet.
  - **Shipped CI** installs the iii integration example's dependencies before verifying missions, and skips the example's steps in repositories that do not have it.
  - **Dependencies:** yaml 2.9.1 and `@modelcontextprotocol/sdk` 1.32.1 (lockfile only), `@eslint/js` 10.0.1 for development, and TypeScript 7.0.2 in the iii integration example.
  - **Gates in linked worktrees.** Gate commands and test processes no longer inherit repository-locating `GIT_*` variables from hooks, so a gate run from a hook in a linked worktree acts on the repository at its working directory.

## 3.8

- **3.8.3** The standalone cage command is `gantry-cage`; `opengantry-cage` stays as an alias in the full package. Both packages are published through npm trusted publishing with provenance. zod 4 inside the MCP server.
- **3.8.2** The cage survives being stopped: SIGTERM, SIGHUP and non-terminal SIGINT terminate the agent's whole process tree and restore, and the next run recovers from a `kill -9` through a hash-verified journal. A protected file the snapshot cannot hold now stops the cage with exit `2` instead of running unprotected. The cage ships on its own as `@jeger-ai/opengantry-cage`. A protected path rewritten again after 3 live restores halts the agent (exit `4`, `--contest-limit`, `contest_limit:`), and `.cage.yaml` gains a top-level `mode:` default for its own entries. No 3.8.1 was published.
- **3.8.0** Per-project cage rules: `.cage.yaml` adds paths and globs, can only add protection, protects itself and fails closed. `gantry cage suggest` proposes rules for review. `--allow-override <path>` relaxes one path for one run, always announced.

## 3.7

- **3.7.1** The cage restores protected paths live during interactive sessions and refuses `git push` of them from inside the session.
- **3.7.0** Zero-config `gantry cage -- <cmd>` restores CI configs, `.env*`, git hooks and config, and manifest forbidden zones after an agent run, reports lockfile changes, and exits `3` on tampering.

## 3.6 to 3.0

- **3.6.0** Typed `tsc` and `eslint` gate adapters fail closed on chained commands. `gantry hooks install` makes the pre-commit scope check block. Optional local contract drift index.
- **3.5.0** Byte-identical Cursor MCP launcher. `gantry verify --format sarif|junit` writes only the document on stdout. Advisory, fail-open contract preflight.
- **3.4.0** Mission contracts: a Planner-sealed, tighten-only scope and import cage per mission, with `gantry contract propose|check|show` and `gantry legislate --from-intent`.
- **3.3.0** Git-native org control plane: tighten-only org policy floor, compliance ledger on `refs/gxt/ledger` with a SOC 2 export, cross-repository `depends_on`. Breaking for the kernel: `verifyMission` is async.
- **3.2.6** `gantry report` localhost dashboard. Findings schema v3. Pluggable gate execution in `verifyMission`.
- **3.2.3** The manifesto, and graph terminology for missions and retry edges.
- **3.2.2** Breaking: the package exposes only `.` (the CLI) and `./kernel`. Kernel library with `evaluateScope`, `verifyMission` and HMAC verdict tokens.
- **3.2.1** `gantry legislate` as the single entry point, with gap analysis built in.
- **3.2.0** Interrogation gate: legislation refuses to proceed until every computed gap has an operator answer. Signed receipt attribution and CI export.
- **3.1.1** `gantry pin` and `unpin`, an active-mission banner, `gantry receipt list|show`.
- **3.1.0** Hash-only flight telemetry, `gantry attest` and `verify --receipt`, `doctor --policy`. `bounded_content` trusted automation. Advisory performance judge.
- **3.0.1** Documentation cleanup and discovery scanner hardening.
- **3.0.0** A domain-agnostic governance layer: `gantry init --discover`, `gantry blueprint`, `gantry perimeter check`, the content adapter, and the standard `findings[]` envelope.

## 2.x

- **2.7.0** Quality and governance consolidation: typed verify failures, a single verify pipeline, `GantryUserError` naming.
- **2.6.0** Defensive profile presets and severity tiers; file-scope, churn and test-to-code guards; profile onboarding in `gantry init`.
- **2.5.0** Generic `arch check` roots, a `TARGET_ARCHITECTURE.yaml` scaffold, schema 0.2.0, the net lines-changed guard.
- **2.4.0** `gantry arch fetch`, `gantry verify --format sarif|junit`, `TARGET_ARCHITECTURE.yaml` with `gantry arch check`, the advisory architecture rubric.
- **2.3.1** Breaking: Planner and Executor naming (`gantry planner`, `.gitagent/planner/`, `EXECUTOR_LOG.md`, `GXT_PLANNER_*`, `GXT_EXECUTOR_*`). MCP write guard, break-glass, optional Planner signature tier.
- **2.3.0** Generated dogfood scripts, audience-tagged `start`, doctor checks for `EXECUTOR_LOG.md`, a unified verify failure contract. The deprecated `upgrade --apply` and `--dry-run` parent flags were removed.
- **2.2.5** Quality remediation: recursive test discovery, dead code removal.
- **2.2.4** Unified `gantry` naming; positioning as vendor-neutral local governance, distinct from Gantry.io.
- **2.2.3** Declarative `trusted_automation` policy.
- **2.2.2** The public time-to-scaffold benchmark.
- **2.2.1** One verify-failure contract; race-safe `context-feed` writes.
- **2.2.0** `gantry context-feed`, `gantry audit-rigor`, virtual capture.

## 1.x and earlier

- **1.1.0** Mission isolation, stale trace evidence, `verify --json`, doctor substrate drift.
- **1.0.0** `gantry init --tutorial`, global `--audience`.
- **0.9.0** `gantry start`, `verify --fix`, `status --json`, `onboarding`, `GXT_*` error codes.
