#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

script_path="${BASH_SOURCE[0]}"

if [ "${1:-}" = "--help" ]; then
  [ "$#" -eq 1 ] || fail "--help does not accept additional arguments"
  script_dir="$(cd "$(dirname "$script_path")" && pwd -P)"
  usage_document="$script_dir/../references/inspect-plan-projection-usage.md"
  [ -f "$usage_document" ] && [ -r "$usage_document" ] ||
    fail "usage document missing or unreadable: $usage_document"
  cat "$usage_document"
  exit 0
fi

[ "$#" -eq 2 ] && [ "$1" = "--path" ] && [ -n "$2" ] ||
  fail "usage: inspect-plan-projection.sh --path <repo-relative-plan-path>"

logical_script_dir="$(cd "$(dirname "$script_path")" && pwd)"
physical_script_dir="$(cd "$(dirname "$script_path")" && pwd -P)"
logical_runtime="$logical_script_dir/../../devcanon-runtime/scripts/devcanon-runtime.sh"
physical_runtime="$physical_script_dir/../../devcanon-runtime/scripts/devcanon-runtime.sh"

if [ -n "${DEVCANON_RUNTIME_DIR:-}" ]; then
  runtime_resolver="$DEVCANON_RUNTIME_DIR/scripts/devcanon-runtime.sh"
elif [ -x "$logical_runtime" ]; then
  runtime_resolver="$logical_runtime"
elif [ -x "$physical_runtime" ]; then
  runtime_resolver="$physical_runtime"
else
  runtime_resolver=""
fi
[ -x "$runtime_resolver" ] ||
  fail "devcanon-runtime resolver missing for play-subagent-execution projection inspection"

runtime_entrypoint="$(
  "$runtime_resolver" resolve-entrypoint --from "$script_path" \
    --entrypoint "scripts/devcanon-runtime.sh"
)"
exec "$runtime_entrypoint" runtime planning-projection inspect --path "$2"
