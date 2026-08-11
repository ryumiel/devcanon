# Post merge cleanup usage

## Role

Performs deterministic local cleanup after a verified merge.

## Invocation

Run `bash "$PR_MERGE_DIR/scripts/post-merge-cleanup.sh"` with the documented merged-PR and preflight environment.

## Inputs

The helper requires PR metadata and preflight paths; `DEVCANON_RUNTIME_DIR` is an optional runtime override. It reads no stdin.

## Working directory

Run from the repository context selected by the preflight result.

## Outputs

It emits separate cleanup outcomes on stdout and diagnostics on stderr.

## Refusal and failures

Missing merge evidence, invalid preflight context, unavailable runtime, or unsafe cleanup state exits nonzero.

## Side effects

Successful cleanup may change local worktree and branch state; it does not verify or perform the merge.

## Workflow boundary

[PR merge workflow context](../SKILL.md) owns merge verification and manual-action decisions.
