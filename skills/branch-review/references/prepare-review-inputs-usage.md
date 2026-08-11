# Prepare review inputs usage

## Role

Prepares deterministic branch-review input and scope-decision paths.

## Invocation

Run `bash "$BRANCH_REVIEW_DIR/scripts/prepare-review-inputs.sh" [<base>] [--fix] [--last-reviewed <sha>] [--prior-findings <path>] [--risk-signals <path>]` from the target repository root.

## Inputs

The positional base is optional and otherwise resolves from repository defaults. `--fix`, `--last-reviewed <sha>`, `--prior-findings <path>`, and `--risk-signals <path>` are optional, with follow-up fields validated as a coherent set. `PLAY_REVIEW_DIR` is required for its sibling helper; it reads no stdin.

## Working directory

The target repository root is required.

## Outputs

It emits parseable `KEY=VALUE` review facts, including `SCOPE_DECISION_FILE` and `APPROVAL_SUMMARY_FILE`; diagnostics go to stderr.

## Refusal and failures

Invalid ranges, paths, paired inputs, or unavailable bundle helpers exit nonzero before a final scope decision is written.

## Side effects

It creates `.ephemeral` scratch changed-files data and prepares canonical scope-decision and approval-summary targets; it does not write either final artifact.

## Workflow boundary

[Branch-review workflow context](../SKILL.md) owns when to run this preparation and how to continue.
