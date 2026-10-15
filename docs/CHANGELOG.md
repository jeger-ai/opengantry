# Changelog

Release history and upgrade notes for `@jeger-ai/opengantry`. Adopter runbooks describe **current** behavior without version tags — see [`index.md`](index.md).

Install: `npm install -g @jeger-ai/opengantry` or pin a specific release from this table.

---

## Release highlights

| Release | Highlights |
|---------|------------|
| **Unreleased** | **Shipped CI installs the iii integration example's dependencies before verifying missions.** `gxt-validate.yml` (`mission_verify`) and `gxt-attest-ingest.yml` run `npm ci --prefix examples/iii-integration` before `gantry verify`, so a mission whose gate runs the example's offline validator no longer fails with exit 2 for missing modules. Every iii example step, including the existing offline validate in the `manifest` job, now runs only when `examples/iii-integration/package-lock.json` exists, so repositories created by `gantry init` without the example skip it instead of failing (MSN-0263). **Cage on macOS:** cage resolves its root to the real path, so a root reached through a symlink (every macOS temp dir sits behind `/var` -> `/private/var`) keeps the git control rules on `.git/config`, `.git/hooks` and the active `core.hooksPath`; `gantry cage suggest` no longer proposes an active hooks path there, and its JSON `root` is the resolved path. A macOS CI job now runs every cage suite and the slim package tests. Linux and macOS are the tested platforms; Windows is not supported yet (MSN-0265). **Gate git isolation:** gate commands no longer inherit the variables that tell git which repository to use (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_NAMESPACE`). git sets `GIT_DIR` for hooks run in a linked worktree, so a pre-push `gantry verify` used to hand it to the gate, and git calls inside the gate (such as test fixtures in temp dirs) acted on the real repository; the gate now finds its repository from its working directory. `GIT_CONFIG_*` variables are still passed through (MSN-0266). **`gantry cage check`:** `gantry cage check --base <ref> [--head <ref>] [--json]` checks the commits in `base..head` against the cage rules and exits `3` when one changes a protected path, so the cage reaches every agent whose work ends in a commit, including IDE, desktop and cloud agents that cannot be wrapped. Rules come from the base commit, so a branch cannot loosen them; every commit counts, so a secret committed and removed again still fails; lockfiles are listed without failing; `--json` emits a digest-only `gantry.cage-check.v1`. Full package only. Docs now lead with `cage check` in CI and keep the session cage for scripted, non-interactive agent runs ([ADR-0050](../.gitagent/out-of-scope/ADR-0050-cage-diff-check.md)). **Session push guard:** it now sees the old path of a renamed protected file and protected paths edited inside a merge commit (MSN-0267). **`gantry cage watch`:** watches the protected files on disk in its own terminal, gitignored `.env` and `.git` hooks included, whichever agent or tool writes them; every change rings, notifies and asks you to accept (`a`) or reject (`r`) in the watch terminal only, no answer within 20 seconds (`--decision-timeout`) restores it, accept applies only to the content shown, a path rejected three times is restored without asking; `--json` emits `gantry.cage-watch.v1`. Full package only ([ADR-0050](../.gitagent/out-of-scope/ADR-0050-cage-diff-check.md) amendment, MSN-0268). |
| **v3.8.3** | **The standalone cage command is `gantry-cage`.** It matches `gantry cage` and the CLI's `gantry` naming. In `@jeger-ai/opengantry`, `opengantry-cage` stays as a silent alias for the same entry point, like `gapman` for `gantry`. The slim `@jeger-ai/opengantry-cage` package exposes only `gantry-cage`; `npx @jeger-ai/opengantry-cage -- <cmd>` is unchanged because npx runs a package's single bin. Help and `--version` name `gantry-cage`. Package names and behaviour are unchanged (MSN-0258). **Dependencies:** zod 4.6.5 (from 3.25.76; used only by the MCP server's tool registration, not by the `./kernel` export), eslint 10.12.0 and typescript-eslint 8.71.1 for development, and iii-sdk 0.24.4, acorn 8.19.0 and acorn-walk 8.3.5 in the iii integration example (MSN-0249). **Publishing:** releases are published through npm trusted publishing (GitHub Actions OIDC, no stored npm token) with provenance for both packages, including `@jeger-ai/opengantry-cage`, whose 3.8.2 was published by hand without it; a publish skips any version already on npm, so a partial release can be finished from `main` (MSN-0257, MSN-0259). Release (MSN-0260). |
| **v3.8.2** | **Cage survives being stopped, refuses protected files it cannot restore, and ships on its own.** **Signals:** SIGTERM, SIGHUP, and SIGINT off a terminal now terminate the command and every process it started (SIGTERM, grace, SIGKILL; no detached process group), then cage restores and exits; the report gains `trapped_signal`. **`kill -9` recovery:** a hash-verified journal under `<git dir>/gantry-cage-journal/` lets the next cage run kill orphans, restore the protected set and report `recovery` before it starts; a live earlier session or a corrupt journal fails closed with exit 2 (`GXT_CAGE_SESSION_ACTIVE`, `GXT_CAGE_JOURNAL_CORRUPT`) (MSN-0253). **Fail-closed caps:** a revert-rule file over `--max-file-bytes` or a set over the 64 MiB snapshot budget now stops cage before the command runs (exit 2, `GXT_CAGE_FILE_TOO_LARGE` / `GXT_CAGE_SNAPSHOT_BUDGET_EXCEEDED`) instead of running with it `detect_only`; [ADR-0048](../.gitagent/out-of-scope/ADR-0048-cage-trust-model.md) decision 8 (MSN-0254). **Slim package:** `npx @jeger-ai/opengantry-cage -- claude` installs only the cage (bundled from the same sources, `commander` as its only dependency, no native modules, no install scripts), published by the release workflow alongside `@jeger-ai/opengantry` (MSN-0252). **Governance:** [ADR-0049](../.gitagent/out-of-scope/ADR-0049-flight-level-decision-model.md) maps the technical flight levels onto the tighten-only artifact chain and keeps product management outside the substrate (MSN-0250). Help text, FEATURES and these notes (MSN-0255); release (MSN-0256). **Behaviour changes in a patch release:** see the upgrade notes. |
| **v3.8.1** | **Cage halts an agent that keeps rewriting a protected path.** When a revert-rule path is rewritten again after the contest limit of live restores (default 3), cage restores it once more and terminates the command and everything it spawned (SIGTERM, then SIGKILL after a short grace). The run ends with status `halted` and **exit 4**, the report carries `watch.halt` and `watch.contest_limit`, and the session log a `halt` event. Before, cage gave up on the path, marked it contested and restored it only at exit, so the agent kept running against the tampered file. Set the limit with `--contest-limit <n>` or `.cage.yaml` `contest_limit:`; `0` keeps the old behaviour. `.cage.yaml` also takes a top-level `mode:` default for its own `protect:` entries, never for built-in rules (MSN-0244). [ADR-0048](../.gitagent/out-of-scope/ADR-0048-cage-trust-model.md) amended with decision 7; README and FEATURES updated (MSN-0245). **Behaviour change in a patch release:** see the upgrade notes. |
| **v3.8.0** | **Per-project cage rules:** optional `.cage.yaml` at the cage root adds `protect:` paths and globs (`mode: revert\|report`) on top of the built-in set. It can only add: unknown or subtractive keys, aliases, `..` paths and report mode on a built-in path fail closed before the command runs (`GXT_CAGE_CONFIG_INVALID`); the file protects itself; baseline caps 5,000 files / 64 MiB (`GXT_CAGE_LIMITS_EXCEEDED`); cage warns when it is untracked or uncommitted. **`--allow-override <path>`** reports instead of restoring a path for one run, never for git control or `.cage.yaml`, always announced on stderr and in the report. The push guard checks the plan the session started with (MSN-0239). **`gantry cage suggest`** proposes rules (migrations, IaC, Docker, registry config, CODEOWNERS, other CI, git hook config, key files) to stdout or `.cage.yaml.suggested`, never `.cage.yaml`, and refuses inside a cage session (MSN-0240, MSN-0242). Trust model recorded in [ADR-0048](../.gitagent/out-of-scope/ADR-0048-cage-trust-model.md) (MSN-0243). |
| **v3.7.1** | **Cage for interactive sessions:** `gantry cage` now restores protected paths live while the command runs (default; `--watch-interval-ms`, `--no-watch` for exit-only), marks a path contested after 3 live restores and restores it once at exit, and prints nothing into the agent's screen beyond one start line and a bell per event (JSONL session log in the OS temp dir). **Session push guard:** the caged process tree gets a temporary `core.hooksPath` whose `pre-push` refuses outgoing commits touching protected paths and chains to the repo's own hooks; nothing is written to the repo. The report gains `watch` and `push_guard` summaries; change rows are unchanged (MSN-0237). Docs move from one-shot `claude -p` recipes to interactive sessions (MSN-0238). Restore, not blocking: committed changes stay in local history; `--no-verify` skips the guard. |
| **v3.7.0** | **Zero-config cage:** `gantry cage -- <cmd>` and standalone `opengantry-cage` bin (`npx -p @jeger-ai/opengantry opengantry-cage -- <cmd>`) snapshot CI configs, `.env*`, `.git/config` / hooks / `core.hooksPath` and manifest `forbidden_zones` in memory, run the command with inherited stdio, then restore protected changes and exit 3. Lockfiles are reported, not reverted; over-cap or over-budget files are `detect_only`; `--json` emits a digest-only `gantry.cage-report.v1`; `--report-only` skips restore (MSN-0233). Violation reports end with a `gantry init` upgrade footer and a one-line limits summary (MSN-0235). Docs: README "Try it in 60 seconds", FEATURES reference, ADOPTION step zero (MSN-0234). Detect-after-exit only: no read, network, or in-flight interception; use for one-shot headless runs. |
| **v3.6.0** | **Typed adapter gates fail closed:** `gate_adapter: tsc\|eslint` rejects a `gate_command` with unquoted `&&`, `||`, `;`, or line break at legislate and mission validate (`GXT_GATE_ADAPTER_MISCONFIG`); tsc/eslint parser self-diagnostic tests (MSN-0229, port of the never-landed MSN-0195). **Terminal-agent TMVC gate:** `gantry hooks install\|uninstall` arms the tracked pre-commit hook so `gantry tmvc guard --strict` blocks staged paths outside the pinned mission; `runtime env` prints repo-relative space-separated `GANTRY_TMVC_ROOTS`; `runtime env --aider` writes an Aider scope file (MSN-0227). **Optional contract drift index:** local sqlite-vec index at `.gitagent/planner/contracts.sqlite` (gitignored, advisory, never mission law); `gantry contract embed`, `legislate --from-intent --embedding-file\|--auto-embed`, `contract propose --embedding-file` (MSN-0226). **Internal:** `src/cli/lib` prefixes folded into directories (MSN-0228); public `exports` (`.`, `./kernel`) unchanged. |
| **v3.5.0** | **Cursor MCP launcher:** specimen and adopters share byte-identical `.cursor/mcp.json` (`./scripts/mcp-launcher.sh`; no mcp.json parity exemption). **Verify exports:** `--format sarif\|junit` writes the document only on stdout and diagnostics on stderr ([`CI.md`](CI.md)). **Experimental contract preflight:** `gantry contract preflight` / `gxt_preflight_contract` catalogs every `MANIFEST.json` skill; Jev 2000ms timeout or non-OK HTTP (including 500) falls open to the heuristic ([ADR-0046](../.gitagent/out-of-scope/ADR-0046-experimental-contract-preflight.md)). |
| **v3.4.0** | **Mission contracts (ADR-0045):** Planner-sealed inline `contract` + `contract_sha256` (tighten-only TMVC / forbidden / import cage). `gantry contract propose\|check\|show`, `gantry legislate --from-intent`, MCP `gxt_propose_contract`, draft token v3 (v2 still accepted). Verify `contract` phase (tamper + import sites including `import()` / `require()` / `export … from`). Runtime exports `GXT_ALLOWED_IMPORTS` / `GXT_BANNED_IMPORTS`; `runtime exec` reports `contract_violation`. Empty TMVC roots scan git-dirty sources (not the whole tree). |
| **v3.3.0** | **Breaking (kernel):** `verifyMission` is async. Git-native org control plane — tighten-only org policy floor (`gantry policy pull\|status\|diff`, ADR-0042); compliance ledger on `refs/gxt/ledger` with CAS append + `soc2-pack` export (ADR-0043); cross-repo `depends_on` + `gantry deps` / `release check` (ADR-0044). Receipt schema stays 0.2.0. Doctor/verify stay offline. |
| **v3.2.6** | `gantry report` localhost inspection dashboard (overview git metrics, mission timeline, capped verify-run ring, `/verify` drill-down); ADR-0040 findings blame schema v3 in CLI (MSN-0179); pluggable `gateExecAdapter` on `verifyMission` (MSN-0177); verify-run ring persistence + phase-clock remediation (MSN-0181) |
| **v3.2.3** | Docs — North Star [`MANIFESTO.md`](MANIFESTO.md); loop→graph terminology (`AGENT-GRAPH.md` rename, mission/verify graph language, retry edges); CLI onboarding UX strings |
| **v3.2.2** | **Breaking:** `package.json` `exports` map — public entrypoints `.` (CLI) and `./kernel` only; deep `dist/cli/lib/*` imports no longer resolve. Kernel library (`evaluateScope`, `verifyMission`, `verifyVerdictToken`); verdict HMAC tokens; `GIT_OPTIONAL_LOCKS=0` on git spawns; receipt-signing temp path collision fix |
| **v3.2.1** | Docs — `gantry legislate` as single entry point (gap analysis built in); `gxt_interrogate` documented for multi-turn halt only |
| **v3.2.0** | Interrogation gate (ADR-0039 / MSN-0149) — gap analysis built into `gantry legislate` (`gxt_interrogate` for multi-turn halt); first-class verify interrogation phase (`GXT_INTERROGATION_*` SARIF/JUnit); receipt v0.2.0 signed attribution + CI export (MSN-0143–0145); auditor pepper keyring (MSN-0148); MANIFEST `gate_commands` allowlists |
| **v3.1.1** | Local DX — flag→pin mission defaults (`gantry pin` / `unpin`), active-mission banner, `gantry receipt list\|show`, verify `--receipt` path feedback; thermo cleanups (verify context, command boundary) |
| **v3.1.0** | Hybrid hub/spoke readiness — `flight_telemetry` `hash_only`, `gantry attest` / `verify --receipt`, `doctor --policy` (ADR-0034); `bounded_content` trusted automation; advisory **performance judge** ([#62](https://github.com/jeger-ai/opengantry/issues/62)) via `PERFORMANCE_RUBRIC` + BYO `llm_verifiers` (ADR-0035); structured advisory `findings[]` on verify PASS |
| **v3.0.1** | Docs cleanup + thermo remediation; discovery scanner hardening; npm **3.0.1** |
| **v3.0.0** | Domain-agnostic governance layer — `gantry init --discover`, `gantry blueprint`, `gantry perimeter check`, content adapter (regex perimeter), standardized `findings[]` failure envelope for external executors |
| **v2.7.0** | Quality & governance consolidation — audit-severity net_loc verify bugfix, discriminated `VerifyPhaseFailure` union, typed trace failure kinds, verify pipeline collapse, shared command error boundary, `GantryUserError` naming (deprecated `Gapman*` aliases), governance backfill + release-squash policy |
| **v2.6.0** | Defensive profile completion — presets + severity tiers, file-scope / churn / test-to-code guards ([#88](https://github.com/jeger-ai/opengantry/issues/88)–[#91](https://github.com/jeger-ai/opengantry/issues/91)), `gantry init` profile onboarding ([#86](https://github.com/jeger-ai/opengantry/issues/86)) |
| **v2.5.0** | Adopter-ready cage — generic `arch check` roots ([#114](https://github.com/jeger-ai/opengantry/issues/114)), `TARGET_ARCHITECTURE.yaml` init scaffold ([#115](https://github.com/jeger-ai/opengantry/issues/115)), schema 0.2.0 ([#116](https://github.com/jeger-ai/opengantry/issues/116)), defensive profile + net LOC guard ([#87](https://github.com/jeger-ai/opengantry/issues/87), [#90](https://github.com/jeger-ai/opengantry/issues/90)) |
| **v2.4.0** | Architecture cage — `gantry arch fetch` ([#34](https://github.com/jeger-ai/opengantry/issues/34)), `gantry verify --format sarif\|junit` ([#36](https://github.com/jeger-ai/opengantry/issues/36)), `TARGET_ARCHITECTURE.yaml` + `gantry arch check` ([#15](https://github.com/jeger-ai/opengantry/issues/15)), `ARCHITECTURE_RUBRIC` advisory judge ([#16](https://github.com/jeger-ai/opengantry/issues/16)) |
| **v2.3.1** | **Breaking:** Planner/Executor rename ([#110](https://github.com/jeger-ai/opengantry/issues/110)) — `gantry planner`, `.gitagent/planner/`, `EXECUTOR_LOG.md`, `GXT_PLANNER_*` / `GXT_EXECUTOR_*` env vars (no aliases). ADR-gated cage: MCP write guard ([#14](https://github.com/jeger-ai/opengantry/issues/14)), break-glass ADR ([#17](https://github.com/jeger-ai/opengantry/issues/17)), optional `planner_signature` tier ([#37](https://github.com/jeger-ai/opengantry/issues/37)) |
| **v2.3.0** | Cage hardening — `gen:dogfood` ([#105](https://github.com/jeger-ai/opengantry/issues/105)), typed `kpiKind` ([#103](https://github.com/jeger-ai/opengantry/issues/103)), audience-tagged start ([#104](https://github.com/jeger-ai/opengantry/issues/104)), doctor EXECUTOR_LOG checks ([#38](https://github.com/jeger-ai/opengantry/issues/38)), TS/mjs parity ([#106](https://github.com/jeger-ai/opengantry/issues/106)), verify failure contract ([#102](https://github.com/jeger-ai/opengantry/issues/102)), legislate forbidden-zone warn ([#35](https://github.com/jeger-ai/opengantry/issues/35)); removed deprecated `upgrade --apply`/`--dry-run` parent flags |
| **v2.2.5** | Quality remediation — recursive test glob ([#99](https://github.com/jeger-ai/opengantry/issues/99)), dead code prune ([#100](https://github.com/jeger-ai/opengantry/issues/100)–[#101](https://github.com/jeger-ai/opengantry/issues/101)), mechanical cleanups ([#107](https://github.com/jeger-ai/opengantry/issues/107)) |
| **v2.2.4** | Unified gantry naming ([#94](https://github.com/jeger-ai/opengantry/issues/94)); docs positioning — Gantry.io disambiguation, vendor-neutral local governance ([#95](https://github.com/jeger-ai/opengantry/issues/95)–[#97](https://github.com/jeger-ai/opengantry/issues/97)) |
| **v2.2.3** | Declarative `trusted_automation` policy (`.gitagent/config.json`, `max_net_loc <= 5`, git-derived eval) ([#92](https://github.com/jeger-ai/opengantry/issues/92)) |
| **v2.2.2** | Time-to-Scaffold public benchmark (`examples/benchmark-agent/`, measured LOC matrix, adoption discovery docs) |
| **v2.2.1** | Verify-failure contract unification (`verify-failure-normalize`), race-safe `context-feed` writes, canonical verify presentation entrypoint |
| **v2.2.0** | `gantry context-feed`, `gantry audit-rigor`, `virtual_capture`, adoption UX (#30–#33), product positioning (#69), docs map (#76) |
| **v1.1.0** | Mission isolation (MSN-0024–0026), stale trace evidence, `verify --json`, doctor substrate drift; MSN-0031 fail-closed stale evidence + verify orchestration unification |
| **v1.0.0** | `gantry init --tutorial`, global `--audience`, adoption-first docs |
| **v0.9.0** | `gantry start`, `verify --fix`, `status --json`, `onboarding`, GXT error codes |

---

## Current substrate notes

- Substrate law: `MANIFEST.json` `schema_version` **0.5.0**; CLI **3.8.3** (see `package.json`).
- **Architecture boundaries:** maintain `TARGET_ARCHITECTURE.yaml` at repo root; run `gantry arch check <files…>` in mission gates.
- **Verify exports:** `gantry verify --format sarif|junit` for enterprise CI dashboards (`--json` alias unchanged). Diagnostics go to stderr; the document is the only stdout payload. GitHub Code Scanning and GitLab JUnit wiring: [`CI.md`](CI.md).
- **Typed adapter gates:** `gate_adapter: tsc|eslint` requires a single command. Unquoted `&&`, `||`, `;`, or line breaks fail closed with `GXT_GATE_ADAPTER_MISCONFIG` ([ADR-0041](../.gitagent/out-of-scope/ADR-0041-gate-adapter-routing.md)).
- **Contract drift index:** optional, local, and advisory. `better-sqlite3` and `sqlite-vec` load only when an embedding is supplied.
- **Experimental contract preflight:** `gantry contract preflight` / MCP `gxt_preflight_contract` (heuristic default; optional Jev). Jev reads every skill from `MANIFEST.json`. A 2000ms timeout or non-OK HTTP status (including 500) falls open to the offline heuristic. Advisory only — does not seal a contract ([ADR-0046](../.gitagent/out-of-scope/ADR-0046-experimental-contract-preflight.md)).
- **External architecture docs:** `gantry arch fetch` for `kind: external` pointers (doctor stays offline).
- **Config file format:** humans write YAML (missions, `TARGET_ARCHITECTURE.yaml`, `.cage.yaml`); the CLI writes JSON (receipts, ledger, KPI, tokens via `canonicalJson`); third-party formats stay native. `MANIFEST.json`, `config.json` and the pointer files stay JSON until a dedicated dual-read migration ([ADR-0047](../.gitagent/out-of-scope/ADR-0047-config-file-format.md)).

---

## Upgrade notes

### Unreleased (CI installs the iii integration example's dependencies — next release after v3.8.3)

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
