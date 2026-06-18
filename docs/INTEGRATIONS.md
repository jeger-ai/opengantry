# Agent Integrations (GXT wrapper)

OpenGantry is **tool-agnostic**. Any agent that can run shell commands can participate in the GXT loop.

**Audience:** adopters wiring agents into their own repos. For contributing to OpenGantry itself, see [`docs/DEVELOPMENT.md`](DEVELOPMENT.md).

## Universal rule

1. Teacher legislates a mission under `.gitagent/missions/` (IDE chat: [`.gitagent/teacher/MISSION-ARCHITECT.md`](../.gitagent/teacher/MISSION-ARCHITECT.md) — one copy-paste `gapman legislate` command).
2. Bootstrap mission-scoped runtime env before worker execution.
3. Append trace evidence to `WORKER_LOG.md`.
4. Finish with `gapman verify --mission <path>` (full verify before merge / claiming done).

```bash
# Process-boundary wrap (subprocess workers — strongest TMVC trap)
gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- <your-agent-command>

# IDE terminal / manual shell (any tool)
source scripts/gxt-runtime-env.sh .gitagent/missions/MSN-0001.<slug>.yaml

# Orchestrator / CI JSON bootstrap
gapman runtime env --mission .gitagent/missions/MSN-0001.<slug>.yaml --json
```

On failure, read `GXT_LAST_ERROR_FILE` (from `runtime env`) for machine-oriented remediation. **`gxt_verify`** returns structured `error_code`, `fix_hints`, and `next_actions` for IDE agents. After **`gapman verify`** failures, consume **`gapman context-feed --json`** (or read `.gitagent/tmp/NEXT_REMEDIATION.json` directly) for the latest structured remediation snapshot — atomic swap writes; eventual consistency under concurrent repair loops. See [`.gitagent/teacher/RUNTIME.md`](../.gitagent/teacher/RUNTIME.md).

## MCP tools (Cursor and other MCP clients)

| Tool | Purpose |
|------|---------|
| `gxt_draft_legislation` / `gxt_execute_legislation` | Two-step mission legislation with chat approval |
| `gxt_check_signature` / `gxt_pin_mission` | Teacher stamp check + pin active mission |
| `gxt_start_orchestration` | Goal-first flow: triage → legislate stub → optional pin/runtime env |
| `gxt_runtime_env` / `gxt_runtime_exec` | Worker bootstrap + process-boundary enforcement |
| `gxt_verify` | Structured verify phases with `fix_hints` on failure |
| `gxt_resolve_mission` / `gxt_last_error` | Mission resolution + last runtime exec error |

## Enforcement boundary (where the cage is ironclad)

| Tier | Mechanism | What it actually traps |
|------|-----------|------------------------|
| **Process-boundary** | `gapman runtime exec` | TMVC roots + forbidden zones for subprocess workers |
| **Deterministic hook** | Tool hooks (today: Cursor `beforeShellExecution` on law/manifest paths) | Shell writes to `.gitagent/foreman/`, `.gitagent/teacher/RULES.md` |
| **Advisory** | Rules / `AGENTS.md` / tool memory | IDE Agent Write/Edit — LLM compliance, not kernel enforcement |

**IDE agent file edits are not TMVC-trapped unless the tool runs inside `runtime exec`.** Docs here optimize context injection and workflow — not generic “be careful” advice.

## External IDE skills (edge quarantine)

Third-party agent skill packs (Cursor `SKILL.md`, community rule collections, dependency-aware generators) are **local IDE preferences** — not OpenGantry routing skills and not GXT law.

| Layer | What belongs | Enforcement |
|-------|----------------|---------------|
| **GXT core** | `RULES.md`, `MANIFEST.json`, mission YAML, deterministic gates | `gapman verify`, hooks, CI |
| **IDE edge** | Optional local rules/skills (gitignored) | None — advisory to the IDE only |
| **Result state** | Files on disk after any edit | Compile, tests, import layers, KPI gates |

**Zero-trust:** Git cannot attest *how* a line was produced. All incoming diffs are validated the same way. Do **not** add subjective coding-style packs to `AGENTS.md`, `.gitagent/`, or `gapman init` templates.

**Local wiring (adopters):** copy tool-specific examples only on the developer machine — e.g. Cursor: `.cursor/external-skills.local.mdc` (see specimen `.cursor/external-skills.local.example.mdc`). Cline: `.clinerules/*.local.md`. Keep GXT pointer files (`gxt.md`, `CLAUDE.md`) linking canonical law only.

**Optional `[SKILL-EXEC]` stamps:** workers may append one-line context to `WORKER_LOG.md` for human PR triage:

