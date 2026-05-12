# Agent instructions (OpenGantry)

Before planning, editing code, or running substantive commands in this repository:

1. Read **`.gitagent/teacher/RULES.md`** — governance (SOD, trace mapping, risk tiers, dynamic TMVC, Rule 4.4).
2. Read **`.gitagent/foreman/MANIFEST.json`** — Foreman map (`schema_version`, per-skill `trust_threshold`, `tmvc_roots`, `forbidden_zones`, `path_risks`, `risk_keywords`).

Treat these as the **law + routing contract** for agent work. For orientation and workflow, see **`.gitagent/README.md`**. For **`gapman`** (verify, triage, `GAPMAN_TEACHER_EMAILS`, mission paths), see the root **`README.md`** § gapman.

When legislating missions, review **`.gitagent/out-of-scope/`** for relevant ADRs (Teacher obligation per **RULES**).

If the user clearly scopes work to something that cannot affect OpenGantry (e.g. a typo in unrelated docs), still skim **RULES** and **MANIFEST** when the change could touch skills, missions, routing, or manifest sync.
