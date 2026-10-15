---
title: "Release notes"
description: "What changed in each release of @jeger-ai/opengantry and @jeger-ai/opengantry-cage. Upgrade steps and behaviour changes are in CHANGELOG.md."
section: reference
order: 6
---

# Release notes

Install the latest release with `npm install -g @jeger-ai/opengantry`, or pin a version from this list. Upgrade steps and behaviour changes for each version are in [`CHANGELOG.md`](https://github.com/jeger-ai/opengantry/blob/main/docs/CHANGELOG.md).

## Unreleased

- **Documentation reorganized** into cage, start, guides, concepts and reference sections, with navigation built from frontmatter and a structure check in validate. Old page paths remain as pointers.
- **Cage on macOS.** The cage resolves its root to the real path, so a root reached through a symlink, as every macOS temp directory is, keeps its git control rules. A macOS CI job runs every cage test. Linux and macOS are the tested platforms; Windows is not supported yet.
- **Shipped CI** installs the iii integration example's dependencies before verifying missions, and skips the example's steps in repositories that do not have it.

## 3.8

- **3.8.3** The standalone cage command is `gantry-cage`; `opengantry-cage` stays as an alias in the full package. Both packages are published through npm trusted publishing with provenance. zod 4 inside the MCP server.
- **3.8.2** The cage survives being stopped: SIGTERM, SIGHUP and non-terminal SIGINT terminate the agent's whole process tree and restore, and the next run recovers from a `kill -9` through a hash-verified journal. A protected file the snapshot cannot hold now stops the cage with exit `2` instead of running unprotected. The cage ships on its own as `@jeger-ai/opengantry-cage`.
- **3.8.1** The cage halts an agent that keeps rewriting a protected path (exit `4`, `--contest-limit`, `contest_limit:`). `.cage.yaml` gains a top-level `mode:` default for its own entries.
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
