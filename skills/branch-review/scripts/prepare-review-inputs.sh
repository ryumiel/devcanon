#!/usr/bin/env bash
set -euo pipefail

BASE_ARG=""
FIX_MODE=false
LAST_REVIEWED_SHA=""
PRIOR_FINDINGS_FILE=""
GOVERNED_PATH_PATTERN='^(docs/(adr|arch|product-requirements|specs|guidelines)/|MAP\.md$|AGENTS\.md$|CONTRIBUTING\.md$)'
CONFIGURED_PATH_PATTERN="${BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN:-}"

emit_line() {
  local key="$1"
  local value="$2"

  printf '%s=%s\n' "$key" "$value"
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
    echo "prepare-review-inputs.sh must run from the repository root" >&2
    exit 1
  }
}

resolve_base() {
  if [[ -n "$BASE_ARG" ]]; then
    printf '%s\n' "$BASE_ARG"
  elif symbolic_ref=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null); then
    printf '%s\n' "${symbolic_ref#origin/}"
  elif git show-ref --verify --quiet refs/remotes/origin/main; then
    printf 'main\n'
  elif git show-ref --verify --quiet refs/remotes/origin/master; then
    printf 'master\n'
  else
    printf 'main\n'
  fi
}

extract_prior_findings_head_sha() {
  printf '%s\n' "$PRIOR_FINDINGS_FILE" |
    sed -n 's/^\.ephemeral\/.*-\([0-9a-f]\{40\}\)-findings\.json$/\1/p'
}

validate_prior_findings() {
  if [[ -z "${PLAY_REVIEW_DIR:-}" ]]; then
    echo "PLAY_REVIEW_DIR is required when --prior-findings is supplied" >&2
    exit 1
  fi

  PLAY_REVIEW_HELPER="$PLAY_REVIEW_DIR/scripts/review-artifacts.sh"
  [ -r "$PLAY_REVIEW_HELPER" ] || {
    echo "play-review helper missing or unreadable: $PLAY_REVIEW_HELPER" >&2
    exit 1
  }

  PRIOR_FINDINGS_HEAD_SHA="$(extract_prior_findings_head_sha)"
  [ -n "$PRIOR_FINDINGS_HEAD_SHA" ] || {
    echo "prior findings path must include a 40-character review head" >&2
    exit 1
  }
  [ "$PRIOR_FINDINGS_HEAD_SHA" = "$LAST_REVIEWED_SHA" ] || {
    echo "--prior-findings review head must match --last-reviewed" >&2
    exit 1
  }
  HEAD_SHA="$PRIOR_FINDINGS_HEAD_SHA" FINDINGS_FILE="$PRIOR_FINDINGS_FILE" \
    bash "$PLAY_REVIEW_HELPER" validate-findings || exit 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --fix)
        FIX_MODE=true
        shift
        ;;
      --last-reviewed)
        [ -n "${2:-}" ] || {
          echo "--last-reviewed requires a SHA" >&2
          exit 1
        }
        LAST_REVIEWED_SHA="$2"
        shift 2
        ;;
      --prior-findings)
        [ -n "${2:-}" ] || {
          echo "--prior-findings requires a path" >&2
          exit 1
        }
        PRIOR_FINDINGS_FILE="$2"
        shift 2
        ;;
      --*)
        echo "unknown branch-review argument: $1" >&2
        exit 1
        ;;
      *)
        [ -z "$BASE_ARG" ] || {
          echo "multiple base arguments supplied" >&2
          exit 1
        }
        BASE_ARG="$1"
        shift
        ;;
    esac
  done
}

compute_language_hints() {
  local range="$1"

  git diff --name-only "$range" |
    sed -n 's/.*\.\([[:alnum:]_+-][[:alnum:]_+-]*\)$/\1/p' |
    tr '[:upper:]' '[:lower:]' |
    sort -u |
    paste -sd ',' -
}

validate_optional_path_pattern() {
  if [[ -z "$CONFIGURED_PATH_PATTERN" ]]; then
    return
  fi

  set +e
  grep -E -- "$CONFIGURED_PATH_PATTERN" /dev/null >/dev/null 2>&1
  local status=$?
  set -e
  if [[ "$status" -gt 1 ]]; then
    echo "BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN must be a valid extended regular expression" >&2
    exit 1
  fi
}

append_escalation_reason() {
  local reason="$1"

  ESCALATION_REASON="${ESCALATION_REASON:+$ESCALATION_REASON,}$reason"
}

write_changed_files_file() {
  local range="$1"

  if [[ -L ".ephemeral" ]]; then
    echo ".ephemeral must not be a symlink" >&2
    exit 1
  fi
  if [[ -e ".ephemeral" && ! -d ".ephemeral" ]]; then
    echo ".ephemeral exists but is not a directory" >&2
    exit 1
  fi
  mkdir -p ".ephemeral"

  CHANGED_FILES_FILE="$(mktemp ".ephemeral/branch-review-changed-files.XXXXXX")"
  git diff --name-only "$range" >"$CHANGED_FILES_FILE"
}

