# Out-of-scope ADRs (Planner gate + Foreman hints)

Markdown files in this directory are **Architectural Decision Records (ADRs)** for decisions the team will not revisit without explicit governance.

- **Foreman routing** stays manifest-only ([`.gitagent/foreman/SOUL.md`](../foreman/SOUL.md)). `gantry triage` may attach **non-binding `adr_hints`** when an ACTIVE ADR's optional `match_terms` overlap the intent string.
- **Planner** MUST review relevant ADRs when legislating missions so work stays aligned with prior decisions.

Optional frontmatter (YAML between `---` lines at file start):

- `id`: stable id (e.g. `ADR-0001`)
- `title`: short title
- `status`: `ACTIVE` | `SUPERSEDED`
- `match_terms`: list of lowercase-ish substrings; if any appear in the user intent, triage may surface an `adr_hint` (Planner still decides).

Body: context, decision, and consequences in plain prose.
