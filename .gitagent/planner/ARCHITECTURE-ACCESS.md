# Architecture access (authenticated sources)

Read this **before** fetching external architecture documentation when [`.gitagent/ARCHITECTURE.pointer.json`](../ARCHITECTURE.pointer.json) has `"access": { "required": true }`.

## Goal

Discover **which tool** hosts architecture docs, **how authentication works**, obtain credentials **without exposing secrets in chat or git**, then read layout docs and proceed under GXT rules.

## 1. Read the pointer

From the repo root, load `.gitagent/ARCHITECTURE.pointer.json`:

- `kind`, `location`, `read_hint` — where docs live
- `access.tool` — expected system (Confluence, Linear, Notion, custom MCP, …)
- `access.detect` — signals to probe first (MCP server id, env prefix, host substring)
- `access.auth_hint` — team-specific auth notes (PAT, OAuth, SSO, …)
- `access.credential_slot` — local storage key (git-ignored)

## 2. Detect existing access (do not ask yet)

Check in order:

1. **MCP / IDE integrations** — list configured MCP servers and tools; match `access.detect` and `access.tool`.
2. **Environment** — env vars suggested by `access.detect` or `auth_hint` (never print values).
3. **Stored credentials** — run `gantry arch cred status` (or `--slot <credential_slot>`). Status shows slot + kind only, never secrets.
4. **User docs** — project README / human INTEGRATIONS doc for team setup (not duplicated here).

If a path already works, record in `EXECUTOR_LOG.md` which method you used (not the secret) and fetch architecture docs.

## 3. Ask the user when detection fails

Ask **one focused question at a time**:

- Which system hosts architecture docs? (confirm or override `access.tool`)
- How does your team authenticate? (PAT, API key, OAuth device flow, MCP already configured, …)
- Whether you may store a credential locally via `gantry arch cred set` (git-ignored, mode 600)

**Never** ask the user to paste tokens into chat, commits, or `EXECUTOR_LOG.md`.

## 4. Store credentials securely

Use **`gantry arch cred set`** — secrets on **stdin only**, never argv:

```bash
# Bearer / PAT
printf '%s' 'YOUR_TOKEN' | gantry arch cred set --slot architecture/confluence --kind bearer

# API key
printf '%s' 'YOUR_KEY' | gantry arch cred set --slot architecture/notion --kind api_key

# Basic auth (JSON on stdin)
printf '%s' '{"username":"you@corp.com","password":"…"}' | gantry arch cred set --slot architecture/wiki --kind basic
```

Files live under **`.gitagent/history/credentials/`** (git-ignored). Verify with `gantry arch cred status`.

To remove: `gantry arch cred unset --slot <name>`.

## 5. Context request (GXT)

Before first access to an **external** architecture source, log a **Context Request** in `EXECUTOR_LOG.md`: tool name, URL/host, auth method (not secrets), and why layout docs are needed. Wait for Verifier acceptance when tier/policy requires it.

## 6. Read architecture docs

Follow `read_hint` and consume layout boundaries. Align edits with `tmvc_roots` in MANIFEST.

## Specimen note

This OpenGantry repo uses `kind: file` → `docs/ARCHITECTURE.md` (no auth). The access flow applies when adopters point at authenticated external wikis.
