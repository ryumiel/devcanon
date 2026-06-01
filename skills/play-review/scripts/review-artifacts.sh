#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "$name is required" >&2
    exit 1
  fi
}

require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "jq is required to validate play-review/findings/v1" >&2
    exit 1
  }
}

require_repo_root() {
  local git_toplevel
  local physical_toplevel
  local physical_pwd
  git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "failed to determine git repository root" >&2
    exit 1
  }
  physical_toplevel="$(cd "$git_toplevel" && pwd -P)" || {
    echo "failed to resolve git repository root" >&2
    exit 1
  }
  physical_pwd="$(pwd -P)"
  [ "$physical_toplevel" = "$physical_pwd" ] || {
    echo "review-artifacts.sh must run from the repository root" >&2
    exit 1
  }
}

validate_head_sha() {
  require_env HEAD_SHA
  case "$HEAD_SHA" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *)
      echo "HEAD_SHA must be a 40-character lowercase hex SHA" >&2
      exit 1
      ;;
  esac
}

validate_findings_path_shape() {
  local findings_file="$1"
  local expected_findings_file
  case "$findings_file" in
    .ephemeral/*/*)
      echo "nested findings path rejected: $findings_file" >&2
      exit 1
      ;;
    .ephemeral/*-findings.json) ;;
    *)
      echo "findings path validation failed: $findings_file" >&2
      exit 1
      ;;
  esac
  [ "${findings_file#*..}" = "$findings_file" ] || {
    echo "path traversal: $findings_file" >&2
    exit 1
  }
  expected_findings_file="$(expected_findings_path)"
  [ "$findings_file" = "$expected_findings_file" ] || {
    echo "findings path mismatch: $findings_file" >&2
    exit 1
  }
}

validate_nits_path_shape() {
  local nits_file="$1"
  case "$nits_file" in
    .ephemeral/*/*)
      echo "nested nits_file path rejected: $nits_file" >&2
      exit 1
      ;;
    .ephemeral/*-findings.json | .ephemeral/*-nits-pending.json) ;;
    *)
      echo "nits_file path validation failed: $nits_file" >&2
      exit 1
      ;;
  esac
  [ "${nits_file#*..}" = "$nits_file" ] || {
    echo "path traversal: $nits_file" >&2
    exit 1
  }
}

assert_readable_envelope() {
  local label="$1"
  local file="$2"
  require_jq
  [ -L .ephemeral ] && {
    echo ".ephemeral must be a directory, not a symlink" >&2
    exit 1
  }
  [ ! -L "$file" ] || {
    echo "$label must not be a symlink: $file" >&2
    exit 1
  }
  [ -f "$file" ] || {
    echo "$label missing or not a regular file: $file" >&2
    exit 1
  }
  [ -r "$file" ] || {
    echo "$label missing or unreadable: $file" >&2
    exit 1
  }
  jq -e '
    def one_of($values; $value): ($values | index($value)) != null;
    def positive_integer:
      type == "number" and . == floor and . >= 1;
    def repo_relative_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    def valid_critic:
      if .severity == "Nit" then
        .critic == null
      else
        .critic == null or one_of(["VALID", "INVALID", "DOWNGRADE"]; .critic)
      end;
    def valid_finding:
      type == "object"
      and (.path | repo_relative_path)
      and (.line | positive_integer)
      and (.start_line == null or (.start_line | positive_integer))
      and one_of(["Blocking", "Nit"]; .severity)
      and one_of(["Logic", "Safety", "Architecture", "Tests", "Maintainability", "Documentation", "Contracts"]; .category)
      and valid_critic
      and one_of(["natural", "missing-file", "out-of-diff"]; .anchor)
      and (.why | type == "string")
      and (.recommendation | type == "string")
      and (.body | type == "string");
    .schema == "play-review/findings/v1"
    and (.findings | type == "array")
    and (.carry_forward | type == "array")
    and ((.findings + .carry_forward) | all(.[]; valid_finding))
  ' "$file" >/dev/null || {
    echo "envelope schema mismatch or envelope shape mismatch: $file" >&2
    exit 1
  }
}

validate_review_surface() {
  require_env REVIEW_SURFACE
  case "$REVIEW_SURFACE" in
    pr-review | branch-review) ;;
    *)
      echo "REVIEW_SURFACE must be pr-review or branch-review" >&2
      exit 1
      ;;
  esac
}

validate_review_event() {
  require_env REVIEW_EVENT
  case "$REVIEW_EVENT" in
    APPROVE | REQUEST_CHANGES | COMMENT) ;;
    *)
      echo "REVIEW_EVENT must be APPROVE, REQUEST_CHANGES, or COMMENT" >&2
      exit 1
      ;;
  esac
}

validate_review_body_file() {
  require_env REVIEW_BODY_FILE
  case "$REVIEW_BODY_FILE" in
    .ephemeral/*/*)
      echo "review body path validation failed: $REVIEW_BODY_FILE" >&2
      exit 1
      ;;
    .ephemeral/*) ;;
    *)
      echo "review body path validation failed: $REVIEW_BODY_FILE" >&2
      exit 1
      ;;
  esac
  [ "${REVIEW_BODY_FILE#*..}" = "$REVIEW_BODY_FILE" ] || {
    echo "path traversal: $REVIEW_BODY_FILE" >&2
    exit 1
  }
  [ -L "$REVIEW_BODY_FILE" ] && {
    echo "review body file must not be a symlink: $REVIEW_BODY_FILE" >&2
    exit 1
  }
  [ -f "$REVIEW_BODY_FILE" ] || {
    echo "review body file missing or not a regular file: $REVIEW_BODY_FILE" >&2
    exit 1
  }
  [ -r "$REVIEW_BODY_FILE" ] || {
    echo "review body file missing or unreadable: $REVIEW_BODY_FILE" >&2
    exit 1
  }
}

prepare_write_target() {
  local label="$1"
  local file="$2"
  [ -L .ephemeral ] && {
    echo ".ephemeral must be a directory, not a symlink" >&2
    exit 1
  }
  mkdir -p .ephemeral
  [ -L "$file" ] && rm "$file"
  [ ! -d "$file" ] || {
    echo "$label path is a directory: $file" >&2
    exit 1
  }
  [ ! -e "$file" ] || [ -f "$file" ] || {
    echo "$label path exists but is not a regular file: $file" >&2
    exit 1
  }
}

slug_branch() {
  local branch_name="$1"
  local slug
  slug=$(printf '%s' "$branch_name" | tr '/' '-' | tr -cd '[:alnum:]._-')
  case "$slug" in
    "" | "." | ".." | -* | .*) slug="unnamed" ;;
  esac
  printf '%s\n' "$slug"
}

expected_findings_path() {
  local raw_branch
  local branch_slug
  raw_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || {
    echo "failed to determine current git branch" >&2
    exit 1
  }
  if [ "$raw_branch" = "HEAD" ]; then
    branch_slug="detached"
  else
    branch_slug="$(slug_branch "$raw_branch")"
  fi
  printf '.ephemeral/%s-%s-findings.json\n' "$branch_slug" "$HEAD_SHA"
}

language_for_path() {
  local entry_path="$1"
  case "$entry_path" in
    *.bash | *.sh) printf 'bash\n' ;;
    *.css) printf 'css\n' ;;
    *.html) printf 'html\n' ;;
    *.js | *.mjs | *.cjs) printf 'javascript\n' ;;
    *.json) printf 'json\n' ;;
    *.md | *.markdown) printf 'markdown\n' ;;
    *.py) printf 'python\n' ;;
    *.rs) printf 'rust\n' ;;
    *.ts | *.tsx) printf 'typescript\n' ;;
    *.yaml | *.yml) printf 'yaml\n' ;;
    *) printf 'text\n' ;;
  esac
}

source_line_count() {
  awk 'END { print NR }'
}

review_source_line_count() {
  local entry_path="$1"
  git show "${HEAD_SHA}:${entry_path}" 2>/dev/null | source_line_count
}

validate_source_anchor() {
  local entry_path="$1"
  local line="$2"
  local start_line="$3"
  local total_lines

  total_lines="$(review_source_line_count "$entry_path")" || {
    echo "failed to read review-head source: $entry_path" >&2
    exit 1
  }
  [ "$line" -le "$total_lines" ] || {
    echo "review-head source line out of range: $entry_path:$line" >&2
    exit 1
  }
  if [ "$start_line" != "null" ]; then
    [ "$start_line" -le "$line" ] || {
      echo "review-head source range is invalid: $entry_path:$start_line-$line" >&2
      exit 1
    }
    [ "$start_line" -le "$total_lines" ] || {
      echo "review-head source line out of range: $entry_path:$start_line" >&2
      exit 1
    }
  fi

  printf '%s\n' "$total_lines"
}

render_source_snippet() {
  local entry_path="$1"
  local line="$2"
  local start_line="$3"
  local total_lines
  local window_start
  local window_end
  local target_start
  local target_end
  local range_len

  total_lines="$(validate_source_anchor "$entry_path" "$line" "$start_line")"

  if [ "$start_line" = "null" ]; then
    target_start="$line"
    target_end="$line"
    window_start=$((line - 1))
    window_end=$((line + 1))
  else
    target_start="$start_line"
    target_end="$line"
    range_len=$((target_end - target_start + 1))
    if [ "$range_len" -gt 7 ]; then
      window_start=$((target_end - 6))
      window_end="$target_end"
    else
      window_start="$target_start"
      window_end="$target_end"
    fi
  fi

  [ "$window_start" -lt 1 ] && window_start=1
  [ "$window_end" -gt "$total_lines" ] && window_end="$total_lines"
  while [ $((window_end - window_start + 1)) -lt 3 ] && [ "$window_start" -gt 1 ]; do
    window_start=$((window_start - 1))
  done
  while [ $((window_end - window_start + 1)) -lt 3 ] && [ "$window_end" -lt "$total_lines" ]; do
    window_end=$((window_end + 1))
  done
  if [ $((window_end - window_start + 1)) -gt 7 ]; then
    window_start=$((window_end - 6))
  fi

  printf '```%s\n' "$(language_for_path "$entry_path")"
  printf '// %s:%s-%s\n' "$entry_path" "$window_start" "$window_end"
  git show "${HEAD_SHA}:${entry_path}" 2>/dev/null | awk -v start="$window_start" -v end="$window_end" 'NR >= start && NR <= end { print }'
  printf '```\n'
}

render_entry() {
  local title="$1"
  local entry_json="$2"
  local entry_path
  local line
  local start_line
  local line_display
  local severity
  local category
  local critic
  local anchor
  local body

  entry_path="$(jq -r '.path' <<<"$entry_json")"
  line="$(jq -r '.line' <<<"$entry_json")"
  start_line="$(jq -r '.start_line' <<<"$entry_json")"
  severity="$(jq -r '.severity' <<<"$entry_json")"
  category="$(jq -r '.category' <<<"$entry_json")"
  critic="$(jq -r 'if .critic == null then "(skipped - nit)" else .critic end' <<<"$entry_json")"
  anchor="$(jq -r '.anchor' <<<"$entry_json")"
  body="$(jq -r '.body' <<<"$entry_json")"
  if [ "${REVIEW_SURFACE:-}" = "pr-review" ] && [ "$anchor" = "missing-file" ]; then
    body="$(printf 'Missing-file finding (no natural anchor — see body):\n\n%s' "$body")"
  fi
  if [ "$start_line" = "null" ]; then
    line_display="$line"
  else
    line_display="${start_line}-${line}"
  fi

  printf '### %s\n\n' "$title"
  printf -- '- **Path:** %s\n' "$entry_path"
  printf -- '- **Line:** %s\n' "$line_display"
  printf -- '- **Severity:** %s\n' "$severity"
  printf -- '- **Category:** %s\n' "$category"
  printf -- '- **Critic:** %s\n' "$critic"
  printf -- '- **Anchor:** %s\n\n' "$anchor"
  render_source_snippet "$entry_path" "$line" "$start_line"
  printf '\n#### Rendered Finding Body\n\n'
  printf '%s\n\n' "$body"
}

build_review_body() {
  local base_body=""
  local out_of_diff
  if [ "${REVIEW_SURFACE:-}" = "pr-review" ]; then
    base_body="$(cat "$REVIEW_BODY_FILE")"
  fi
  out_of_diff="$(jq -r '
    (.findings + .carry_forward)
    | map(select(.anchor == "out-of-diff") | .body)
    | if length == 0 then empty
      else "## Out-of-diff Findings\n\n" + join("\n\n")
      end
  ' "$FINDINGS_FILE")"
  if [ -n "$base_body" ] && [ -n "$out_of_diff" ]; then
    printf '%s\n\n%s\n' "$base_body" "$out_of_diff"
  elif [ -n "$base_body" ]; then
    printf '%s\n' "$base_body"
  elif [ -n "$out_of_diff" ]; then
    printf '%s\n' "$out_of_diff"
  fi
}

validate_inline_source_anchors() {
  local entry_json
  local entry_path
  local line
  local start_line

  while IFS= read -r entry_json; do
    entry_path="$(jq -r '.path' <<<"$entry_json")"
    line="$(jq -r '.line' <<<"$entry_json")"
    start_line="$(jq -r '.start_line' <<<"$entry_json")"
    validate_source_anchor "$entry_path" "$line" "$start_line" >/dev/null
  done < <(
    jq -c '
      .findings[]
      | select(.anchor == "natural" or .anchor == "missing-file")
    ' "$FINDINGS_FILE"
  )
}

render_review_preview() {
  local review_body
  local count
  local index
  require_repo_root
  validate_head_sha
  require_env FINDINGS_FILE
  validate_findings_path_shape "$FINDINGS_FILE"
  assert_readable_envelope "findings file" "$FINDINGS_FILE"
  validate_review_surface
  if [ "$REVIEW_SURFACE" = "pr-review" ]; then
    validate_review_body_file
  fi

  printf '# Review Preview\n\n'
  printf 'Review head: %s\n' "$HEAD_SHA"
  printf 'Findings file: %s\n\n' "$FINDINGS_FILE"
  if [ "$REVIEW_SURFACE" = "pr-review" ]; then
    review_body="$(build_review_body)"
    printf '## GitHub Review Body\n\n'
    printf '%s\n\n' "$review_body"
  fi

  printf '## Findings\n\n'
  count="$(jq '.findings | length' "$FINDINGS_FILE")"
  if [ "$count" -eq 0 ]; then
    printf 'No findings.\n\n'
  else
    index=0
    while [ "$index" -lt "$count" ]; do
      render_entry "Finding $((index + 1))" "$(jq -c ".findings[$index]" "$FINDINGS_FILE")"
      index=$((index + 1))
    done
  fi

  printf '## Carry-forward\n\n'
  count="$(jq '.carry_forward | length' "$FINDINGS_FILE")"
  if [ "$count" -eq 0 ]; then
    printf 'No carry-forward findings.\n'
  else
    index=0
    while [ "$index" -lt "$count" ]; do
      render_entry "Carry-forward $((index + 1))" "$(jq -c ".carry_forward[$index]" "$FINDINGS_FILE")"
      index=$((index + 1))
    done
  fi
}

build_github_review_payload() {
  local review_body
  require_repo_root
  validate_head_sha
  require_env FINDINGS_FILE
  validate_findings_path_shape "$FINDINGS_FILE"
  assert_readable_envelope "findings file" "$FINDINGS_FILE"
  validate_review_surface
  [ "$REVIEW_SURFACE" = "pr-review" ] || {
    echo "build-github-review-payload requires REVIEW_SURFACE=pr-review" >&2
    exit 1
  }
  validate_review_body_file
  validate_review_event
  validate_inline_source_anchors
  review_body="$(build_review_body)"
  jq -n \
    --arg commit_id "$HEAD_SHA" \
    --arg event "$REVIEW_EVENT" \
    --arg body "$review_body" \
    --slurpfile envelope "$FINDINGS_FILE" \
    '{
      commit_id: $commit_id,
      event: $event,
      body: $body,
      comments: (
        $envelope[0].findings
        | map(select(.anchor == "natural" or .anchor == "missing-file"))
        | map({
            path,
            line,
            start_line,
            side: "RIGHT",
            body: (if .anchor == "missing-file" then
              "Missing-file finding (no natural anchor — see body):\n\n" + .body
            else
              .body
            end)
          } | if .start_line == null then del(.start_line) else . + {start_side: "RIGHT"} end)
      )
    }'
}

case "$command_name" in
  validate-findings)
    require_repo_root
    validate_head_sha
    require_env FINDINGS_FILE
    validate_findings_path_shape "$FINDINGS_FILE"
    assert_readable_envelope "findings file" "$FINDINGS_FILE"
    ;;
  validate-nits-file)
    require_repo_root
    require_env NITS_FILE
    validate_nits_path_shape "$NITS_FILE"
    assert_readable_envelope "nits_file" "$NITS_FILE"
    ;;
  derive-nits-pending)
    require_repo_root
    validate_head_sha
    require_env FINDINGS_FILE
    validate_findings_path_shape "$FINDINGS_FILE"
    assert_readable_envelope "findings file" "$FINDINGS_FILE"
    NITS_PENDING_FILE="${FINDINGS_FILE%-findings.json}-nits-pending.json"
    validate_nits_path_shape "$NITS_PENDING_FILE"
    prepare_write_target "nits pending" "$NITS_PENDING_FILE"
    printf '%s\n' "$NITS_PENDING_FILE"
    ;;
  prepare-findings-write)
    require_repo_root
    validate_head_sha
    if [ -z "${FINDINGS_FILE:-}" ]; then
      FINDINGS_FILE="$(expected_findings_path)"
    fi
    validate_findings_path_shape "$FINDINGS_FILE"
    prepare_write_target "findings" "$FINDINGS_FILE"
    printf '%s\n' "$FINDINGS_FILE"
    ;;
  render-review-preview)
    render_review_preview
    ;;
  build-github-review-payload)
    build_github_review_payload
    ;;
  *)
    echo "usage: review-artifacts.sh validate-findings|validate-nits-file|derive-nits-pending|prepare-findings-write|render-review-preview|build-github-review-payload" >&2
    exit 1
    ;;
esac
