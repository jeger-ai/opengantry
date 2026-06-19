# Gantry minimal specimen

Same task as [`../contrast-agent-script/`](../contrast-agent-script/): versioned `greet()` + smoke test — scoped by **mission YAML** and a deterministic gate instead of a standalone orchestrator.

## Artifacts (~25 LOC of law)

Mission file (Teacher commits before worker run):

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

Manifest skill `logic` declares `tmvc_roots: ["src/lib/"]` — edits outside that path require `gapman context-request`.

## Closed loop (headless-friendly)

```bash
gapman init --yes --no-ci
gapman teacher set "$(git config user.email)"
gapman legislate "Add greeting VERSION export" --msn MSN-0001 --skill-key logic \
  --gate-command "npm test" --gate-success-substring "pass"
git add .gitagent/missions/MSN-0001.*.yaml
git commit -m "[MSN-0001] legislate mission"
eval "$(gapman runtime env --mission .gitagent/missions/MSN-0001.add-greeting-version.yaml)"
# … edit src/lib/greeting.js within TMVC …
echo "- MSN-0001: greet exports VERSION and smoke test passes" >> WORKER_LOG.md
gapman verify --mission .gitagent/missions/MSN-0001.add-greeting-version.yaml
git log --grep='MSN-0001' --oneline
```

## Run smoke test locally (this folder only)

```bash
npm test
```

## Compare

| | Script specimen | This specimen |
|--|-----------------|---------------|
| Orchestrator | [`agent-run.mjs`](../contrast-agent-script/agent-run.mjs) (~180 LOC) | `gapman` primitives + mission YAML |
| Audit | `.agent-state.json` | Git + `WORKER_LOG.md` |
| Scope | Heuristic | `tmvc_roots` / forbidden zones |

Benchmark: [`../../scripts/benchmark-scaffold.sh`](../../scripts/benchmark-scaffold.sh) · Practice: [`../../docs/KATA.md`](../../docs/KATA.md).
