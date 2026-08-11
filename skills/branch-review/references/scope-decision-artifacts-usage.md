# Scope decision artifacts usage

## Role

Creates, validates, classifies, and writes branch-review scope-decision and approval-summary artifacts.

## Invocation

From the repository root, run `bash "$BRANCH_REVIEW_DIR/scripts/scope-decision-artifacts.sh"` followed by exactly one of: `prepare-scope-decision-write`, `prepare-approval-summary-write`, `validate-scope-decision`, `validate-approval-summary`, `finalize-scope-decision`, `classify-risk-signals`, or `write-approval-summary`. No operation reads stdin or accepts positional arguments after its command.

## Inputs

`prepare-scope-decision-write` and `prepare-approval-summary-write` require `HEAD_SHA`. `validate-scope-decision` requires `HEAD_SHA` and `SCOPE_DECISION_FILE`, with optional `PRIOR_BRANCH_FINDINGS`. `validate-approval-summary` requires `HEAD_SHA`, `APPROVAL_SUMMARY_FILE`, `FINDINGS_FILE`, and `SCOPE_DECISION_FILE`.

`finalize-scope-decision` requires `HEAD_SHA`, `SCOPE_DECISION_FILE`, `FULL_DIFF_RANGE`, `CANDIDATE_ACTIVE_DIFF_RANGE`, `ACTIVE_DIFF_RANGE`, `IS_FOLLOWUP_NARROW`, `CHANGED_FILE_COUNT`, `FOLLOWUP_SHA_USABLE`, `MECHANICAL_ESCALATE_FULL`, `FINAL_CHANGED_FILES_JSON`, and `FINAL_LANGUAGE_HINTS_JSON`; `LAST_REVIEWED_SHA`, `PRIOR_BRANCH_FINDINGS`, `MECHANICAL_ESCALATION_REASON`, `SEMANTIC_ESCALATION_REASON`, `SEMANTIC_DECISION_NOTES`, and `SEMANTIC_DECISION_AMBIGUOUS` are conditional or optional. `classify-risk-signals` requires `HEAD_SHA`, `FULL_DIFF_RANGE`, `RISK_SIGNALS_FILE`, and `RISK_SIGNALS_STATUS` (`absent`, `supplied`, or `invalid-path`). `write-approval-summary` requires `HEAD_SHA`, `BASE`, `FULL_DIFF_RANGE`, `ACTIVE_DIFF_RANGE`, `SCOPE_DECISION_FILE`, `FINDINGS_FILE`, and `APPROVAL_SUMMARY_FILE`. `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` and `BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN` are optional validator configuration.

## Working directory

Every operation requires the target repository root and a real `.ephemeral` directory when it accesses an artifact.

## Outputs

The two prepare commands print the canonical repo-relative target path. Validation commands are silent on success. `finalize-scope-decision` validates the written scope decision and is otherwise silent. `classify-risk-signals` prints three `KEY=VALUE` lines. `write-approval-summary` prints `Approval summary written to <path>.`; diagnostics use stderr and every refusal exits nonzero.

## Refusal and failures

The helper rejects missing or malformed environment values, non-root cwd, unsafe, unreadable, symlinked, stale, mismatched, or schema-invalid artifacts, unavailable support validation, invalid JSON arrays, and incompatible selected ranges.

## Side effects

Prepare commands create `.ephemeral` and reserve a validated target. `finalize-scope-decision` writes the canonical scope-decision JSON. `write-approval-summary` replaces the canonical approval-summary JSON only after validation. Classification and validation are read-only except for private temporary artifacts.

## Workflow boundary

[Branch-review workflow context](../SKILL.md) owns command selection, interpretation, and continuation.
