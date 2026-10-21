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

- **Versions:** `MANIFEST.yaml` `schema_version` **0.5.0**; CLI **4.0.0** (see `package.json`).
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

### From v3.9.0 (packages, structural law, one name, YAML law files — v4.0.0)

v4.0.0 is the major ADR-0052 announced: the same commands, flags, exit codes and `GXT_*` error codes, with the renames and removals 3.x had deprecated done, and the law files humans write in YAML. Upgrade:

```bash
npm install @jeger-ai/opengantry@4          # or: npm install -g @jeger-ai/opengantry@4
gantry upgrade plan && gantry upgrade apply --mission .gitagent/missions/<MSN>.upgrade-v4.0.0.yaml   # managed assets: hook shims, CI workflow, runtime scripts
gantry migrate manifest && gantry migrate config && gantry migrate architecture-pointer && gantry migrate policy-pointer   # each only if the 3.x JSON file exists
gantry doctor
```

- **Breaking: one env prefix.** Every `GXT_*` environment variable is `GANTRY_*`: `GANTRY_REPO_ROOT`, `GANTRY_MISSION_FILE`, `GANTRY_MSN_ID`, `GANTRY_SKILL_KEY`, `GANTRY_FORBIDDEN_ZONES`, `GANTRY_ALLOWED_IMPORTS`, `GANTRY_BANNED_IMPORTS`, `GANTRY_EXECUTOR_LOG`, `GANTRY_LAST_ERROR_FILE`, `GANTRY_AUDIENCE`, `GANTRY_BYPASS_SECRET`, `GANTRY_MSN_SCAN_DEPTH`, `GANTRY_REQUIRE_INTERROGATION`, `GANTRY_TMVC_GUARD_STRICT`; `GXT_TMVC_ROOTS` is `GANTRY_TMVC_ROOTS_ABSOLUTE` (`GANTRY_TMVC_ROOTS` keeps its repository-relative list). Scripts and agent instructions that read the old names must switch; `gantry runtime env` prints the new ones and the shipped Cursor session hook reads them. `GXT_*` error codes are unchanged.
- **Breaking: the `gapman` names are gone.** The `gapman` bin, the `GAPMAN_*` env and `gapman.*` git config fallbacks and the `gapman` skill-key alias are removed (`gantry`, `GANTRY_*`, `gantry.*`); the strict pre-commit flag is `gantry.tmvcGuardStrict`. The deprecated kernel export `verifyMissionAsync` is removed; `verifyMission` stays.
- **Breaking: law files are YAML.** `gantry init` writes `.gitagent/foreman/MANIFEST.yaml`, `.gitagent/config.yaml`, `.gitagent/ARCHITECTURE.pointer.yaml` and `.gitagent/foreman/POLICY.pointer.yaml`. The 3.x JSON files are still read when the YAML form is absent; both present and different fails closed (`GXT_LAW_FILE_AMBIGUOUS`). `gantry migrate <file>` converts each deterministically and `gantry doctor` warns until it is done.
- **Breaking: parked features.** The contract drift index, the contract preflight (`gantry contract preflight`, `gxt_preflight_contract`), defensive profiles and virtual capture left the CLI (ADR-0052 A10); their code lives under `examples/`. `better-sqlite3`, `sqlite-vec`, `ajv` and `ajv-formats` are no longer dependencies.
- **Evidence is machine-written.** A mission with no `trace_rows` is verified by its run record `.gitagent/runs/<MSN>.json`, written by `gantry verify --record` on the tree it ran on (RULES §3). Trace rows in mission YAML are still read for 3.x missions and no longer required.
- **Hooks and scripts call the CLI.** Each git hook is one line, `gantry hook <name>`; the pre-push hook reads the ref lines git passes. `scripts/validate-gxt.sh`, `verify-pr-missions.sh`, `gxt-manifest-lib.mjs`, `gxt-resolve-mission.sh`, `gxt-pin-mission.sh` and `gxt-cursor-env.sh` are gone; CI and the runtime helpers call `gantry ci …`, `gantry runtime env` and `gantry pin`. `gantry upgrade apply` installs the new shims.
- **Structure under law.** This repository (and any adopter who wants it) runs `gantry arch check` with `budget`, `owner`, `registry`, `dependency` and `duplicate` rules in `TARGET_ARCHITECTURE.yaml` 0.4.0, against a committed `ARCH_BASELINE.json` that only `--ratchet` moves; registries under `.gitagent/registry/` make a new error code, env name, subcommand, MCP tool or dependency a Planner edit.
- **Behaviour change: protected directories.** The cage, mission scope and `gantry verify --contract` judge paths with one rule table (`packages/core/src/path-law.ts`, [ADR-0053](../.gitagent/out-of-scope/ADR-0053-one-path-law.md)). Every cage pattern now also covers a directory: a directory named like a protected file (`.env/`, `x.pem/`) has its contents protected by that rule. Nothing else the cage protects, restores or reports changes.
- **Behaviour change: org perimeter.** The org policy's `manifest_constraints.perimeter_protected_add` is now applied as [ADR-0042](../.gitagent/out-of-scope/ADR-0042-org-policy-bundle.md) says. Those paths join the perimeter for `gantry perimeter` and for trusted automation's `bounded_content` rule. If the org policy cannot be read, `gantry perimeter --ci` fails with a violation that names `(org policy)` (locally it is an advisory) and trusted automation is not eligible. Trusted automation also uses the default protected paths when `MANIFEST` lists none. Repositories whose org floor does not set the field see no change.
- **Kernel:** `VerifyOptions` gains `warn?: (message: string) => void`, where verify sends its diagnostics. `verifyMission` keeps printing them to stderr; a direct caller of `buildVerifyResultPayload` that sets no `warn` no longer gets them on stderr.
- **Slim cage package:** `@jeger-ai/opengantry-cage` bundles the CLI's own cage entry. The bin, the files and the push guard are unchanged. In the full package, `gantry-cage cage-guard pre-push` now runs the push guard instead of caging a command named `cage-guard`.
- **This repository:** the source moved into the packages `verify` and `missions`, and `src/cli/lib/` is gone (`src/cli/output`, `mcp`, `doctor`, `report`, `init`, `flows`). The generated version file is `packages/core/src/version.gen.ts`. Adopters are unaffected: the published entry points are `.` and `./kernel` ([ADR-0054](../.gitagent/out-of-scope/ADR-0054-finish-the-package-graph.md)).
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
- **Also new:** `gantry ci msn-range|verify-missions|trusted-automation|upgrade-tmp`, `gantry migrate …`, one reporter for human, `--json`, SARIF and JUnit output with `--audience` as a presenter parameter, zod schemas with the YAML JSON-Schema files generated from them, a conformance suite the published commands must pass byte for byte.
- **Unchanged:** the cage trust model and the diff check, the ledger, receipts, exit `3` and `4` for the cage, `verifyMission`.

