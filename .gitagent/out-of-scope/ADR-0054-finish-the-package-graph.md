---
id: ADR-0054
title: Finish the package graph — verify and missions become packages, domain code stops logging, src/cli is delivery only
status: ACTIVE
match_terms:
  - package split
  - verify package
  - missions package
  - src/cli/lib
  - flat lib
  - reporter
  - currentreporter
  - facade
  - re-export
  - core dependency
  - runtime dependency
  - receipt signing
  - slim cage entry
  - perimeter_protected_add
---

# ADR-0054: Finish the package graph — verify and missions become packages, domain code stops logging, src/cli is delivery only

## Context

ADR-0052 A1 drew seven packages. Four exist: `core`, `git`, `cage` and `plane`. The code-quality review of the rewrite (2026-10-19, item 5 and the smaller findings) found that the rest of the graph is still one tree:

| Measure (2026-10-20) | Value |
|---|---|
| `src/cli/lib` | 208 files, 25,875 lines, 84 of them flat at the top level (B7: no flat `lib/`) |
| Standalone verify (ADR-0051) | `src/cli/lib/verify-standalone/`, 1,286 lines, importing core, git, plane and `../errors.js` |
| `lib` modules that reach the reporter global through their imports | 134 of 208 (20,356 lines) |
| …of those, through a pure re-export only (`GantryUserError` from `errors.ts`, path helpers from `cli-io.ts`) | 51; 20 modules (3,239 lines) actually log |
| Pure re-exports left under `src/cli` | `lib/constants.ts`, `doctor-preflight/index.ts`, and re-export lines in nine more modules |

Three findings are contradictions in the records themselves:

- **Core's dependencies.** A1 and A6 put the one schema library (zod) in `core`, and the law files are YAML (ADR-0047), so `core` imports `zod` and `yaml`. B7 says `core` has zero runtime dependencies. Both cannot hold.
- **The plane's direction.** A1 has `plane` depend on `missions`. The code does the opposite: effective scope applies the org floor (`#plane/policy-resolve.js`), and `plane` imports only `core` and `git`.
- **Signing.** Standalone verify signs its result with `#plane/receipt-signing.js`, so `verify` would depend on `plane`, which A1 does not allow. That module signs with the git signing key (ssh or gpg through `git config`); it is git adapter code.

And two are leftovers:

- **The slim cage entry reaches up.** `packages/opengantry-cage/src/entry.ts` imports `src/cli/program-cage.ts`, `errors`, `reporter` and `constants` by relative path, and repeats `src/cli/cage-bin.ts` plus the hidden `cage-guard` dispatch. `arch check` does not scan it.
- **`perimeter_protected_add` is applied nowhere.** ADR-0042 says the org bundle's `manifest_constraints.perimeter_protected_add` is unioned into the perimeter. The schema accepts it and the policy types carry it, but no code reads it (found in MSN-0311).

## Decision

1. **Core depends on `zod` and `yaml`, nothing else.** This amends B7: "`core` with zero runtime dependencies" becomes "`core` with `zod` and `yaml` as its only runtime dependencies". Both are pure (no I/O). Moving the schemas out of core would contradict A1 and A6.

2. **The plane sits below missions.** This amends A1's table: `plane` depends on `core` and `git`; `missions` depends on `core`, `git`, `verify` and `plane`. The org floor is an input to a mission's law, not the other way round.

3. **Git signing belongs to `git`.** `receipt-signing.ts` moves from `plane` to `git`. `plane` and `verify` import it there.

4. **Domain code does not log, and facades go.** A module in a package never writes to stdout or stderr and never sets the exit code; when it has something to warn about, it returns it and the delivery code prints it. Re-exports kept "so old importers compile" are deleted and their importers point at the owner: `GantryUserError` and `isGantryUserError` at `#core/user-error.js`, the path helpers at `#core/posix-path.js`, the constants at `#core/constants.js`, and so on. `errors.ts` keeps only the delivery half: reporting an error, the agent error file.

5. **`packages/verify` holds the contract engine of ADR-0051.** The contents of `src/cli/lib/verify-standalone/` move there (`#verify/*`). It depends on `core` and `git`. The `gantry verify` command stays in `src/cli/commands`.

