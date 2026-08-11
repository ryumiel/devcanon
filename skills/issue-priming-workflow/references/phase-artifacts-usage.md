# Phase artifacts usage

## Role

Validates readable issue-priming phase artifacts.

## Invocation

Run `bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/phase-artifacts.sh" validate-read <kind> <repo-relative-path>`.

## Inputs

The artifact kind and repo-relative path are required. Kind is exactly one of `issue-body`, `comment-evidence`, `research`, `design`, or `plan`. No optional inputs or stdin are accepted.

## Working directory

The issue worktree root is required.

## Outputs

Successful validation is silent; failures write diagnostics to stderr and exit nonzero.

## Refusal and failures

Unknown kinds, unsafe paths, symlinks, unreadable files, and missing artifacts are rejected.

## Side effects

Validation is read-only.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns the phase that consumes the validated artifact.
