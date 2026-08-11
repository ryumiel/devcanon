# Prepare review inputs usage

## Role

Prepares deterministic branch-review input and scope-decision paths.

## Invocation

Run `bash "$BRANCH_REVIEW_DIR/scripts/prepare-review-inputs.sh"` from the target repository root with its documented flags.

## Inputs

It requires the review base input; optional follow-up inputs and `PLAY_REVIEW_DIR` are supplied by the caller. It reads no stdin.

## Working directory

The target repository root is required.

## Outputs

It emits parseable review facts and prepared artifact paths on stdout; diagnostics go to stderr.

## Refusal and failures

Invalid ranges, paths, paired inputs, or unavailable bundle helpers exit nonzero before a final scope decision is written.

## Side effects

It may prepare the documented `.ephemeral` scope-decision target; it does not write the final decision.

## Workflow boundary

[Branch-review workflow context](../SKILL.md) owns when to run this preparation and how to continue.
