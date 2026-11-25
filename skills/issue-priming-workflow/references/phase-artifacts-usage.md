# Phase artifacts usage

## Role

Validates readable issue-priming phase artifacts and persists tracker evidence.

## Invocation

Run `node "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/phase-artifacts.mjs" validate-read <kind> <repo-relative-path>` on Windows or POSIX. A POSIX caller that needs the compatibility surface may instead run `bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/phase-artifacts.sh" ...`; that adapter delegates to the `.mjs` entrypoint and owns no validation policy.

To persist tracker evidence, run `node "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/phase-artifacts.mjs" write-tracker-artifact <kind> <repo-relative-path>`.

## Inputs

The artifact kind and repo-relative path are required. Kind determines the required filename suffix: `issue-body` → `-issue-body.md`, `comment-evidence` → `-comment-evidence.md`, `research` → `-research.md`, `design` → `-design.md`, `plan` → `-plan.md`, and `assumptions-comment` → `-assumptions-comment.md`. The path must name a direct child of `.ephemeral/` with the matching suffix.

`validate-read` ignores stdin. `write-tracker-artifact` accepts only `issue-body`
and `comment-evidence`, uses ASCII letters, digits, dots, underscores, and hyphens in the filename stem,
and reads the UTF-8 content from stdin through EOF. An empty input writes an
empty artifact.

## Working directory

The issue worktree root is required.

## Outputs

Both operations are silent on success. The entrypoint rejects unexpected stdout
from its runtime. Failures write diagnostics to stderr and exit nonzero.

## Refusal and failures

Both operations reject unsupported kinds, suffix mismatches, unsafe paths, and
execution outside the repository root. Read validation rejects links and
missing, unreadable, or non-regular artifacts. The writer rejects a non-directory
`.ephemeral` entry and a non-regular artifact entry after link handling.

## Side effects

Validation is read-only. The writer creates `.ephemeral` when needed and
replaces symbolic links recognized by Node, including Windows junctions, at
`.ephemeral` or the selected artifact path. It unlinks the entry itself and
publishes the supplied bytes by atomic replacement. Other Windows reparse
tags are outside the verified link-handling contract.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns the phase that consumes the validated artifact.

For the bounded PREP-000 scenario map and semantic evaluation limits, see
[proportional preparation coverage](preparation-coverage.md).
