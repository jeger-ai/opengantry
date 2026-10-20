---
id: ADR-0053
title: One path law — the cage, mission scope and standalone verify judge paths with one rule table
status: ACTIVE
match_terms:
  - cage rule
  - path rule
  - protected path
  - forbidden path
  - forbidden zone
  - allowed paths
  - allow_only
  - scope
  - revert
  - override
  - new evaluator
---

# ADR-0053: One path law — the cage, mission scope and standalone verify judge paths with one rule table

## Context

ADR-0052 A3 promised one evaluator: the cage, the staged guard, verify, arch, perimeter and contract checks would differ only in which `Law` they load and which `ChangeSet` they read. The code-quality review of the rewrite (2026-10-19) found this did not happen. `packages/core/src/law.ts` has seven users, all on the mission side. Three models still answer the same question, *may this path change, and what happens if it does*:

| Model | Where | What it holds |
|---|---|---|
| Mission scope (TMVC) | `Law` in core, `tmvc-path.ts`, `forbidden-scan.ts`, `perimeter.ts` | allowed roots (prefix), forbidden zones (prefix), protected paths (perimeter), transport paths |
| Cage rules | `packages/cage/src/cage-rules.ts` (444 lines), `cage-scope.ts` | nine rule ids, `revert`/`report` modes, sources, basename rules, a dependency-freeze mode switch, a scope, runtime overrides, rules overrides can never touch |
| Standalone verify | `src/cli/lib/verify-standalone/` (1,286 lines) | `allowed_paths`, `forbidden_paths`, plus import and layer rules with their own evaluator |

The three differ in ways that look essential but are not:

- **Effect.** A mission scope fails a change; the cage reverts or reports; the perimeter demands a Planner-stamped commit; verify fails. These are one vocabulary with different consequences.
- **Area.** Mission roots are replaced by a narrower level and an escape is reported. The cage scope intersects its lists (`.cage.yaml` and `--allow-only`). Verify has one list. All three mean "outside this area is denied".
- **Exceptions.** The cage writes them as code: `.env.*` except `.env.example`, dependency manifests except under `vendor/`.
- **Relaxation.** Only the cage has it: `--allow-override` lowers revert to report for one run, never for git control or `.cage.yaml` (ADR-0048 §3).

Since MSN-0307 the perimeter, the cage scope and verify match paths with `patternCoversPath` in `packages/core/src/path-glob.ts`. Mission roots and zones and the cage's path targets still use a prefix test (`isPathUnderRoot`, `underPath`), which is that rule for a pattern without wildcards. The rule models are what is left to merge.

Not everything in these modules is path law:

- **Cage mechanism:** absolute git-control targets outside the repository root (a linked worktree's common `.git`), the snapshot and its caps, the journal, the contest halt, watch decisions, the push guard plumbing.
- **Verify content judgments:** the size budget, added-line regex rules, checks and baselines.

## Decision

1. **A path law is areas plus a rule table, in core.** `packages/core/src/path-law.ts` defines it:

   ```ts
   type PathEffect = "deny" | "planner" | "report";
   interface PathRule {
     id: string;           // the rule name reports already use: ci_config, forbidden_zone, ...
     source: string;       // builtin, manifest, cage_yaml, skill, contract, org, verify_contract
     patterns: string[];   // covered paths (core path-glob: the path or a folder above it)
     except?: string[];    // covered paths the rule leaves alone
     effect: PathEffect;
     overridable: boolean; // false for rules that protect the harness itself
   }
   interface PathLaw {
     areas: string[][];    // a path must be covered by every list; none = everywhere
     rules: PathRule[];    // table order breaks ties between equal effects
     exempt: string[];     // governance transport, judged by nothing
   }
   ```

   A path outside an area gets the area rule of its consumer (`outside_roots`, `out_of_scope`, `outside_allowed_paths`) with effect `deny`.

2. **One judgment.** `judgePath(law, path, overrides = [])` returns the rule that decides the path, or null. Exempt paths are not judged. The strictest effect wins (`deny`, then `planner`, then `report`), and the first rule in table order breaks ties. This is how the cage picks a rule today: the first revert hit wins. An override lowers `deny` to `report` on an overridable rule and marks the result `overridden`. It never touches a rule with `overridable: false` (ADR-0048 §3). Every consumer gets the same answer for the same path: live restore, override validation, the push guard, `cage check`, `cage watch`, the staged guard, verify (ADR-0048 §5).

3. **Composition only tightens, by construction.** `tightenPathLaw(upper, lower)` appends rules (upper first) and appends area lists, so a path must sit inside every level's area. Exemptions come from the upper level only. A lower level cannot widen anything, so no composition can loosen and nothing has to be checked afterwards. The mission-side `roots_escape` report (a contract root outside its skill's roots) stays as a diagnostic at legislation time. It is no longer how a path is judged.