require_repo_root
parse_args "$@"
validate_optional_path_pattern

if [[ -n "$LAST_REVIEWED_SHA" || -n "$PRIOR_FINDINGS_FILE" ]]; then
  if [[ -z "$LAST_REVIEWED_SHA" || -z "$PRIOR_FINDINGS_FILE" ]]; then
    echo "--last-reviewed and --prior-findings must be supplied together" >&2
    exit 1
  fi
  if [[ ! "$LAST_REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "--last-reviewed requires a 40-character lowercase hex SHA" >&2
    exit 1
  fi
  validate_prior_findings
fi

BASE="$(resolve_base)"
FULL_DIFF_RANGE="$BASE...HEAD"
FOLLOWUP_MODE=false
FOLLOWUP_SHA_USABLE=false
CANDIDATE_ACTIVE_DIFF_RANGE="$FULL_DIFF_RANGE"
CHANGED_FILE_COUNT=0

if [[ "$LAST_REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]] &&
  git cat-file -e "$LAST_REVIEWED_SHA^{commit}" 2>/dev/null &&
  git merge-base --is-ancestor "$LAST_REVIEWED_SHA" HEAD 2>/dev/null; then
  FOLLOWUP_MODE=true
  FOLLOWUP_SHA_USABLE=true
  CANDIDATE_ACTIVE_DIFF_RANGE="$LAST_REVIEWED_SHA..HEAD"
fi

ESCALATE_FULL=false
ESCALATION_REASON=""
CHANGED_FILE_COUNT="$(git diff --name-only "$CANDIDATE_ACTIVE_DIFF_RANGE" | wc -l | tr -d ' ')"
if [[ "$FOLLOWUP_MODE" = true ]]; then
  if [[ "$CHANGED_FILE_COUNT" -gt 5 ]]; then
    ESCALATE_FULL=true
    append_escalation_reason "file-count"
  fi
  if git diff --name-only "$CANDIDATE_ACTIVE_DIFF_RANGE" |
    grep -E -- "$GOVERNED_PATH_PATTERN" >/dev/null; then
    ESCALATE_FULL=true
    append_escalation_reason "governance-path"
  fi
  if [[ -n "$CONFIGURED_PATH_PATTERN" ]] &&
    git diff --name-only "$CANDIDATE_ACTIVE_DIFF_RANGE" |
      grep -E -- "$CONFIGURED_PATH_PATTERN" >/dev/null; then
    ESCALATE_FULL=true
    append_escalation_reason "configured-path"
  fi
else
  ESCALATE_FULL=true
  if [[ -n "$LAST_REVIEWED_SHA" ]]; then
    ESCALATION_REASON="last-reviewed-unusable"
  else
    ESCALATION_REASON="not-followup"
  fi
fi

if [[ "$FOLLOWUP_MODE" = true && "$FOLLOWUP_SHA_USABLE" = true && "$ESCALATE_FULL" = false ]]; then
  MECHANICAL_ACTIVE_DIFF_RANGE="$CANDIDATE_ACTIVE_DIFF_RANGE"
  MECHANICAL_IS_FOLLOWUP_NARROW=true
else
  MECHANICAL_ACTIVE_DIFF_RANGE="$FULL_DIFF_RANGE"
  MECHANICAL_IS_FOLLOWUP_NARROW=false
fi

LANGUAGE_HINTS="$(compute_language_hints "$MECHANICAL_ACTIVE_DIFF_RANGE")"
write_changed_files_file "$CANDIDATE_ACTIVE_DIFF_RANGE"

emit_line "BASE" "$BASE"
emit_line "FIX_MODE" "$FIX_MODE"
emit_line "FULL_DIFF_RANGE" "$FULL_DIFF_RANGE"
emit_line "CANDIDATE_ACTIVE_DIFF_RANGE" "$CANDIDATE_ACTIVE_DIFF_RANGE"
emit_line "MECHANICAL_ACTIVE_DIFF_RANGE" "$MECHANICAL_ACTIVE_DIFF_RANGE"
emit_line "MECHANICAL_IS_FOLLOWUP_NARROW" "$MECHANICAL_IS_FOLLOWUP_NARROW"
emit_line "MECHANICAL_ESCALATE_FULL" "$ESCALATE_FULL"
emit_line "MECHANICAL_ESCALATION_REASON" "$ESCALATION_REASON"
emit_line "FOLLOWUP_SHA_USABLE" "$FOLLOWUP_SHA_USABLE"
emit_line "CHANGED_FILE_COUNT" "$CHANGED_FILE_COUNT"
emit_line "CHANGED_FILES_FILE" "$CHANGED_FILES_FILE"
emit_line "LANGUAGE_HINTS" "$LANGUAGE_HINTS"
emit_line "LAST_REVIEWED_SHA" "$LAST_REVIEWED_SHA"
emit_line "PRIOR_BRANCH_FINDINGS" "$PRIOR_FINDINGS_FILE"
