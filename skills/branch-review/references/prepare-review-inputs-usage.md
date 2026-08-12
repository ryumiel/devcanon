# Prepare review inputs usage

## Role

Prepares deterministic branch-review input and scope-decision paths.

## Invocation

Run `bash "$BRANCH_REVIEW_DIR/scripts/prepare-review-inputs.sh" [<base>] [--fix] [--last-reviewed <sha>] [--prior-findings <path>] [--risk-signals <path>]` from the target repository root.

## Inputs

The positional base is optional and otherwise resolves from repository defaults. `--fix`, `--last-reviewed <sha>`, `--prior-findings <path>`, and `--risk-signals <path>` are optional; `--last-reviewed` and `--prior-findings` must be supplied together. `PLAY_REVIEW_DIR` is required only with `--prior-findings`; `BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN` is optional validator configuration. It reads no stdin.

## Working directory

The target repository root is required.

## Outputs

It emits exactly `BASE`, `FIX_MODE`, `RISK_SIGNALS_FILE`, `RISK_SIGNALS_STATUS`, `FULL_DIFF_RANGE`, `CANDIDATE_ACTIVE_DIFF_RANGE`, `MECHANICAL_ACTIVE_DIFF_RANGE`, `MECHANICAL_IS_FOLLOWUP_NARROW`, `MECHANICAL_ESCALATE_FULL`, `MECHANICAL_ESCALATION_REASON`, `FOLLOWUP_SHA_USABLE`, `CHANGED_FILE_COUNT`, `CHANGED_FILES_FILE`, `LANGUAGE_HINTS`, `LAST_REVIEWED_SHA`, `PRIOR_BRANCH_FINDINGS`, `SCOPE_DECISION_FILE`, and `APPROVAL_SUMMARY_FILE` as `KEY=VALUE` lines; diagnostics go to stderr.

## Refusal and failures

Thrown option, range, paired-input, or unavailable-helper errors exit nonzero before a final scope decision is written. An invalid `--risk-signals` path instead yields exit-zero complete structured output with `RISK_SIGNALS_STATUS=invalid-path`.

## Side effects

It creates `.ephemeral` scratch changed-files data and prepares canonical scope-decision and approval-summary targets; it does not write either final artifact.

## Workflow boundary

[Branch-review workflow context](../SKILL.md) owns when to run this preparation and how to continue.
