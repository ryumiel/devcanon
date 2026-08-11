# Find polluter usage

## Role

Finds a test that pollutes a selected file or directory.

## Invocation

Run `bash "$PLAY_DEBUG_DIR/scripts/find-polluter.sh" <file-or-directory> <test-pattern>`.

## Inputs

Both positional arguments are required. It accepts no optional inputs and reads no stdin.

## Working directory

Run from the repository root where the test command is meaningful.

## Outputs

It reports the polluting test search result on stdout and diagnostics on stderr.

## Refusal and failures

Wrong argument count, missing target, or an unsuccessful test search exits nonzero.

## Side effects

The search runs tests but does not intentionally modify repository source.

## Workflow boundary

[Play debug workflow context](../SKILL.md) owns investigation choice and follow-up.
