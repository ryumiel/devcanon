# Prepare project description draft usage

## Role

Prepares a validated target for a Linear project-description draft.

## Invocation

Run `PROJECT_KEY=<key> TARGET_FIELDS=<description|content|both> REPLACE_EXISTING=<true|false> bash "$WRITE_LINEAR_PROJECT_DESCRIPTION_DIR/scripts/prepare-project-description-draft.sh"`.

## Inputs

`PROJECT_KEY`, `TARGET_FIELDS`, and `REPLACE_EXISTING` are required. `PROJECT_KEY` is a safe nonempty project identifier; `TARGET_FIELDS` is `description`, `content`, or `both`; `REPLACE_EXISTING` is `true` or `false`. It reads no stdin.

## Working directory

Run from the repository root that owns the draft artifact.

## Outputs

It prints one validated repo-relative draft path for `description` or `content`, and two paths for `both`; diagnostics use stderr.

## Refusal and failures

Invalid field selection, missing required environment, unsafe target paths, or a protected existing target exits nonzero.

## Side effects

It creates `.ephemeral` and validates or reserves draft paths; it does not create draft content or mutate Linear.

## Workflow boundary

[Linear project description workflow context](../SKILL.md) owns content drafting and external mutation choices.