```text
[SKILL-EXEC] skill_key=<provider::skill> tool=<tool_name> scope=<path_or_glob>
```

Missing stamps are **not** verify failures. Stamps are not cryptographic proof and must not replace mission trace PASS quotes.

## Remote handoff (Teacher push → remote agent)

Enterprise async pattern:

1. **Teacher (local):** `gapman legislate … --msn MSN-NNNN` → tune mission → `git commit -m "[MSN-NNNN] legislate …"` (must modify mission file).
2. **Teacher push:** pre-push runs `gapman verify --mission … --pre-push` — **legislative stubs** pass after git-proof only (placeholder `trace_rows` or empty).
3. **Remote worker:** `source scripts/gxt-runtime-env.sh <mission>` → execute → append gate output to `WORKER_LOG.md`.
4. **Verifier (before merge):** full `gapman verify --mission <path>` (gate + trace).

Unlegislated mission files (no Teacher `[MSN-NNNN]` stamp) still **fail** pre-push.

## Canonical context files

Point every tool at the same GXT law — do not duplicate prose:

| File | Role |
|------|------|
| [`AGENTS.md`](../AGENTS.md) | Cross-tool entry: read RULES + MANIFEST before acting |
| [`.gitagent/teacher/RULES.md`](../.gitagent/teacher/RULES.md) | Governance law |
| [`.gitagent/foreman/MANIFEST.json`](../.gitagent/foreman/MANIFEST.json) | Routing map (TMVC roots, forbidden zones) |

`gapman init` scaffolds `AGENTS.md`, `.gitagent/ARCHITECTURE.pointer.json` (agent discovery for code layout), `docs/ARCHITECTURE.md` (default file target), selected IDE pointer files, runtime scripts, and composes **`docs/INTEGRATIONS.md`** (human adopter IDE setup — not LLM context) from shipped recipe fragments.

## Shared session variables

| Variable | Purpose |
|----------|---------|
| `GAPMAN_TEACHER_EMAILS` | Comma-separated Git author emails allowed to legislate (git-proof) |
| `GAPMAN_MISSION` | Optional mission path for `gxt-runtime-env.sh` when no arg passed |
| `GXT_*` | Emitted by `gapman runtime env` — TMVC roots, forbidden zones, worker log path |

Deprecated compat: `scripts/gxt-cursor-env.sh` sources `gxt-runtime-env.sh` with a stderr notice.

## Closed-loop checklist (all tools)

1. `gapman init` + `export GAPMAN_TEACHER_EMAILS="$(git config user.email)"` + `gapman doctor`
2. `gapman legislate "<intent>" --msn MSN-NNNN --skill-key <key>` → Teacher `[MSN-NNNN]` commit
3. Bootstrap: `source scripts/gxt-runtime-env.sh .gitagent/missions/<file>.yaml`
4. Worker executes; append PASS quotes to `WORKER_LOG.md`
5. `gapman verify --mission .gitagent/missions/<file>.yaml`
6. `git push` (pre-push uses `--pre-push` handoff semantics)

## Diagnostic context feed (verify repair loops)

When `gapman verify` fails, OpenGantry writes a machine-readable snapshot to **`.gitagent/tmp/NEXT_REMEDIATION.json`** (gitignored). IDE wrappers and agent rules can read this before the next prompt cycle:

```bash
gapman context-feed --json    # latest failure payload (empty when none)
gapman context-feed --clear   # atomic tombstone clear after remediation
```

Writes use temp-file + rename swap to avoid read/write races during automated test-and-repair loops.

## Compatibility matrix

| Tool | Context injection | Wrap / bootstrap |
|------|-------------------|------------------|
| **Cursor** | `.cursor/rules/opengantry-gxt-substrate.mdc` + `.cursor/hooks.json` + `.cursor/mcp.json` (`gxt_*` tools) | **Hook:** `sessionStart` auto-inject · `scripts/gxt-pin-mission.sh <mission>` · `source scripts/gxt-runtime-env.sh` |
| **Claude Code** | `CLAUDE.md` or `.claude/CLAUDE.md` → link canonical files | **Shell wrapper:** `scripts/gxt-shell-agent.sh claude <mission>` · `gapman runtime exec … -- claude "<task>"` |
| **OpenAI Codex CLI** | Root `AGENTS.md` (native); optional `.codex/config.toml` | **Shell wrapper:** `scripts/gxt-shell-agent.sh codex <mission>` · `gapman runtime exec … -- codex exec "<task>"` |
| **OpenCode** | `AGENTS.md` (native); optional `opencode.json` `instructions` | **Shell wrapper:** `scripts/gxt-shell-agent.sh opencode <mission>` · `gapman runtime exec … -- opencode run "<task>"` |
| **JetBrains Junie** | `.junie/AGENTS.md` or `.junie/guidelines.md` | **Manual:** Terminal → `source scripts/gxt-runtime-env.sh <mission>` |
| **Google Antigravity** | `AGENTS.md` + `.agent/rules/gxt.md` (`always_on`) | **Manual:** `gapman runtime exec … -- <agent-command>` |
| **Cline** | `.clinerules/gxt.md` + root `AGENTS.md` | **Manual:** Terminal → `source scripts/gxt-runtime-env.sh <mission>` |
| **Aider** | `.aider.conf.yml` `read:` list | **Manual:** `gapman runtime exec … -- aider --message "<task>"` |
| **OpenHands** | `.openhands/microagents/gxt.md` + root `AGENTS.md` | **Manual:** Terminal → `source scripts/gxt-runtime-env.sh <mission>` |

