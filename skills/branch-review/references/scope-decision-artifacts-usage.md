# Scope decision artifacts usage

## Role

Writes and validates deterministic branch-review scope-decision artifacts.

## Invocation

Run `bash "$BRANCH_REVIEW_DIR/scripts/scope-decision-artifacts.sh" <operation>` from the target repository root.

## Inputs

The operation requires its named environment and artifact inputs from the caller; optional scope fields are operation-specific. It reads stdin only for operations that explicitly accept an artifact payload.

## Working directory

The target repository root is required.

## Outputs

Successful operations emit their validated artifact path or result on stdout; diagnostics go to stderr.

## Refusal and failures

Malformed scope evidence, missing required inputs, or unsafe artifact paths exit nonzero without normal completion.

## Side effects

Write operations create or replace only their validated scope-decision artifact target.

## Workflow boundary

[Branch-review workflow context](../SKILL.md) owns selection, interpretation, and continuation.
