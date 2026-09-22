### Aider

- **Context injection:** `.aider.conf.yml` with `read:` list for canonical GXT files.
- **Session bootstrap:**

```bash
gantry runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- aider --message "<task>"
```

- **Enforcement:** Process-boundary when wrapped — strongest TMVC trap among IDE-adjacent tools. `gantry hooks install` arms `gantry tmvc guard --strict` on the tracked pre-commit hook. Bypass is `git commit --no-verify` only.
- **Scope note:** `gantry runtime env --aider` writes `.gitagent/tmp/aider-tmvc-scope.md` and appends it to an existing `.aider.conf.yml` `read:` list once. `GANTRY_TMVC_ROOTS` from `gantry runtime env` is the space-separated repo-relative cage for other terminal harnesses.
- **Gotcha:** Run from repo root; `read:` paths resolve from CWD.

Vendor docs: https://aider.chat/docs/
