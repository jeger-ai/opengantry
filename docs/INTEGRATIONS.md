# Agent Integrations (GXT wrapper)

OpenGantry is **tool-agnostic**. Any agent that can run shell commands can participate in the GXT loop. You do not configure vendor-specific safety rails — **`gapman runtime exec`** enforces `tmvc_roots` and `forbidden_zones` at the process boundary.

**Audience:** adopters wiring agents into their own repos. For contributing to OpenGantry itself, see [`docs/DEVELOPMENT.md`](DEVELOPMENT.md).

## Universal rule

1. Teacher legislates a mission under `.gitagent/missions/`.
2. Wrap every worker invocation with mission-scoped runtime env.
3. Append trace evidence to `WORKER_LOG.md`.
4. Finish with `gapman verify --mission <path>`.

```bash
# Preferred: env injection + enforced boundary
gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- <your-agent-command>

# Shell session preload (IDE terminals, manual runs)
eval "$(gapman runtime env --mission .gitagent/missions/MSN-0001.<slug>.yaml)"
# then run your agent in the same shell

# Orchestrator / CI JSON bootstrap
gapman runtime env --mission .gitagent/missions/MSN-0001.<slug>.yaml --json
```

On failure, read `GXT_LAST_ERROR_FILE` (from `runtime env`) for machine-oriented remediation — do not rely on exit code alone. See [`.gitagent/teacher/RUNTIME.md`](../.gitagent/teacher/RUNTIME.md).

## Canonical context files

Point every tool at the same GXT law, not duplicate prose:

| File | Role |
|------|------|
| [`AGENTS.md`](../AGENTS.md) | Cross-tool entry: read RULES + MANIFEST before acting |
| [`.gitagent/teacher/RULES.md`](../.gitagent/teacher/RULES.md) | Governance law |
| [`.gitagent/foreman/MANIFEST.json`](../.gitagent/foreman/MANIFEST.json) | Routing map (TMVC roots, forbidden zones) |

`gapman init` scaffolds `AGENTS.md` and `.cursor/rules/opengantry-gxt-substrate.mdc`. For other tools, add a thin pointer file that `@`-includes or links to the three paths above.

## Compatibility matrix

| Tool | Context injection path | Wrap invocation |
|------|------------------------|-----------------|
| **Cursor** | `.cursor/rules/opengantry-gxt-substrate.mdc` + `.cursor/hooks.json` | `gapman runtime exec --mission <path> -- cursor agent "<task>"` |
| **Claude Code** | `CLAUDE.md` or `.claude/CLAUDE.md` → link `AGENTS.md`, RULES, MANIFEST | `gapman runtime exec --mission <path> -- claude "<task>"` |
| **OpenCode** | `AGENTS.md` (native); optional `opencode.json` `instructions` | `gapman runtime exec --mission <path> -- opencode run "<task>"` |
| **JetBrains Junie** | `.junie/AGENTS.md` or `.junie/guidelines.md` | Run agent in terminal after `eval "$(gapman runtime env --mission <path>)"` |
| **Antigravity** | `AGENTS.md` + optional `.agent/rules/gxt.md` (`always_on`) | `gapman runtime exec --mission <path> -- <agent-command>` |
| **Cline** | `.clinerules/gxt.md` (or symlink `AGENTS.md`) | VS Code terminal: `eval "$(gapman runtime env --mission <path>)"` then use Cline |
| **Aider** | `.aider.conf.yml` `read:` list | `gapman runtime exec --mission <path> -- aider --message "<task>"` |

Vendor CLIs change; the **wrap line** does not.

## Per-tool context recipes

### Cursor

`gapman init` scaffolds:

- [`.cursor/rules/opengantry-gxt-substrate.mdc`](../.cursor/rules/opengantry-gxt-substrate.mdc) — mandates reading RULES + MANIFEST (`alwaysApply: true`).
- [`.cursor/hooks.json`](../.cursor/hooks.json) — `beforeShellExecution` guard for direct shell edits to GXT law/manifest paths.
- [`scripts/gxt-cursor-env.sh`](../scripts/gxt-cursor-env.sh) — load mission scope into a Cursor terminal session.

**Cursor terminal (interactive agent in IDE):**

```bash
source scripts/gxt-cursor-env.sh .gitagent/missions/MSN-0001.<slug>.yaml
# GXT_TMVC_ROOTS, GXT_FORBIDDEN_ZONES, GXT_WORKER_LOG are now set
```

**Headless / CI (Cursor CLI or SDK):**

```bash
gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- cursor agent "<task>"
```

Optional: `export GAPMAN_MISSION=.gitagent/missions/<file>.yaml` so `gxt-cursor-env.sh` resolves without an argument.

### Claude Code

Minimal `CLAUDE.md`:

```markdown
Before any work, read AGENTS.md, .gitagent/teacher/RULES.md, and .gitagent/foreman/MANIFEST.json.
Bootstrap scope: eval "$(gapman runtime env --mission .gitagent/missions/<file>.yaml)"
Write trace quotes to WORKER_LOG.md; finish with gapman verify --mission <same-path>.
```

### OpenCode

OpenCode reads repo-root `AGENTS.md` by default. After `gapman init`, no extra wiring is required. To add instruction files in `opencode.json`:

```json
{ "instructions": ["AGENTS.md", ".gitagent/teacher/RULES.md"] }
```

### JetBrains Junie

Create `.junie/AGENTS.md` with the same bullets as root `AGENTS.md`. Junie loads it automatically; use IDE terminal + `runtime env` for mission scope.

### Antigravity

Add `.agent/rules/gxt.md` with `always_on` activation, pointing at the three canonical files. `AGENTS.md` at repo root is picked up natively.

### Cline

Add `.clinerules/gxt.md`:

```markdown
Read AGENTS.md, .gitagent/teacher/RULES.md, and .gitagent/foreman/MANIFEST.json before editing.
Mission scope comes from gapman runtime env — never guess TMVC roots.
```

Cline also recognizes root `AGENTS.md` in the Rules panel.

### Aider

`.aider.conf.yml`:

```yaml
read:
  - AGENTS.md
  - .gitagent/teacher/RULES.md
  - .gitagent/foreman/MANIFEST.json
```

Run inside the wrapper so forbidden-zone enforcement applies to file writes.

## Finish loop

```bash
gapman verify --mission .gitagent/missions/MSN-0001.<slug>.yaml
```

Adopter bootstrap: [`docs/ADOPTION.md`](ADOPTION.md). Runtime contract: [`.gitagent/teacher/RUNTIME.md`](../.gitagent/teacher/RUNTIME.md).