4. **Each consumer builds its law; core judges it.**
   - **Missions.** Skill or contract roots become an area; forbidden zones become `deny` rules (sources `skill`, `contract`, `org`); `perimeter_protected` becomes `planner` rules; `EXECUTOR_LOG.md` and the other transport paths become `exempt`. `Law` keeps its import fields and carries its path fields as one `PathLaw`. `classifyPath`, `evaluatePaths`, `isProtectedPath` and `forbidden-scan.ts` become views over `judgePath`.
   - **Cage.** The built-in floor is a data table in the cage package (`cage-floor.ts`), because it is cage product policy, not core law:
     - `ci_config`: the CI paths
     - `secrets`: `**/.env` and `**/.env.*`, except `**/.env.example`
     - `git_control`: `.git/config`, `.git/hooks` and the active hooks path when they sit inside the root; not overridable
     - `cage_config`: `.cage.yaml`; not overridable
     - `lockfile`: report
     - `dependency_manifest`: only while dependencies are frozen, except `**/vendor/**`

     Manifest zones become `deny` rules (source `manifest`) and `.cage.yaml` entries become rules (source `cage_yaml`). A dependency freeze adds `deny` rules on the lockfile patterns; the strictest effect outranks the built-in `report` rule, so there is no mode switch. `allow_only` and `--allow-only` are areas. The plan keeps its mechanism fields (absolute capture targets, caps, contest limit) and carries the law. `classifyCagePath` becomes `judgePath(plan.law, rel, plan.overrides)`. The serialized plan the push guard reads carries the law.
   - **Standalone verify.** `allowed_paths` is an area and `forbidden_paths` are `deny` rules (source `verify_contract`). The floor is empty, because verify has no built-in path rules (ADR-0051 §7).

5. **Report vocabulary does not change.** Rule ids and sources in the session report, `gantry.cage-check.v1`, `gantry.cage-watch.v1`, the verify result and the mission findings keep their names. Each consumer maps the effect to its action: the cage reverts on `deny` and lists `report`, missions fail on `deny` and require a Planner stamp on `planner`, verify fails on `deny`. The conformance suite and the cage tests pass unchanged, except for the difference stated in point 6.

6. **One stated difference: every rule pattern covers.** Cage built-in basename rules and `.cage.yaml` `glob:` entries match a path exactly today. Under the one law they cover it, so a *directory* named like a protected file (`.env/`, `x.pem/`) protects its contents too. This only adds protection, consistent with ADR-0048 §1 and §2. It is the only behaviour change, accepted by the operator on 2026-10-20 (decision 3 below).

7. **Out of scope.**
   - **Cage mechanism (point 4):** git-control targets outside the root stay capture targets the cage classifies as `git_control` itself.
   - **Verify content judgments:** the size budget, added-line regex rules and checks.
   - **The import and layer judgment of standalone verify:** it differs from core's architecture evaluator in four ways: module prefixes rather than substrings, layer membership by covering rather than whole-path match, several resolved targets per import (Python), and only imports the change adds (ADR-0051 §9–10). Merging those is a separate record (decision 4).

## Migration

One mission per step, each with goldens unchanged (except point 6) and the layer budgets lowered only:

1. Core: `path-law.ts` with `PathLaw`, `judgePath`, `tightenPathLaw`, and tests built from today's cage rule table and mission classification tests. No consumer yet.
2. Missions onto `PathLaw`: `Law`'s path fields, `tmvc-path.ts`, `perimeter.ts`, `forbidden-scan.ts`, effective scope.
3. Cage onto `PathLaw`: `cage-floor.ts`. `classifyCagePath`, `cageScanRule`, `cagePlanRuleMode`, `cageScopeHit`, `applyCageOverride` and the downgrade check collapse into `judgePath` plus one validation. The serialized plan is read in both shapes for one release.
4. Standalone verify paths onto `PathLaw`: `judgePaths` and `anyPathOf` go.

## Consequences

- One answer to "may this path change": the cage, missions and verify cannot disagree on a path, and a new consumer (a future hook, an MCP write guard) builds a law instead of writing a matcher.
- The cage's rule table becomes data that a reviewer reads in one place, with exceptions and overridability written down rather than coded.
- Expected size: most of the classification code in `cage-rules.ts` and `cage-scope.ts`, the path half of the verify run, and the hand-written classification in `tmvc-path.ts` and `forbidden-scan.ts` go. Core gains one module. Each mission must lower the baseline; no number is promised before step 1 exists.
- **Risk.** The cage is published and security-relevant. Steps 1 and 3 carry the weight, and the cage tests (including the macOS job) plus the conformance suite are the guard.

## Operator decisions

Approved on 2026-10-20, each point as the draft recommended:

1. **Areas intersect.** Mission roots compose like the cage scope: a path must sit inside every level's area. A contract root outside its skill's roots stays an error at legislation time (`roots_escape`); it is no longer how a path is judged.
2. **The perimeter joins the table.** Protected paths are `planner` rules in the mission law, not a separate list.
3. **Every cage pattern covers.** A directory named like a protected file protects its contents (point 6). There is no per-rule `match: exact` flag.
4. **Standalone verify imports and layers stay in verify for now.** Moving that judgment into core's architecture evaluator gets its own record, after migration steps 1 to 4 show the path law holds.

## Non-goals

- One gate runner for mission gates and verify checks.
- Change-size budgets, added-line rules.
- Any change to what the cage protects by default, to `.cage.yaml`, to reports, or to exit codes.

Design notes: [ADR-0048](ADR-0048-cage-trust-model.md), [ADR-0050](ADR-0050-cage-diff-check.md), [ADR-0051](ADR-0051-standalone-verify-contract.md), [ADR-0052](ADR-0052-rewrite-under-structural-law.md).
