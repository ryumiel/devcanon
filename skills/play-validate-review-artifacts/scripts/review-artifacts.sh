#!/usr/bin/env bash
set -euo pipefail

script_path="${BASH_SOURCE[0]}"
script_dir="$(cd "$(dirname "$script_path")" && pwd -P)"
skills_root="$(cd "$script_dir/../.." && pwd -P)"
runtime_resolver="$skills_root/devcanon-runtime/scripts/devcanon-runtime.sh"

if [ -n "${DEVCANON_RUNTIME_DIR:-}" ]; then
  runtime_resolver="$DEVCANON_RUNTIME_DIR/scripts/devcanon-runtime.sh"
fi

[ -x "$runtime_resolver" ] ||
  {
    echo "devcanon-runtime support skill missing for play-validate-review-artifacts" >&2
    exit 1
  }

runtime_entrypoint="$("$runtime_resolver" resolve-entrypoint --from "$script_path" --entrypoint "scripts/devcanon-runtime.sh")"
exec "$runtime_entrypoint" runtime review-artifacts "$@"
