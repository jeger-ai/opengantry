#!/usr/bin/env bash
# Deprecated: use scripts/gxt-runtime-env.sh (tool-agnostic GXT bootstrap).
echo "gxt-cursor-env.sh is deprecated — use scripts/gxt-runtime-env.sh" >&2
# shellcheck source=scripts/gxt-runtime-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gxt-runtime-env.sh" "$@"
