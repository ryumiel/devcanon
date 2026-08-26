# Phase artifacts usage

## Role

Validates readable issue-priming phase artifacts.

## Invocation

Run `node "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/phase-artifacts.mjs" validate-read <kind> <repo-relative-path>` on Windows or POSIX. A POSIX caller that needs the compatibility surface may instead run `bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/phase-artifacts.sh" ...`; that adapter delegates to the `.mjs` entrypoint and owns no validation policy.

## Inputs

The artifact kind and repo-relative path are required. Kind determines the required filename suffix: `issue-body` → `-issue-body.md`, `comment-evidence` → `-comment-evidence.md`, `research` → `-research.md`, `design` → `-design.md`, and `plan` → `-plan.md`. The path must name a direct child of `.ephemeral/` with the matching suffix. No optional inputs or stdin are accepted.

## Working directory

The issue worktree root is required.

## Outputs

Successful validation has an explicit silent-success contract: stdout must be empty. The entrypoint rejects unexpected stdout from its runtime. Failures write diagnostics to stderr and exit nonzero.

## Refusal and failures

Unknown kinds, suffix mismatches, paths outside `.ephemeral/`, nested or traversal paths, execution outside the repository root, symlinked `.ephemeral` or artifacts, and missing, unreadable, or non-regular artifacts are rejected.

## Side effects

Validation is read-only.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns the phase that consumes the validated artifact.