**Related tools (not duplicate matrix rows):**

- [Gemini Code Assist](https://developers.google.com/gemini-code-assist/docs/overview) — VS Code/JetBrains **plugin**; use the same three canonical files; distinct from the Antigravity agent-first IDE.
- **OpenAI Codex API** (2021–2023) — deprecated code-completion API; **not** [OpenAI Codex CLI](https://github.com/openai/codex) (2025+ terminal/IDE agent documented above).

Vendor CLIs change; the **wrap line** and **context files** do not.

---

## Per-tool closed loop

### Cursor

- **Context injection:** [`.cursor/rules/opengantry-gxt-substrate.mdc`](../.cursor/rules/opengantry-gxt-substrate.mdc) (`alwaysApply: true`); [`.cursor/hooks.json`](../.cursor/hooks.json) — `sessionStart` mission scope + `beforeShellExecution` fallback guard.
- **MCP bridge:** [`.cursor/mcp.json`](../.cursor/mcp.json) — `gapman mcp serve` exposes `gxt_*` tools for zero-copy-paste legislation.
- **Mission Architect:** `/gantry` macro (do not use `/plan` — Cursor native Plan Mode); implicit activation when user asks to **write/edit code** with no pinned mission. Follow [`.gitagent/teacher/MISSION-ARCHITECT.md`](../.gitagent/teacher/MISSION-ARCHITECT.md).
- **Two-step legislation (Yolo-safe):** `gxt_draft_legislation` → human chat approval (semantic yes/no) → `gxt_execute_legislation` → Teacher `git commit` → `gxt_check_signature` → `gxt_pin_mission`.
- **Host tool policy:** Cursor may require approval per tool call or auto-run all tools (“Yolo mode”). MCP draft/execute is the primary governance gate — not host settings alone.
- **Session bootstrap:**

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml   # once per feature
source scripts/gxt-runtime-env.sh   # integrated terminal (uses pinned mission)
```

- **Enforcement:** Advisory for Agent edits; MCP two-step gate for legislation; shell hook fallback for raw `gapman legislate` / law/manifest writes; use `runtime exec` for headless CLI/SDK runs.
- **Gotcha:** Enable hooks **and** MCP in Cursor Settings; restart if they do not load (**Output → Hooks**). Pin a mission before starting Agent work — unpinned sessions get a legislate reminder only.

**Substrate lifecycle:** After `npm install @jeger-ai/opengantry@latest`, run `gapman upgrade` → review `.gitagent/.upgrade-tmp/` → Teacher-commit the upgrade mission YAML → `gapman upgrade --apply --mission …`. MCP: `gxt_upgrade_plan` / `gxt_upgrade_apply`.

Headless:

```bash
gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- cursor agent "<task>"
```

### Claude Code

- **Context injection:** Minimal `CLAUDE.md` pointing at `AGENTS.md`, `RULES.md`, `MANIFEST.json` (keep under ~200 lines).
- **Session bootstrap (shell wrapper — no project hooks):**

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml
scripts/gxt-shell-agent.sh claude .gitagent/missions/MSN-0001.<slug>.yaml
gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- claude "<task>"
```

- **Enforcement:** Advisory in interactive session; process-boundary when wrapped with `runtime exec` or `gxt-shell-agent.sh`.
- **Gotcha:** Claude Code does not execute project hook directories — use the shell wrapper. Link canonical files — do not copy full RULES into `CLAUDE.md`.

### OpenAI Codex CLI

- **Context injection:** Root [`AGENTS.md`](../AGENTS.md) (loaded automatically after `gapman init`). Optional [`.codex/config.toml`](https://developers.openai.com/codex/config-basic) for project defaults (sandbox, approval policy). Do not duplicate RULES/MANIFEST — link via `AGENTS.md`.
- **Session bootstrap (shell wrapper — no project hooks):**

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml
scripts/gxt-shell-agent.sh codex .gitagent/missions/MSN-0001.<slug>.yaml
# headless / CI:
gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- codex exec "<task>"
```

- **Enforcement:** Advisory in interactive TUI/IDE extension; **process-boundary** when wrapped with `runtime exec` or `gxt-shell-agent.sh`. Codex's own sandbox is separate from GXT TMVC.
- **Gotcha:** Codex CLI does not scan project hook folders. Codex sandbox/approval settings govern Codex — not GXT forbidden zones.

### OpenCode

- **Context injection:** Repo-root `AGENTS.md` (native after `gapman init`); optional:

```json
{ "instructions": ["AGENTS.md", ".gitagent/teacher/RULES.md"] }
```

- **Session bootstrap (shell wrapper — no project hooks):**

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml
scripts/gxt-shell-agent.sh opencode .gitagent/missions/MSN-0001.<slug>.yaml
```

- **Enforcement:** Advisory; `opencode.json` permissions are separate from GXT TMVC.
- **Gotcha:** OpenCode does not execute project hook directories. OpenCode prefers `AGENTS.md` over `CLAUDE.md` when both exist.

### JetBrains Junie

- **Context injection:** `.junie/AGENTS.md` (same bullets as root `AGENTS.md`).
- **Session bootstrap:** IDE terminal → `source scripts/gxt-runtime-env.sh <mission>`.
- **Enforcement:** Advisory (guidelines); no process trap for in-IDE edits.
- **Gotcha:** Use `.junie/AGENTS.md`, not generic AI Assistant project rules, for Junie-specific loading.

### Google Antigravity

- **Context injection:** Root `AGENTS.md`; optional `.agent/rules/gxt.md` with `always_on` pointing at canonical files.
- **Session bootstrap:** `source scripts/gxt-runtime-env.sh <mission>` or `gapman runtime exec … -- <command>`.
- **Enforcement:** Advisory for Editor/Manager views; process-boundary for wrapped CLI runs.
- **Gotcha:** Rules load order includes `GEMINI.md` → `AGENTS.md` → `.agent/rules/` — keep GXT pointers in `AGENTS.md`.

### Cline

- **Context injection:** `.clinerules/gxt.md`; root `AGENTS.md` appears in Rules panel.
- **Session bootstrap:** VS Code terminal → `source scripts/gxt-runtime-env.sh <mission>`.
- **Enforcement:** Advisory; toggle rules in Cline panel without deleting files.
- **Gotcha:** Cline also reads `.cursorrules` legacy paths — prefer `.clinerules/gxt.md` for GXT-specific policy.

### Aider

- **Context injection:** `.aider.conf.yml`:

```yaml
read:
  - AGENTS.md
  - .gitagent/teacher/RULES.md
  - .gitagent/foreman/MANIFEST.json
```

- **Session bootstrap:**

```bash
gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- aider --message "<task>"
```

- **Enforcement:** **Process-boundary** when wrapped — strongest TMVC trap among common IDE-adjacent tools.
- **Gotcha:** Run from repo root; `read:` paths resolve from CWD.

### OpenHands

- **Context injection:** `.openhands/microagents/gxt.md` pointing at canonical GXT files.
- **Session bootstrap:** `source scripts/gxt-runtime-env.sh <mission>` then run OpenHands against the repo.
- **Enforcement:** Advisory for in-IDE edits; process-boundary when wrapped with `runtime exec`.
- **Gotcha:** Keep microagent prose minimal — link `AGENTS.md`, do not duplicate RULES.

---

## Troubleshooting

| Symptom | Meaning | Fix |
|---------|---------|-----|
| `NO_MSN_COMMITS` on push | Mission changed but **never Teacher-stamped** | `git commit -m "[MSN-NNNN] …"` modifying the mission file; set `GAPMAN_TEACHER_EMAILS` |
| Pre-push OK, full verify fails trace | Legislative handoff succeeded; execution incomplete | Remote worker fills `WORKER_LOG.md`; align `trace_rows`; re-run full verify |
| `TEACHER_IDENTITY_UNCONFIGURED` | Missing Teacher allowlist | `export GAPMAN_TEACHER_EMAILS="$(git config user.email)"` |
| Full verify fails after execution | Corrupt trace or gate failure | Fix quotes in `WORKER_LOG.md` or gate command output |

Mission git-proof details: [`.gitagent/missions/README.md`](../.gitagent/missions/README.md).

Adopter bootstrap: [`docs/ADOPTION.md`](ADOPTION.md). Runtime contract: [`.gitagent/teacher/RUNTIME.md`](../.gitagent/teacher/RUNTIME.md).
