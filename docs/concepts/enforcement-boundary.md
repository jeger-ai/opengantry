---
title: "Enforcement boundary"
description: "Which OpenGantry mechanisms fail closed and which are advisory: runtime exec, hooks, IDE rules, trusted automation, and the zero-trust stance."
section: concepts
order: 6
---

# Enforcement boundary

An IDE agent's own edit tool is convenient but advisory. Compliance and security claims need mechanisms that fail closed. Be precise about which tier your setup runs at.

## Three tiers

| Tier | Mechanism | What it actually traps |
|------|-----------|------------------------|
| **Process boundary** | `gantry runtime exec` | Edit roots and forbidden zones for subprocess executors, with a forbidden-zone scan |
| **Deterministic hook** | Pre-commit `tmvc guard --strict`, pre-push verify, tool hooks (today: Cursor `beforeShellExecution` on governance paths) | Commits outside the pinned mission, unlegislated handoffs, shell writes to `.gitagent/foreman/` and `RULES.md` |
| **Advisory** | IDE rules, `AGENTS.md`, session-start context, MCP context | Nothing: the model is guided, not trapped |

**An IDE agent's file edits are not scope-trapped unless the tool runs inside `gantry runtime exec`.** Rules and `AGENTS.md` shape what the agent tries; hooks, `gantry verify` and `runtime exec` decide what lands. IDE suggestions alone never count as approval.

Regulated teams and headless orchestrators should run executors under the process boundary and gate merges with verify. Advisory-only setups are acceptable only when that is documented. Teams that legislate missions but skip `runtime exec` and merge-time verify keep the audit artifacts but weaken the blast-radius guarantee.

## The process boundary

```bash
gantry runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- <agent command>
```

`runtime exec` runs the command with the mission environment and checks edit roots and forbidden zones around it. On failure it prints a one-line summary on stdout and full JSON on stderr and in `.gitagent/history/.ignored-last-error.json`; orchestrators read the path from `GANTRY_LAST_ERROR_FILE` in `gantry runtime env`. Break-glass never disables its forbidden-zone enforcement.

## Zero trust

Git cannot attest how a line was produced. Every change is untrusted until it passes the same result-state checks, whether a human typed it or an agent generated it: compile, tests, import layers, the mission gate and trace mapping.

Third-party agent skill packs and style guides are local IDE preferences, not OpenGantry law. Keep them in local, gitignored config, for example `.cursor/external-skills.local.mdc` or `.clinerules/*.local.md`, and do not add them to `AGENTS.md`, `.gitagent/` or `gantry init` templates.

## Trusted automation

Low-risk bot maintenance, such as Dependabot dependency and workflow pin bumps or security autofix pull requests, should not need a mission per bot commit when the change is narrow. A rule in `.gitagent/config.yaml` lets such commits pass the mission check without break-glass when **all** its constraints hold:

| Constraint | Meaning |
|------------|---------|
| `allowed_actors` | The commit author email (`git log -1 --format=%ae`) matches an entry you listed |
| `allowed_paths` | Every changed file the mission check covers matches a glob in the rule |
| `allowed_structural_changes` | Exactly one kind per rule (below) |
| `max_net_loc` | Total churn (additions plus deletions), at most the kind's hard cap; for `dependency_update`, npm lockfiles do not count |
| `allowed_registries` | `dependency_update` only: URL prefixes a changed lockfile entry may resolve to (default `https://registry.npmjs.org/`) |

| Kind | Use | Hard cap | Checks |
|------|-----|----------|--------|
| `workflow_version_pin` | Dependabot workflow `uses:` bumps | 5 | YAML structure unchanged; only existing `uses:` version segments differ |
| `dependency_update` | Dependabot and agent npm dependency bumps | 200 | Only `package.json`, `package-lock.json` and `npm-shrinkwrap.json` files that existed before. `package.json`: the same fields and dependency names; only version strings differ. Lockfiles: every new or changed install entry resolves to an allowed registry with an `integrity` hash; a local folder's entry (a `file:` dependency) may change but not appear, and links may not change. So a new dependency, a script, a git or tarball URL or another registry is refused. npm only for now |
| `bounded_content` | Security autofix bots (code scanning, Snyk and similar) | 100 | Content changes inside `allowed_paths`; any touch under `.gitagent/**` or a protected path (the manifest's `perimeter_protected` or its defaults, plus the org floor's `perimeter_protected_add`) is rejected even if listed |

```yaml
# .gitagent/config.yaml
trusted_automation:
  rules:
    - id: dependency-bumps
      allowed_actors: ["49699333+dependabot[bot]@users.noreply.github.com", "dependabot[bot]@users.noreply.github.com"]
      allowed_paths: ["**/package.json", "**/package-lock.json", "**/npm-shrinkwrap.json"]
      allowed_structural_changes: [dependency_update]
      max_net_loc: 50
    - id: workflow-dependency-bumps
      allowed_actors: ["49699333+dependabot[bot]@users.noreply.github.com", "dependabot[bot]@users.noreply.github.com"]
      allowed_paths: [".github/workflows/**"]
      allowed_structural_changes: [workflow_version_pin]
      max_net_loc: 5
    - id: security-autofix-bots
      allowed_actors: ["223556219+Copilot@users.noreply.github.com", "snyk-bot@snyk.io"]
      allowed_paths: ["src/**"]
      allowed_structural_changes: [bounded_content]
      max_net_loc: 80
```

- Evaluation is derived from Git only, never from CI environment variables. Missing or invalid config keeps the full mission workflow.
- **Finding the actor:** when the mission check fails on a bot pull request, read the author of the failing commit with `git log -1 --format=%ae <sha>` and add that exact email. GitHub noreply formats vary by account. Snyk fix pull requests in private repositories may be opened on behalf of a human collaborator and will not match `snyk-bot@snyk.io` unless you configure Snyk's fixed account or add that email.
- Routine autofixes belong here, not in [break-glass](../reference/break-glass.md).

## OpenGantry and an execution firewall

Unmonitored tool calls and tool poisoning are real, but they are a different problem from scope and verify evidence. OpenGantry routes work (missions, scope, perimeters, verify, receipts). A standalone security proxy sandboxes MCP tools and checks skill hashes at invoke time. Pair them when you need both citeable Git evidence and runtime isolation; neither replaces the other ([Security policy](../SECURITY.md#opengantry-vs-a-standalone-security-proxy)).
