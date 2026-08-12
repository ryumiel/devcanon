# Phase artifacts usage

## Role

Validates readable issue-priming phase artifacts.

## Invocation

Run `bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/phase-artifacts.sh" validate-read <kind> <repo-relative-path>`.

## Inputs

The artifact kind and repo-relative path are required. Kind determines the required filename suffix: `issue-body` → `-issue-body.md`, `comment-evidence` → `-comment-evidence.md`, `research` → `-research.md`, `design` → `-design.md`, and `plan` → `-plan.md`. The path must name a direct child of `.ephemeral/` with the matching suffix. No optional inputs or stdin are accepted.

## Working directory

The issue worktree root is required.

## Outputs

Successful validation is silent; failures write diagnostics to stderr and exit nonzero.

## Refusal and failures

Unknown kinds, suffix mismatches, paths outside `.ephemeral/`, nested or traversal paths, execution outside the repository root, symlinked `.ephemeral` or artifacts, and missing, unreadable, or non-regular artifacts are rejected.

## Side effects

Validation is read-only.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns the phase that consumes the validated artifact.
