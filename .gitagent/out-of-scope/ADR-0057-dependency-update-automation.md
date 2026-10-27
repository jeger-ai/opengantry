---
id: ADR-0057
title: Dependency updates as trusted automation — a bump passes without a mission, nothing more does
status: ACTIVE
match_terms:
  - dependabot
  - dependency update
  - trusted automation
  - lockfile
  - package.json
  - git-proof
---

# ADR-0057: Dependency updates as trusted automation — a bump passes without a mission, nothing more does

## Context

A pull request from Dependabot or a cloud agent that only bumps dependencies fails the mission checks when `package.json` or a lockfile is under a skill's `tmvc_roots` (as `package.json` is in this repository): every commit needs an `[MSN]` subject (`gantry ci msn-range`), and the range needs a Planner-stamped mission (`gantry ci verify-missions`). Issue #193 (with #182, #191 and #192 as cases) asks for these to pass without a hand-made mission each time.

Trusted automation (`.gitagent/config.yaml` `trusted_automation`) already lets named bot authors pass for two structural kinds: `workflow_version_pin` (5 lines) and `bounded_content` (100 lines). Neither fits: a lockfile update is routinely hundreds of lines, and counting lines says nothing about what changed. The risk a dependency change carries is specific: a new package, a script, or a lockfile entry pointing at a tarball, a git repository or another registry is how a confused or compromised agent gets code installed (the reason for the dependency freeze, ADR-0048 decision 9).

## Decision

1. **A third structural kind, `dependency_update`.** A rule of this kind lets its `allowed_actors` pass the mission checks for a change that is a dependency bump and nothing else. The rest of trusted automation is unchanged: actors by commit author email, `allowed_paths`, one kind per rule, evaluation from git only, fail-closed without a config.
2. **What a bump is (npm, `lockfileVersion` 2 and 3).**
   - Every MSN-enforced file in the change, and every npm lockfile the change touches whether enforced or not, is a `package.json`, `package-lock.json` or `npm-shrinkwrap.json` that existed before and after the change.
   - `package.json`: the same fields; inside `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies` and `overrides` the same names, and only their version strings may differ. Any other change (a new dependency, `scripts`, `bin`, the package's own version) is not a bump.
   - Lockfile: the root entry follows the `package.json` rule; every entry that is new or changed (in `packages`, and in lockfileVersion 2's legacy `dependencies` tree) resolves to an allowed registry and carries an `integrity` hash; a new or changed `link` entry is refused; bundled entries (`inBundle`) need no URL. An entry for a local folder (a `packages` key outside `node_modules`, such as `../..` for a `file:` dependency on this repository) may change, because it describes source already in the repository and what it pulls in is judged as `node_modules/…` entries; a new local folder, or one that starts to link or resolve elsewhere, is refused (amended by MSN-0351 after the first Dependabot pull request, #309, failed on the iii integration example's `file:../../` dependency). Top-level fields other than `packages` and `dependencies` must not change. New transitive packages are fine: a bump pulls them in.
3. **Registries.** `https://registry.npmjs.org/` unless the rule lists `allowed_registries` (https URL prefixes ending in `/`). The key is refused on other kinds.
4. **Lines.** `max_net_loc` (hard cap 200) counts the change without npm lockfiles: lockfiles are generated and judged by structure instead.
5. **npm only in 4.0.** Other ecosystems' files (`yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum`, `poetry.lock`) are not dependency files for this kind, so a change to them fails closed. Each can be added with its own structural rule.
6. **Defaults.** `gantry init`'s `config.yaml` and this repository's config get a `dependency-bumps` rule for Dependabot's two author emails over `**/package.json`, `**/package-lock.json` and `**/npm-shrinkwrap.json`. A cloud agent is added by its author email, and is judged by the same structure.

## Consequences

- Dependabot npm pull requests pass `msn_commits` and `mission_verify` without a Planner stamp; the CI checks and the lockfile diff are the review, as #193 proposed.
- A bump can still pull in a malicious new version from the registry; that is what CI, `npm audit` and the cage's dependency freeze for agent sessions are for. What the kind refuses is everything a bump does not need: new packages, scripts, other registries, git and tarball URLs, local links.
- When no rule allows a change, the mission checks report every rule's reason, not only the last rule tried (MSN-0351).
- `.github/dependabot.yml` stays outside the kind: it configures automation and changes rarely, so it keeps needing a mission when it is enforced.
- Amends the trusted automation documentation (enforcement boundary) and closes #193.
