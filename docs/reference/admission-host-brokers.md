---
title: "Admission host brokers (operator notes)"
description: "The GitHub App behind the broker's push and PR dispatchers: minimal permissions, where the key goes, the host config, and what is not claimed."
publish: false
---

# Admission host brokers (operator notes)

With a host config, the admission broker ([operator notes](admission-broker.md)) gains two typed host brokers, per [ADR-0063](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0063-operation-admission-contract.md) owner decision Q7:

- **`git.publish`** pushes one exact commit to a branch of one configured GitHub repository. It never pushes to the default branch or to a protected pattern.
- **`delivery.mutate`** creates one pull request in that repository. It does nothing else: no comments, merges or releases.

The broker holds the credential, a short-lived GitHub App installation token. The candidate gets decisions and receipt digests, never the token.

> **Open item: live proof against GitHub.** Everything here is tested offline only, against a local bare repository and a fake GitHub API. Nothing has run against real GitHub, because that needs the repository owner to create the GitHub App below. Until then, treat both brokers as unproven against the real API.

## 1. Create the GitHub App (owner)

Create the App under the account or organization that owns the repository: Settings, then Developer settings, then GitHub Apps, then New GitHub App.

- **Webhook:** turn it off (clear "Active"). The broker never receives events.
- **Repository permissions:**
  - Contents: **Read and write**, for pushing branches.
  - Pull requests: **Read and write**, for creating and looking up pull requests.
  - Metadata: Read. GitHub adds this to every App.
  - Leave every other permission at "No access". The broker refuses a token that carries anything more than these three.
- **Workflows: leave at "No access".** GitHub then refuses any push that changes `.github/workflows/`, even through the broker. That is intended.
- **Where can this App be installed:** only on this account.

After creating it:

1. Note the **App ID**.
2. Generate a **private key**. GitHub downloads a `.pem` file.
3. Install the App on **only the one repository** the broker serves, and note the **installation ID**. It is the number at the end of the installation's settings URL.

Keep branch protection or a ruleset on the default branch on GitHub as well. The broker refuses that branch itself, but GitHub's own rule is the backstop if the broker is wrong.

## 2. Put the key where only the broker reads it

The key lives in the broker's admission directory under the per-user state dir: `~/.opengantry/admission/` (or `$GANTRY_STATE_DIR/admission/`). `gantry cage policy` denies that directory to the sandbox.

```bash
install -d -m 700 ~/.opengantry/admission
install -m 600 ~/Downloads/<app>.private-key.pem ~/.opengantry/admission/github-app.pem
```

The broker checks the key file at start and before every token exchange, and refuses it when:

- it is not under the admission directory, or it is a symlink;
- it is not a regular file owned by you;
- it has any group or other permission bit (it must be mode `0600` or `0400`);
- it is not an RSA private key.

## 3. Write the host config and start the broker

`~/.opengantry/admission/host.json`, mode `0600`, schema `opengantry.admission-host.v1`:

```json
{
  "schema": "opengantry.admission-host.v1",
  "github": {
    "repository": "acme/widgets",
    "protectedBranches": ["release/*", "hotfix/**"],
    "credential": { "kind": "github-app", "appId": "123456", "installationId": "78901234", "privateKeyFile": "github-app.pem" }
  }
}
```

- `apiBaseUrl` defaults to `https://api.github.com` and `gitBaseUrl` to `https://github.com`. Set both for GitHub Enterprise Server. Each must be an https URL with no path; plain http is accepted only on a loopback address, for tests.
- `protectedBranches` are ref globs: `*` matches within one path segment, `**` matches across segments. The remote's default branch, read from its `HEAD` at every push, is always refused as well.
- `privateKeyFile` is relative to the admission directory, or an absolute path under it.
- `credential.kind: "github-actions-oidc"` is **not implemented**. GitHub does not exchange an Actions OIDC token for an installation token unless a separate token-exchange service sits in between, so the broker refuses this kind at start.
- The host config gets the same file checks as the policy: a regular file of yours that is not group or world writable, in a directory that is not either, and outside the work tree.

```bash
gantry admission serve --harness claude-code --contract-digest <sha256> --host-config ~/.opengantry/admission/host.json
```

The admission policy must also allow the families: add rules with `kind: "git.publish"` and `kind: "delivery.mutate"`. Without `--host-config`, both families stay `unsupported` whatever the policy says.

## 4. Keep host tokens out of the sandbox

The App token stays in the broker's memory. Any token of the candidate's own still reaches GitHub directly, so remove it:

- **Claude Code:** `gantry cage policy --agent claude-code` emits `sandbox.credentials.envVars` with mode `deny` for `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN` and `GITHUB_ENTERPRISE_TOKEN`. Claude Code unsets these before each sandboxed command.
  - This covers **sandboxed Bash commands only**. It does not cover Claude Code's file tools, MCP servers, or a command run outside the sandbox.
  - `allowUnsandboxedCommands: false` in the same fragment keeps commands from running outside the sandbox.
  - The fragment already denies `~/.config/gh/hosts.yml`, `.git-credentials`, `.netrc` and the state dir.
