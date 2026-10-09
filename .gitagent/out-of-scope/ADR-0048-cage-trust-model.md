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
2. **`.cage.yaml` only adds.** The file at the cage root has a single key, `protect:`, with `{path}` or `{glob}` entries and an optional `mode: revert|report`.
   - Unknown keys, subtractive keys (`relax`, `exclude`, `allow`, …), absolute or `..` paths, YAML aliases, and `mode: report` on a path a built-in rule reverts are rejected before the command runs (`GXT_CAGE_CONFIG_INVALID`, exit 2). Format rules follow [ADR-0047](ADR-0047-config-file-format.md): humans write it, so it is YAML with a strict schema.
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

## Consequences

- Zero-config keeps one meaning: without `.cage.yaml`, a run behaves exactly as before. With it, the protected set only grows.
- Projects that need a relaxation pass it on the command line and accept that it shows up in every report. There is no quiet way to turn a built-in rule off.
- Proposals to make cage rules subtractive in a file, to let an MCP tool edit them, or to let `cage suggest` write `.cage.yaml` directly reopen this ADR and need a Planner mission that supersedes it.
- Cage still restores rather than blocks. This ADR is about who can change the rules, not about stronger enforcement; missions remain the tool for scope enforced on every write.
