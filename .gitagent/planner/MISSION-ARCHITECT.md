# Mission Architect (Planner-Assistant Contract)

IDE chat protocol for drafting missions **before** executor execution. No CLI chatbot. No agent-authored Git commits.

## When to activate

**Activate when any of these are true:**

1. User prompt **starts with** `/gantry` (explicit macro — planning-only prompts included). Do not use `/plan`; Cursor reserves it for native Plan Mode.
2. User **explicitly** asks to write, edit, refactor, add, fix, or implement code (or equivalent action intent) **and** no pinned/legislated mission covers the work (`.gitagent/missions/.active-mission` absent or stale).

**Do NOT activate for:**

- Questions (“how does auth work?”, “explain this function”)
- Read-only navigation, code discovery, or architecture exploration
- Docs-only questions unless the user asks to edit docs
- Casual conversation

When inactive, answer normally — do not mention this protocol.

## Phase 0 (silent reads)

Before proposing legislation, read (do not lecture the user):

- `.gitagent/foreman/MANIFEST.json` — skills, TMVC roots, forbidden zones, path_risks, risk_keywords
- `.gitagent/ARCHITECTURE.pointer.json` — code layout (if `kind=unset`, follow ARCHITECTURE-DISCOVERY.md and ask)
- Optional: `.gitagent/out-of-scope/` ADRs when scope is ambiguous

**Do not** run `gapman triage` in chat. Reason from manifest + architecture directly.

## Fast-path vs full interview

### Fast-path (trivial work)

Use when the change is trivial, low-risk, and clearly confined (e.g. single existing file, cosmetic tweak, obvious skill from manifest).

1. Infer `skill_key`, `gate_command`, and MSN (ask for MSN only if unknown).
2. Present legislation handoff (MCP tools preferred in Cursor — see below).
3. Ask for **single yes/no** confirmation — no 3-phase interview.

### Full 3-phase interview (heavy work)

Use for new features, multi-file scope, forbidden-zone proximity, path_risks/risk_keywords hits, ambiguous skill, or when the user requests mission planning.

| Phase | Focus |
|-------|--------|
| **1 — Boundary** | Skill, TMVC roots, forbidden zones |
| **2 — Risk** | Concrete paths; escalation flags |
| **3 — Verification** | Agree `gate_command` + success substring; DoD → future trace rows |

## Handoff (legislate only)

**Forbidden:** multi-line YAML mission blocks, “save this file manually” instructions, agent-authored Planner git commits.

### Cursor MCP (preferred — zero copy/paste)

When the OpenGantry MCP server is configured (`.cursor/mcp.json`):

1. Call **`gxt_draft_legislation`** with `title`, `msn_id`, `skill_key`, `gate_command`, optional `gate_success_substring`.
2. Present the returned `chat_message_to_user` to the human.
3. Wait for clear approval intent in chat (`yes`, `approve`, `looks good`, `do it`) or rejection (`no`, `deny`, `stop`). If ambiguous, ask one short clarification.
4. On approval only, call **`gxt_execute_legislation`** with the `draft_token`.
5. Render the returned `suggested_human_action` in a fenced shell block for the Planner commit.
6. After the human commits, call **`gxt_check_signature`**. On `signature_valid`, proceed to **`gxt_pin_mission`** then executor phase.

This two-step draft/execute gate prevents silent legislation even when Cursor runs tools in auto-run (“Yolo”) mode.

### CLI fallback (terminal)

One bash command the user copies into their terminal:

```bash
gapman legislate "<intent summary>" --msn MSN-NNNN --skill-key <key> \
  --gate-command "<deterministic gate shell command>" \
  --gate-success-substring "<optional substring>"
```

- Quote `--gate-command` when it contains spaces (e.g. `"npm run test:ui -- --watchAll=false"`).
- Omit `--gate-success-substring` when exit code 0 alone is sufficient.
- `legislate` writes `.gitagent/missions/MSN-NNNN.<slug>.yaml` with `status: PENDING` stub trace rows.

**Stop after handoff.** Do not write application code until the Planner commits and pins the mission.

## Planner loop (human)

1. Approve draft (MCP) or paste and run `gapman legislate` (CLI).
2. Optionally review/edit the generated YAML.
3. `git commit -m "[MSN-NNNN] legislate …"` including the mission file (Planner email in `GAPMAN_PLANNER_EMAILS`).
4. `scripts/gxt-pin-mission.sh .gitagent/missions/MSN-NNNN.<slug>.yaml` (or `gxt_pin_mission` MCP tool).
5. Executor phase begins.

## Executor phase (after pin)

Edit within TMVC → append PASS quotes to `EXECUTOR_LOG.md` → `gapman verify --mission …` (or `gxt_verify` MCP tool) → pin stays until mission complete.
