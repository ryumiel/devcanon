# Prepare project description draft usage

## Role

Prepares a validated target for a Linear project-description draft.

## Invocation

Run `TARGET_FIELDS=<description|content|both> REPLACE_EXISTING=<true|false> bash "$WRITE_LINEAR_PROJECT_DESCRIPTION_DIR/scripts/prepare-project-description-draft.sh"`.

## Inputs

`TARGET_FIELDS` and `REPLACE_EXISTING` are required; the workflow supplies the remaining project and target environment. It reads no stdin.

## Working directory

Run from the repository root that owns the draft artifact.

## Outputs

It prints the prepared repo-relative draft path on stdout and diagnostics on stderr.

## Refusal and failures

Invalid field selection, missing required environment, unsafe target paths, or a protected existing target exits nonzero.

## Side effects

It may create the validated local draft target; it does not mutate Linear.

## Workflow boundary

[Linear project description workflow context](../SKILL.md) owns content drafting and external mutation choices.
