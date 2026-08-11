# Prior thread artifacts usage

## Role

Prepares and validates prior-thread and scope-decision artifacts.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/prior-thread-artifacts.sh" <prepare-prior-threads-write|validate-prior-threads|prepare-scope-decision-write>`.

## Inputs

The selected command requires documented PR metadata and artifact paths; `PRIOR_THREADS_FILE` is optional where supported. It reads no stdin.

## Working directory

Run from the primary repository root or target worktree root required by the selected command.

## Outputs

It emits validated artifact paths or results on stdout and diagnostics on stderr.

## Refusal and failures

Unknown commands, missing metadata, unsafe paths, or invalid support validation exits nonzero.

## Side effects

Prepare commands write only their validated local artifact targets; validation commands are read-only.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns thread interpretation and review scope continuation.
