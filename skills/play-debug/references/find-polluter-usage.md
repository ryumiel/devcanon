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

It prints search progress, pre-existing-pollution notices, and either a no-polluter result or the discovered test and `ls -la` details on stdout. It does not use stderr for ordinary search diagnostics.

## Refusal and failures

Wrong argument count exits nonzero. A missing target is a valid clean initial state. Finding pollution exits nonzero after reporting the polluter; individual test failures are ignored while searching.

## Side effects

The search runs tests but does not intentionally modify repository source.

## Workflow boundary

[Play debug workflow context](../SKILL.md) owns investigation choice and follow-up.