6. **`packages/missions` holds the governed substrate.** These move there: the mission parser and resolution, the contract and effective scope, the scope path law, trace and run records, the planner identity and stamp, legislate and interrogate, the mission verify engine, runtime env and exec, and upgrade. They move in steps by sub-area. A module moves only when everything it imports is free of delivery, meaning the reporter, `cli-io` logging, Commander and prompts. Its presentation stays behind in `src/cli`.

7. **`src/cli` is delivery only.** It holds:
   - the entries;
   - the program files and commands;
   - the reporter;
   - presenters (verify presenters, audience output, fix hints);
   - interactive flows (init and the tutorial);
   - the report server;
   - the MCP server.

   `src/cli/lib/` is gone when the last domain module has moved. What stays is grouped by role, not in a flat `lib/`.

8. **The reporter is passed, not global.** Each entry creates one reporter and hands it to the command action. `currentReporter`, `setCurrentReporter`, `withReporter` and the `cli-io` log forwarders are deleted. Verify presentation (`emitVerifySuccess`, `emitFailurePresentation`, `emitNextSteps`) leaves the `Reporter` class for the verify presenters. The paired `info`/`emitInfo` methods collapse into one channel per kind, which a structured-mode reporter drops. This is A7's "the global output context goes", done after decision 4 has emptied the domain of log calls.

9. **The slim cage entry is the CLI's cage entry.** `src/cli/cage-bin.ts` also dispatches the hidden `cage-guard` subcommand, and the slim package bundles it. `packages/opengantry-cage/src/entry.ts` is deleted, so nothing under `packages/` imports `src/cli`. The bin name, the bundle layout and the push guard's `dist/cli/index.js` path stay as they are.

10. **`perimeter_protected_add` is applied as ADR-0042 says.** The org bundle's paths are unioned into the perimeter. In the mission law they become `planner` rules with source `org` (ADR-0053 decision 2). This is a behaviour change only for a repository whose org bundle sets the field, which today is silently ignored. The changelog says so.

## Migration

One mission per step. Goldens are unchanged, except decision 10, whose change gets its own test. Layer budgets only go down. A step that creates a package adds its layer, its downward-only rules and its budget row to `TARGET_ARCHITECTURE.yaml` and `ARCH_BASELINE.json`. That is a Planner edit, as B1 and B4 require.

1. **Facades go (decision 4, first half).** Importers point at the owners; the pure re-export files and lines are deleted.
2. **The slim cage entry (decision 9).**
3. **Signing to `git`, then `packages/verify` (decisions 3 and 5).**
4. **`perimeter_protected_add` (decision 10).**
5. **`packages/missions`, by sub-area (decisions 4 and 6).** The order follows the import graph:
   - contract and effective scope;
   - missions parser and resolution;
   - trace and run records;
   - legislate and interrogate;
   - the mission verify engine;
   - runtime;
   - upgrade.

   Each sub-area that logs first returns its warnings instead.
6. **The reporter is passed (decision 8).**
7. **`src/cli/lib/` is removed (decision 7).** Delivery modules are grouped by role, and B7's text is amended in the same mission.

## Consequences

- The graph A1 promised exists and `arch check` enforces it per package. Adding an edge stays a Planner edit to `TARGET_ARCHITECTURE.yaml`.
- Moving code does not delete it. The deletions come from steps 1, 2 and 6: the facades, the duplicate entry, the global reporter and the method pairs. Each step must lower the baseline. Line counts per package are recorded as the steps land, not promised here.
- `@jeger-ai/opengantry` keeps one tarball. Workspace packages are inlined as `core` and `git` are today (A1 publishing paragraph).
- **Risk.** Steps 5 and 6 touch most of the CLI. The conformance suite, the unit suites and the cage parity tests are the guard, as in ADR-0052 step 6.

## Operator decisions

The operator asked for every remaining review item to be done without check-ins ("just go for it and continue until everything's done", 2026-10-20). This record takes each decision above as drafted and recommended. The operator may revisit any of them before the step that implements it.

## Non-goals

- Publishing `verify` or `missions` on their own.
- Generating the CLI or MCP from a command specification. MSN-0308 decided that the registries are the surface.
- Moving standalone verify's import and layer judgment into core (ADR-0053 decision 4).
- New commands, flags, error codes or env names.

Design notes: [ADR-0042](ADR-0042-org-policy-bundle.md), [ADR-0051](ADR-0051-standalone-verify-contract.md), [ADR-0052](ADR-0052-rewrite-under-structural-law.md), [ADR-0053](ADR-0053-one-path-law.md).
