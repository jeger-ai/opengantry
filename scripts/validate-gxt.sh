#!/usr/bin/env bash
# OpenGantry local + CI validation. Keep path-prefix rules in sync with
# .github/workflows/gxt-validate.yml (msn_commits job).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "validate-gxt: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

MANIFEST_REL=".gitagent/foreman/MANIFEST.json"
BYPASS_SHA256_REL=".gitagent/foreman/BYPASS.sha256"
GXT_BYPASS_NOTES_REF="refs/notes/gxt-bypass"

# Returns 0 if commit has a valid gxt-bypass git note (JSON v1 + reason >= 10 chars).
commit_has_gxt_bypass_note() {
  local commit="$1"
  local note
  note="$(git notes --ref="$GXT_BYPASS_NOTES_REF" show "$commit" 2>/dev/null)" || return 1
  printf '%s' "$note" | jq -e '.v == 1 and (.reason | type == "string") and (.reason | length >= 10)' >/dev/null 2>&1
}

# Returns 0 when GXT_BYPASS_SECRET matches BYPASS.sha256 anchor (never commit the secret).
is_bypass_secret_authorized() {
  local anchor secret secret_hash
  [[ -n "${GXT_BYPASS_SECRET:-}" ]] || return 1
  [[ -f "$BYPASS_SHA256_REL" ]] || return 1
  anchor="$(grep -E '^[a-fA-F0-9]{64}$' "$BYPASS_SHA256_REL" | head -1 | tr '[:upper:]' '[:lower:]')"
  [[ -n "$anchor" ]] || return 1
  secret_hash="$(printf '%s' "$GXT_BYPASS_SECRET" | sha256sum | awk '{print $1}' | tr '[:upper:]' '[:lower:]')"
  [[ "$anchor" == "$secret_hash" ]]
}

# Returns 0 if this path should trigger [MSN-XXXX] subject enforcement.
is_gxt_path() {
  local p="$1"
  [[ "$p" == .gitagent/* || "$p" == .gitagent ]] && return 0
  [[ "$p" == "WORKER_LOG.md" ]] && return 0
  [[ "$p" == .githooks/* || "$p" == .githooks ]] && return 0
  [[ "$p" == ".github/workflows/gxt-validate.yml" ]] && return 0
  return 1
}

cmd_upgrade_tmp() {
  local tracked
  tracked="$(git ls-files '.gitagent/.upgrade-tmp' 2>/dev/null || true)"
  if [[ -n "$tracked" ]]; then
    echo "upgrade-tmp check FAILED: tracked files under .gitagent/.upgrade-tmp/ (must be gitignored staging only)" >&2
    printf '%s\n' "$tracked" >&2
    exit 1
  fi
  echo "upgrade-tmp OK (no tracked staging files)"
}

cmd_manifest() {
  local M="$MANIFEST_REL"
  test -f "$M"
  jq -e . "$M" >/dev/null
  jq -e '.schema_version | type == "string" and length > 0' "$M" >/dev/null
  jq -e '.skills | type == "object" and (. | length > 0)' "$M" >/dev/null
  jq -e '.path_risks | type == "object"' "$M" >/dev/null
  jq -e '.risk_keywords | type == "array"' "$M" >/dev/null
  local k
  while IFS= read -r k; do
    jq -e --arg k "$k" '.skills[$k] | has("trust_threshold") and has("tmvc_roots") and has("forbidden_zones")' "$M" >/dev/null
    jq -e --arg k "$k" '.skills[$k].tmvc_roots | type == "array"' "$M" >/dev/null
    jq -e --arg k "$k" '.skills[$k].forbidden_zones | type == "array"' "$M" >/dev/null
  done < <(jq -r '.skills | keys[]' "$M")
  echo "MANIFEST OK"
}

cmd_msn() {
  local base_ref="$1"
  local head_ref="$2"
  local base_sha head_sha commit subject f touched

  base_sha="$(git rev-parse --verify "${base_ref}^{commit}")"
  head_sha="$(git rev-parse --verify "${head_ref}^{commit}")"

  while IFS= read -r commit; do
    [[ -n "$commit" ]] || continue
    touched=0
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      if is_gxt_path "$f"; then
        touched=1
        break
      fi
    done < <(git diff-tree --no-commit-id --name-only -r "$commit" 2>/dev/null || true)

    if [[ "$touched" -eq 0 ]]; then
      continue
    fi

    subject="$(git log -1 --format=%s "$commit")"
    if [[ "$subject" =~ ^\[MSN-[0-9]{4}\] ]]; then
      continue
    fi
    if commit_has_gxt_bypass_note "$commit"; then
      continue
    fi
    echo "MSN check FAILED: commit $commit touches GXT paths but subject does not start with [MSN-NNNN] and has no gxt-bypass git note" >&2
    echo "  subject: $subject" >&2
    echo "  hint: run gapman verify --break-glass --reason \"...\" with GXT_BYPASS_SECRET, push refs/notes/gxt-bypass" >&2
    echo "  touched paths (sample):" >&2
    git diff-tree --no-commit-id --name-only -r "$commit" | head -20 >&2
    exit 1
  done < <(git rev-list --no-merges "${base_sha}..${head_sha}")

  echo "MSN commit subjects OK (path-scoped)"
}

usage() {
  cat <<'EOF' >&2
Usage:
  validate-gxt.sh [manifest]          Validate Foreman MANIFEST.json (default)
  validate-gxt.sh msn <base> <head>   Require [MSN-NNNN] or gxt-bypass git note on commits
                                      in range that touch GXT paths (see is_gxt_path)
  validate-gxt.sh upgrade-tmp         Fail if .gitagent/.upgrade-tmp/ contains tracked files
  validate-gxt.sh all [base head]     Run manifest, upgrade-tmp, then msn if base and head given
Example:
  ./scripts/validate-gxt.sh msn origin/main HEAD
EOF
}

main() {
  local cmd="${1:-manifest}"
  shift || true
  case "$cmd" in
    manifest)
      cmd_manifest
      ;;
    upgrade-tmp)
      cmd_upgrade_tmp
      ;;
    msn)
      if [[ $# -ne 2 ]]; then
        usage
        exit 2
      fi
      cmd_msn "$1" "$2"
      ;;
    all)
      cmd_manifest
      cmd_upgrade_tmp
      if [[ $# -ge 2 ]]; then
        cmd_msn "$1" "$2"
      else
        echo "Hint: pass <base> <head> to also run MSN checks, e.g. all origin/main HEAD" >&2
      fi
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
}

main "$@"