- **Other harnesses** (Cursor, Codex CLI, headless) get no generated setting. Start them without `GH_TOKEN` or `GITHUB_TOKEN` in their environment, and without a logged-in `gh` or a git credential helper that holds a token.

## The protocol

The protocol is the broker's socket protocol, with two request kinds and one new message.

**`git.publish`**
- Arguments: `{"remote": "origin", "branch": "feature/x", "commit": "<sha>"}`.
- Resource identity:
  - `remoteUrl`: the canonical `https://github.com/<owner>/<repo>`;
  - `ref`: `refs/heads/<branch>`;
  - `expectedOldHead`: the remote's current value, or `null` when the branch must not exist yet;
  - `newHead`: the commit.
- Checks before the push:
  - The named remote must point at the configured repository.
  - The branch must be neither the default branch nor a protected one.
  - The commit must exist locally.
  - The remote ref must hold exactly `expectedOldHead`.
- How it pushes:
  - From a broker-private bare repository that borrows the work tree's objects (`objects/info/alternates`). The candidate's git config, hooks, `insteadOf` rules and credential helpers are never read.
  - With a clean environment: no system or global config, hooks off, only the https protocol, no redirects.
  - The token is an `http.extraHeader` passed through `GIT_CONFIG_COUNT`, so it is never on an argv. The push command is `--force-with-lease=<ref>:<expectedOldHead>`, never a plain force. The remote's conditional ref update is the race boundary: a concurrent writer wins, and the broker's push is `failed`.
- After the push, the broker reads the ref back. If it holds the requested commit, the push is `confirmed`. A contradictory or unreadable result is `unknown`.

**`delivery.mutate`**
- Arguments: `{"head": "feature/x", "base": "main", "title": "…", "body": "…"}`.
- Resource identity:
  - `host`: the API host, for example `api.github.com`;
  - `project`: `owner/repo`;
  - `objectType: "pull-request"`, `mutation: "create"`, `precondition: {"kind": "absent"}`;
  - `objectId: "pr-" + sha256` of head, base and the sha256 of the title and the body.
- Behaviour:
  - An open pull request for the same head and base is success, with its number.
  - Otherwise the broker sends one `POST /repos/{owner}/{repo}/pulls`.
  - A 4xx is `failed`.
  - A 5xx, a timeout or a lost answer is `unknown`.

**`{"type":"reconcile","request":{…},"args":{…}}`** settles an `unknown` host attempt.
- Send the original request and arguments. The request digest must be the one journaled for that attempt.
- The broker reads; it never acts:
  - for a push, the remote ref;
  - for a pull request, the open pull requests for that head and base.
- It journals the result as `reconciled-confirmed` or `reconciled-failed`. A push whose ref holds neither the new commit nor the expected old value stays `unknown`; settle it by hand.
- Nothing is dispatched again. After `reconciled-failed`, the client prepares a new attempt itself.

What the journal and replies carry:
- Receipts carry digests only.
- Replies carry the ref and observed commit, or the pull request number and URL.
- No token appears in the journal, a receipt, a reply or an argv. The tests check each of these.

## Credentials

- The broker signs an RS256 JWT with the App key (valid 9 minutes) and exchanges it at `POST /app/installations/{id}/access_tokens`. The request names the one repository and exactly `contents: write` and `pull_requests: write`.
- A token is kept in memory only, reused for at most 5 minutes, and never used within 2 minutes of its expiry.
- If GitHub grants more or less than requested, the broker refuses the token.
- The broker fetches the token before it consumes the permit. A revocation during the fetch refuses the dispatch.

## What is not claimed

- **No prevention.** No capability cell changes. These brokers give the candidate a path that needs no token, but nothing yet forces it to take that path. A candidate that still reaches a host token, `gh` or the API pushes directly (bypass B18 in the [coverage inventory](../concepts/operation-admission-coverage.md)). That changes only once a sandbox canary proves the candidate cannot reach a token or the API (ADR-0063 slice 4).
- **Same-user limits.** The broker runs as your user, outside the sandbox. While a push runs, the token is in the environment of the git child. Any process of yours that can read `/proc/<pid>/environ` or `ptrace` it, outside a PID-namespaced sandbox, can read it there. Whether the harness sandbox prevents that is not proven yet.
- **Reconcile is a read anyone on the socket can trigger.** It makes at most one GitHub read per message, with the broker's token. It changes nothing on GitHub.
- **A pull request created and closed** before reconciliation reads as `reconciled-failed`, because only open pull requests are looked up.
- **Not implemented:** OIDC credentials for CI, pull request comments and any other host operation.
- **Not yet run against real GitHub** (the open item above).
