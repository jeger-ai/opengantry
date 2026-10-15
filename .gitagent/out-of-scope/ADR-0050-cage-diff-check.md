---
id: ADR-0050
title: Cage runs where every agent's work lands — diff check first, session wrapper for scripted runs
status: ACTIVE
match_terms:
  - cage check
  - diff check
  - gantry-cage
  - session wrapper
  - wrap the agent
  - pre-push
---

## Context

`gantry cage` shipped as a session wrapper: start the agent inside it (`gantry-cage -- claude`) and it restores protected paths about once a second while the agent runs. The rules behind it ([ADR-0048](ADR-0048-cage-trust-model.md)) hold up. The delivery does not:

- **It is a per-session habit.** It protects only when someone types the wrapper before every session, in every repo. Guardrails that depend on remembering are skipped.
- **Most agents cannot be wrapped.** IDE agents (Cursor, VS Code extensions), desktop apps and cloud agents (background agents, hosted coding agents that open pull requests) are not started from a terminal command. Only terminal CLIs are.
- **The wrappable CLIs now bring their own sandboxes.** Claude Code and Codex ship sandboxing and permission hooks that block before the write. The wrapper restores after it, one interval later.
- **One root per session.** The cage root is one work tree; agents increasingly span repositories and worktrees.

Every agent's work, however it was started, reaches the repository as commits and lands through a pull request. The protected set (CI configs, secrets, git control, manifest forbidden zones, `.cage.yaml` entries) only does damage once it is pushed or merged. The session push guard already checked outgoing commits against the rules; that check is the part that applies to every agent.

## Decision

1. **`gantry cage check --base <ref> [--head <ref>]` is the primary form of the cage.** It classifies every path changed by commits in `base..head` with the cage rules and exits `3` when a revert-rule path changed, `0` otherwise, and `2` when it cannot check (not a git work tree, a ref that does not resolve, invalid rules at base). Report-mode hits (lockfiles, `.cage.yaml` `mode: report` entries) are listed and never fail it. It runs in pre-push and CI; adopters wire it into their own pipeline.
2. **Rules come from the base commit.** `.cage.yaml` and the manifest `forbidden_zones` are read from `base` through git, never from the head under review or the working tree. A change cannot loosen the rules it is checked against: a head that deletes `.cage.yaml` is still held to base's entries, and the deletion itself is a `cage_config` hit. This is ADR-0048's floor-from-outside idea applied to a commit range. A rule a change adds takes effect for later changes, once merged.
3. **History, not net diff.** `check` lists paths from every commit in the range (`git log`, no rename pairing, merges by the paths they change against every parent), the same listing the session push guard uses. A secret committed and removed again inside the range still fails, because it is in the pushed history; a rename lists the path it left; an edit made while resolving a merge is seen.
4. **The session wrapper stays, for scripted headless runs.** `gantry cage -- <cmd>` and `gantry-cage` keep every rule, mode, cap and exit code. Their place is runs where wrapping costs nothing: CI jobs and orchestrators that start an agent non-interactively. Docs stop presenting the wrapper as the first step.
5. **Scope of the first step.** `check` lives in the full package only, like `cage suggest`; the slim `@jeger-ai/opengantry-cage` bin keeps no subcommands until the fold-back question for that package is decided. No MCP tool exposes `check`, it never writes rules, and it takes no `--allow-override`. The GitHub Actions setup is a documented snippet, not a shipped template.
6. **Digest-only output.** `--json` emits `gantry.cage-check.v1`: base, head, the rules commit, `changes[]` (`path`, `rule`, `source`, `mode`) and a status. No file bodies, no diffs ([ADR-0034](ADR-0034-hybrid-hub-spoke-metadata-plane.md)).

## Consequences

- The cage reaches every agent that ends in a commit, including the ones that cannot be wrapped, with one CI step instead of a per-session habit.
- A legitimate change to a protected path (a CI workflow edit, a new migration) fails the check. In this first step a human reviews it and merges; whether the check is a required status is the adopter's branch-protection choice.
- `check` sees committed history only. Uncommitted work, reads, network side effects and anything outside the repository stay invisible to it, and it cannot undo tampering during a session (an agent that edits `.git/hooks` can skip a local pre-push hook). CI is where it cannot be skipped.
- `check` is not an attestation receipt ([ADR-0036](ADR-0036-receipt-v0-2-signed-attribution.md)): it says which protected paths changed, not who changed them or why.
- The shared range listing also hardens the session push guard: it now sees the old path of a rename and edits made inside merge commits.
- Follow-ups, each needing its own Planner mission: a CI workflow shipped to adopters through `templates/`; pre-write blocking through harness hooks (Claude Code `PreToolUse`, Cursor hooks) installed once per repo; letting a mission that declares a protected path clear the check for that path; the fold-back of the slim package.
- ADR-0048 stays ACTIVE and unchanged. Proposals to read `check` rules from the head, to let a file in the range relax them, or to expose `check` to agents through MCP reopen this ADR.
