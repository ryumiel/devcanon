#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ]; then
  [ "$#" -eq 1 ] || { echo "--help does not accept additional arguments" >&2; exit 1; }
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  usage_document="$script_dir/../references/git-workspace-cleanup-usage.md"
  [ -f "$usage_document" ] && [ -r "$usage_document" ] || { echo "usage document missing or unreadable: $usage_document" >&2; exit 1; }
  cat "$usage_document"
  exit 0
fi

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
  fail "devcanon-runtime passive runtime bundle missing: expected sibling $skills_root/devcanon-runtime/scripts/devcanon-runtime.sh. Run devcanon render or devcanon sync to restore the generated sibling bundle; DEVCANON_RUNTIME_DIR is available as a diagnostic override."

runtime_entrypoint="$("$runtime_resolver" resolve-entrypoint --from "$script_path" --entrypoint "scripts/devcanon-runtime.sh")"
exec "$runtime_entrypoint" runtime git-workspace-cleanup "$@"
