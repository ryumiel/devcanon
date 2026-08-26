#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
command -v node >/dev/null 2>&1 || {
  printf '%s\n' "node is required for write-research-brief" >&2
  exit 1
}
exec node "$script_dir/write-research-brief.mjs" "$@"
