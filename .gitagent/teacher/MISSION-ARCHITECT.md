# Mission Architect (Teacher-Assistant Contract)

IDE chat protocol for drafting missions **before** worker execution. No CLI chatbot. No agent-authored Git commits.

## When to activate

**Activate only when all are true:**

1. The user **explicitly** asks to write, edit, refactor, add, fix, or implement code (or equivalent action intent).
2. No pinned/legislated mission covers the work (`.gitagent/missions/.active-mission` absent or stale).

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
2. Present **one** copy-paste `gapman legislate` command.
3. Ask for **single yes/no** confirmation — no 3-phase interview.

### Full 3-phase interview (heavy work)

Use for new features, multi-file scope, forbidden-zone proximity, path_risks/risk_keywords hits, ambiguous skill, or when the user requests mission planning.

| Phase | Focus |
|-------|--------|
| **1 — Boundary** | Skill, TMVC roots, forbidden zones |
| **2 — Risk** | Concrete paths; escalation flags |
| **3 — Verification** | Agree `gate_command` + success substring; DoD → future trace rows |

## Handoff (legislate only)

**Forbidden:** multi-line YAML mission blocks, “save this file manually” instructions.

**Required:** one bash command the user copies into their terminal:

```bash
gapman legislate "<intent summary>" --msn MSN-NNNN --skill-key <key> \
  --gate-command "<deterministic gate shell command>" \
  --gate-success-substring "<optional substring>"
```

- Quote `--gate-command` when it contains spaces (e.g. `"npm run test:ui -- --watchAll=false"`).
- Omit `--gate-success-substring` when exit code 0 alone is sufficient.
- `legislate` writes `.gitagent/missions/MSN-NNNN.<slug>.yaml` with `status: PENDING` stub trace rows.

**Stop after handoff.** Do not write application code until the Teacher commits and pins the mission.

## Teacher loop (human)

1. Paste and run the `gapman legislate` command.
2. Optionally review/edit the generated YAML.
3. `git commit -m "[MSN-NNNN] legislate …"` including the mission file (Teacher email in `GAPMAN_TEACHER_EMAILS`).
4. `scripts/gxt-pin-mission.sh .gitagent/missions/MSN-NNNN.<slug>.yaml`
5. Worker phase begins.

## Worker phase (after pin)

Edit within TMVC → append PASS quotes to `WORKER_LOG.md` → `gapman verify --mission …` → pin stays until mission complete.
