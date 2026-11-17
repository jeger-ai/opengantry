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

- `apiBaseUrl` defaults to `https://api.github.com` and `gitBaseUrl` to `https://github.com`. For GitHub Enterprise Server set both: `"apiBaseUrl": "https://HOST/api/v3"` (GHES serves its REST API under `/api/v3`; every request path is joined below it) and `"gitBaseUrl": "https://HOST"`. Each must be an https URL with no credentials, query or fragment. `gitBaseUrl` takes no path, and `apiBaseUrl` takes none but exactly `/api/v3`. Plain http is accepted only on a loopback address, for tests.
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
  - The commit and its whole history must be present in the repository's own objects (see below).
  - The remote ref must hold exactly `expectedOldHead`.
- How it pushes:
  - From a broker-private bare repository that holds a **copy** of the repository's object files, never borrowed through `objects/info/alternates`. Git follows alternates recursively, so a borrowed store would let a candidate that writes `objects/info/alternates` make the broker push history from a repository the sandbox denies.
    - The repository is the one whose git dir the broker resolved at start, without running git. `<root>/.git` must be a real directory (not a symlink), or a file with one `gitdir:` line that names `<common>/worktrees/<name>`, whose `gitdir` back-pointer names exactly `<root>/.git` and whose `commondir` names `<common>`. Anything else refuses `serve`: a `.git` file rewritten to point at another repository or at another repository's worktree entry, and also a submodule's `.git` file (`modules/<name>`).
    - A `.git/commondir` is accepted only in a linked worktree (`<common>/worktrees/<name>`), and only when it names that parent; any other `commondir` is refused.
    - Only loose objects and `objects/pack/pack-*.pack` and `.idx` are copied. `objects/info/*` (alternates, http-alternates, commit-graph) is skipped. Every directory and file is opened without following symlinks, and anything that is not a regular file is skipped. A file with more than one hard link refuses the publish: its other name may be a file the sandbox cannot read. `git clone --local` (the default for a clone from a local path) hardlinks objects; run `git repack -a -d` in such a repository first. More than 8 GiB of objects is refused.
    - `git rev-list --objects --missing=error <commit>` must succeed in the private repository, which has no alternates. An incomplete history (for example a shallow clone, or objects only reachable through the candidate's alternates) refuses.
  - Git never runs inside the candidate's repository. The candidate files the broker reads are exactly: `<git dir>/commondir` (if present), `<common dir>/config` (only the `url` lines of the named remote, parsed by the broker, `include`/`includeIf` not followed), and the object files above. The candidate's hooks, `insteadOf` rules, includes and credential helpers never reach a git the broker runs. The push URL always comes from the host config.
  - With a clean environment: no system or global config, hooks off, only the https protocol, no redirects.
  - The token is an `http.extraHeader` passed through `GIT_CONFIG_COUNT`, so it is never on an argv. The push command is `--force-with-lease=<ref>:<expectedOldHead>`, never a plain force. The remote's conditional ref update is the race boundary: a concurrent writer wins.
- After the push, the broker reads the ref back. If it holds the requested commit, the push is `confirmed`.
- The push is `failed` only when git's `--porcelain` output definitely refuses the ref: a `!` line for it with `[rejected]` (the lease or a fast-forward check, `(stale info)`, decided before anything is sent) or `[remote rejected]` (the remote says it refused the update, for example a pre-receive hook). The exit status alone never makes it `failed`: the remote may have taken the push and lost the acknowledgement, and another writer may have moved the ref before the read-back.
- Anything else is `unknown`: a timeout, a dropped connection, another non-zero exit without such a line (`[remote failure]` included), or a read-back that holds neither the commit nor a definite refusal. `reconcile` settles it by reading the ref.

**`delivery.mutate`**
- Arguments: `{"head": "feature/x", "base": "main", "title": "…", "body": "…"}`.
- Resource identity:
  - `host`: the API host, for example `api.github.com`;
  - `project`: `owner/repo`;
  - `objectType: "pull-request"`, `mutation: "create"`, `precondition: {"kind": "absent"}`;
  - `objectId: "pr-" + sha256` of head, base and the sha256 of the title and the body.
- Behaviour:
  - Idempotency is keyed on head and base. An open pull request for the same head and base is success, with its number. If its title or body differ from the request, the reply's result carries `titleMismatch: 1` or `bodyMismatch: 1` (bound in the receipt's evidence digest); the broker does not edit it.
  - Otherwise the broker sends one `POST /repos/{owner}/{repo}/pulls`.
  - A 4xx is `failed`.
  - A 5xx, a timeout or a lost answer is `unknown`.

**`{"type":"reconcile","request":{…},"args":{…}}`** settles an `unknown` host attempt.
- Send the original request and arguments. The request digest must be the one journaled for that attempt.
- The broker reads; it never acts:
  - for a push, the remote ref. Only our commit settles it (`reconciled-confirmed`). Any other value is **inconclusive**, including the expected old value: another writer may have reset the ref after our push landed, so that value doesn't prove the push failed. The broker never infers failure from a ref, and it never pushes again.
  - for a pull request, the pull requests for that head and base in every state (`state=all`). An open one confirms. A merged or closed one confirms only if its number is above the floor the broker recorded before the create, and its title and body are the request's. The floor is the highest pull request number for that head and base seen in the pre-create lookup (`state=all`), written and fsynced to `<state dir>/host-attempts/` before the POST. Only a missing floor file (`ENOENT`) means no floor; a floor file that cannot be read or parsed is inconclusive, since the POST may have been sent. With no floor the create was never sent: no merged or closed one confirms, and no match is `reconciled-failed`. With a floor and no match the read is **inconclusive**: the POST may have been sent and may still complete on GitHub after its answer was lost. The attempt stays `unknown`, no new attempt of the operation can start (so no second pull request can be created), and you reconcile again later; once the pull request appears, it confirms.
  - The pulls list is read as one page of 100. A full page refuses as ambiguous: before a create that is `failed` (nothing created), and when reconciling it is inconclusive.
- It journals the result as `reconciled-confirmed` or `reconciled-failed`. An inconclusive read journals nothing. A push whose ref does not hold the new commit stays `unknown`. A pull request create whose floor was recorded stays `unknown` until a matching pull request appears.
- **Operator assertion** (when you know the effect did not happen): stop the broker, then run `gantry admission reconcile --assume-failed <operationId>/<attemptId>` outside the sandbox. It takes the broker's instance lock in the state dir, so it refuses while a broker runs. The cage denies the state dir, so the command can't run from inside the sandbox. It journals `reconciled-failed` with `provenance.observer: "operator-assertion"`, and its evidence digest is the digest of the assertion (attempt, request digest, the prior record and your user name). It's an assertion, not an observation. The next broker replays it at start, and a new attempt may then be prepared. No socket message can assert failure. If the push or pull request did happen after all, the new attempt finds it: a push lease against the old value fails, and an open pull request counts as existing.
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
- **A pull request opened by someone else for the same head and base after the pre-create lookup**, and closed before reconciling with the request's title and body, reads as `reconciled-confirmed`. An older one does not: it is at or below the recorded floor.
- **More than 100 pull requests for one head and base** refuse the create; the client is not paginated.
- **Copy cost.** Every push copies the repository's object files into the broker's private dir first. A very large repository makes each push slower, and over 8 GiB refuses.
- **Not implemented:** OIDC credentials for CI, pull request comments and any other host operation.
- **Not yet run against real GitHub** (the open item above).
