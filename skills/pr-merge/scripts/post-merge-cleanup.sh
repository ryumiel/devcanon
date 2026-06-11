#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

script_path="${BASH_SOURCE[0]}"
skills_root="$(cd "$(dirname "$script_path")/../.." && pwd)"
runtime_resolver="$skills_root/devcanon-runtime/scripts/devcanon-runtime.sh"

if [ -n "${DEVCANON_RUNTIME_DIR:-}" ]; then
  runtime_resolver="$DEVCANON_RUNTIME_DIR/scripts/devcanon-runtime.sh"
fi

[ -x "$runtime_resolver" ] ||
  fail "devcanon-runtime support skill missing for pr-merge cleanup"

runtime_entrypoint="$("$runtime_resolver" resolve-entrypoint --from "$script_path" --entrypoint "scripts/devcanon-runtime.sh")"
exec "$runtime_entrypoint" runtime pr-merge-worktree cleanup
