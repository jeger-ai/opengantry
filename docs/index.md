---
title: "OpenGantry documentation"
description: "Docs for the gantry cage and the OpenGantry mission graph: deterministic, local-first guardrails and verification for AI coding agents."
section: overview
order: 0
---

<p align="center">
  <a href="https://opengantry.ai"><img src="assets/opengantry-logo.svg" alt="OpenGantry logo" width="64" height="64"></a>
</p>

# OpenGantry documentation

OpenGantry keeps AI coding agents inside boundaries you declare and checks their work with the gates you already trust. Everything runs in your repository and your CI. Pick where to start.

## Protect your repository today: the cage

No setup and no config. The cage protects CI configs, `.env` files, git hooks and your own sensitive paths from what an agent changes.

- [The cage](cage/index.md): [check commits](cage/check.md), [watch files](cage/watch.md), [cage scripted runs](cage/session.md)
- [Protected paths](cage/protected-paths.md) and [project rules](cage/cage-yaml.md)
- [Session report and exit codes](cage/report.md) and [limits](cage/limits.md)
- [Read guard](cage/read-guard.md): keep secret files out of Claude Code's and Cursor's context

## Govern agent work: missions and verify

Declare scope before an agent starts, approve it in Git, and let `gantry verify` decide with structured findings an agent can retry on.

- [How OpenGantry works](start/how-it-works.md), then [Install](start/install.md) and [Your first mission](start/first-mission.md)
- [Wire your agent](guides/agents.md): Cursor, Claude Code, Codex and others
- Concepts: [missions](concepts/missions.md), [scope](concepts/scope.md), [perimeters](concepts/perimeters.md), [verify](concepts/verify.md), [trace evidence](concepts/trace-evidence.md), [enforcement boundary](concepts/enforcement-boundary.md)
- For teams: [CI](guides/ci.md), [regulated teams](guides/regulated-teams.md), [org control plane](guides/org-control-plane.md)
- [Verify a change without missions](guides/verify-contract.md): one `verify.yaml` with allowed paths, a size budget, rules and your checks
- [Plans from other frameworks](guides/plan-adapters.md): `gantry adapt` turns a plan step into the contract and the cage scope

## Look something up

[MCP tools and kernel](reference/mcp-tools.md), [session variables](reference/session-variables.md), [metrics and report](reference/metrics-and-report.md), [break-glass](reference/break-glass.md), [release notes](reference/release-notes.md), [security policy](SECURITY.md) and [troubleshooting](guides/troubleshooting.md).

Why it exists: [The Post-PR Software Factory](MANIFESTO.md).