#### The unreleased 3.9 line, now part of 4.0.0 (cage dependency freeze, standalone verify contract and cage scope mode)

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
- **Unchanged:** `gantry verify --mission` and its formats. `--format sarif|junit` with `--contract` exits `2` until the slim package mission.
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

### From v3.8.1 (cage signals, kill -9 recovery, fail-closed caps, slim package — v3.8.2)

```bash
npm install @jeger-ai/opengantry@3.8.2
npx @jeger-ai/opengantry-cage@3.8.2 -- claude   # the slim cage, new in this release
```

- **Behaviour change, signals:** SIGTERM or SIGHUP sent to cage, or SIGINT when its stdin is not a terminal, used to be forwarded to the command while cage waited; background jobs of a nested shell kept running. Cage now terminates the whole enumerated tree, restores, and exits `3` if anything was restored, otherwise with the command's own exit code (`128 + N` when the signal killed it). Ctrl-C on a terminal is unchanged: it reaches the agent and cage keeps running.
- **Behaviour change, caps:** a revert-rule file over `--max-file-bytes` (default 5 MiB), or revert-rule bytes over the 64 MiB snapshot budget, now exit `2` before the command runs (`GXT_CAGE_FILE_TOO_LARGE` lists every path and size; `GXT_CAGE_SNAPSHOT_BUDGET_EXCEEDED` gives the total). Before, the run started and the file was `detect_only`: reported, never restored. Raise `--max-file-bytes`, or pass `--allow-override <path>` to report that path instead (announced in every report). `--report-only` is unaffected.
- **New journal:** each session writes `<git dir>/gantry-cage-journal/` (files `0600`, with copies of protected file bytes such as `.env`) and removes it at a clean exit. After a `kill -9` on cage, the next cage run in that repo recovers it first. Two new exit-2 cases: an earlier cage session still running (`GXT_CAGE_SESSION_ACTIVE`) and a journal that fails its hash check (`GXT_CAGE_JOURNAL_CORRUPT`; inspect it, then remove the directory).
- **Report additions:** `trapped_signal` and `recovery`; `detect_only` is no longer produced for revert-rule files. Existing fields are unchanged and `report_schema` stays `gantry.cage-report.v1`.
- **New package:** `@jeger-ai/opengantry-cage` is published from `packages/opengantry-cage/` with v3.8.2, at the same version as `@jeger-ai/opengantry`. `npx -p @jeger-ai/opengantry opengantry-cage` keeps working.

### From v3.8.0 (cage contested-file halt — v3.8.1)

```bash
npm install @jeger-ai/opengantry@3.8.1
```

- **Behaviour change:** a protected path rewritten again after 3 live restores now terminates the wrapped command and every process it started, and cage exits `4` instead of `3`. Scripts and CI that treat any non-zero cage exit as failure need no change; scripts that check for exactly `3` should also accept `4`.
- **Keep the old behaviour:** pass `--contest-limit 0` or set `contest_limit: 0` in `.cage.yaml`. The path is then marked contested and restored once at exit, as in v3.8.0.
- **Legitimate rewriters:** a dev server or tool that rewrites a protected file (for example `.env.local`) will now halt the session. Run it with `--allow-override <path>` for that run; overridden and report-mode paths never halt.
- **Report additions:** `watch.contest_limit` and `watch.halt` (`path`, `rule`, `live_restores`, or null); status `halted`. Existing fields are unchanged and `report_schema` stays `gantry.cage-report.v1`.
- **New `.cage.yaml` keys:** top-level `mode:` (default for the file's own entries only) and `contest_limit:`. Both fail closed when invalid (`GXT_CAGE_CONFIG_INVALID`, exit 2).

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
