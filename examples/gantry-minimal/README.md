# Gantry minimal specimen

Same task as [`../contrast-agent-script/`](../contrast-agent-script/): versioned `greet()` + smoke test — scoped by **mission YAML** and a deterministic gate instead of a standalone orchestrator.

## Artifacts (~25 LOC of law)

Mission file (Planner commits before executor run):

```yaml
# .gitagent/missions/MSN-0001.add-greeting-version.yaml
msn_id: MSN-0001
skill_key: logic
gate_command: npm test
gate_success_substring: pass
trace_rows:
  - dod_id: "1"
    trace_quote: "greet exports VERSION and smoke test passes"
    anchor: "MSN-0001"
    status: PENDING
```

Manifest skill `logic` declares `tmvc_roots: ["src/lib/"]` — edits outside that path require `gantry context-request`.

## Closed loop (headless-friendly)

```bash
gantry init --yes --no-ci
gantry planner set "$(git config user.email)"
gantry legislate "Add greeting VERSION export" --msn MSN-0001 --skill-key logic \
  --gate-command "npm test" --gate-success-substring "pass"
git add .gitagent/missions/MSN-0001.*.yaml
git commit -m "[MSN-0001] legislate mission"
eval "$(gantry runtime env --mission .gitagent/missions/MSN-0001.add-greeting-version.yaml)"
# … edit src/lib/greeting.js within TMVC …
echo "- MSN-0001: greet exports VERSION and smoke test passes" >> EXECUTOR_LOG.md
gantry verify --mission .gitagent/missions/MSN-0001.add-greeting-version.yaml
git log --grep='MSN-0001' --oneline
```

## Run smoke test locally (this folder only)

```bash
npm test
```

## Compare

| | Script specimen | This specimen |
|--|-----------------|---------------|
| Orchestrator | [`agent-run.mjs`](../contrast-agent-script/agent-run.mjs) (pedagogical — anti-patterns in one file) | `gantry` primitives + mission YAML |
| Audit | `.agent-state.json` | Git + `EXECUTOR_LOG.md` |
| Scope | Heuristic | `tmvc_roots` / forbidden zones |

Benchmark: [`../benchmark-agent/`](../benchmark-agent/) · [`../../scripts/benchmark-scaffold.sh`](../../scripts/benchmark-scaffold.sh) · Practice: [`../../docs/KATA.md`](../../docs/KATA.md).
