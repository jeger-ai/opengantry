#!/usr/bin/env bash
# OpenGantry local + CI validation. Keep path-prefix rules in sync with
# .github/workflows/gxt-validate.yml (msn_commits job).
# MSN-enforced paths: fixed substrate + MANIFEST tmvc_roots (Node; no jq).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "validate-gxt: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

MANIFEST_REL=".gitagent/foreman/MANIFEST.json"
BYPASS_SHA256_REL=".gitagent/foreman/BYPASS.sha256"
GXT_BYPASS_NOTES_REF="refs/notes/gxt-bypass"
GXT_MANIFEST_LIB="scripts/gxt-manifest-lib.mjs"

# Cached MSN-enforced path prefixes (fixed substrate + MANIFEST tmvc_roots).
MSN_PREFIXES=()

load_msn_prefixes() {
  if [[ ${#MSN_PREFIXES[@]} -gt 0 ]]; then
    return 0
  fi
  if [[ ! -f "$GXT_MANIFEST_LIB" ]]; then
    echo "validate-gxt: missing $GXT_MANIFEST_LIB" >&2
    exit 1
  fi
  mapfile -t MSN_PREFIXES < <(node "$GXT_MANIFEST_LIB" prefixes "$ROOT") || {
    echo "validate-gxt: failed to load MSN-enforced prefixes from MANIFEST (Node required)" >&2
    exit 1
  }
  if [[ ${#MSN_PREFIXES[@]} -eq 0 ]]; then
    echo "validate-gxt: no MSN-enforced prefixes" >&2
    exit 1
  fi
}

# Returns 0 if commit has a valid gxt-bypass git note (JSON v1 + reason >= 10 chars).
commit_has_gxt_bypass_note() {
  local commit="$1"
  local note
  note="$(git notes --ref="$GXT_BYPASS_NOTES_REF" show "$commit" 2>/dev/null)" || return 1
  printf '%s' "$note" | node "$GXT_MANIFEST_LIB" validate-bypass-note >/dev/null 2>&1
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
is_msn_enforced_path() {
  local p="$1"
  local prefix
  load_msn_prefixes
  for prefix in "${MSN_PREFIXES[@]}"; do
    [[ -z "$prefix" ]] && continue
    if [[ "$p" == "$prefix" ]]; then
      return 0
    fi
    if [[ "$prefix" == */ ]] && [[ "$p" == "$prefix"* ]]; then
      return 0
    fi
    if [[ "$prefix" != */ ]] && [[ "$p" == "$prefix"/* ]]; then
      return 0
    fi
  done
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
  if [[ -f dist/cli/index.js ]]; then
    node dist/cli/index.js check >/dev/null
    echo "MANIFEST OK (gantry check)"
  else
    node "$GXT_MANIFEST_LIB" validate-manifest "$ROOT"
  fi
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
      if is_msn_enforced_path "$f"; then
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
    if eval_out="$(node "$GXT_MANIFEST_LIB" eval-commit "$ROOT" "$commit" 2>&1)"; then
      echo "$eval_out" >&2
      continue
    fi
    echo "MSN check FAILED: commit $commit touches MSN-enforced paths but subject does not start with [MSN-NNNN] and has no gxt-bypass git note" >&2
    echo "  subject: $subject" >&2
    echo "  hint: run gantry verify --break-glass --reason \"...\" with GXT_BYPASS_SECRET, push refs/notes/gxt-bypass" >&2
    echo "  touched paths (sample):" >&2
    git diff-tree --no-commit-id --name-only -r "$commit" | head -20 >&2
    exit 1
  done < <(git rev-list --no-merges "${base_sha}..${head_sha}")

  echo "MSN commit subjects OK (path-scoped: substrate + MANIFEST tmvc_roots)"
}

usage() {
  cat <<'EOF' >&2
Usage:
  validate-gxt.sh [manifest]          Validate Foreman MANIFEST.json (default)
  validate-gxt.sh msn <base> <head>   Require [MSN-NNNN] or gxt-bypass git note on commits
                                      in range that touch MSN-enforced paths
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
