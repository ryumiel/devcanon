# Inspect plan projection usage

## Role

Inspects the structural execution projection of a guarded, saved plan through
the version-aligned sibling passive runtime.

## Invocation

Run `bash "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/inspect-plan-projection.sh" --path <repo-relative-plan-path>`. Run `--help` alone to print this usage document.

## Inputs

Exactly one nonempty repository-relative plan path is required through `--path`.
It accepts no optional arguments and reads no stdin. The controller retains path
guards and reviewed-digest verification before invocation.

## Working directory

The repository root is required for the runtime's path-backed inspection.

## Outputs

The helper forwards the sibling runtime's stdout, stderr, and exit status
unchanged. Successful inspection returns the closed `planning-projection/v1`
JSON object on stdout. Local `--help` writes this exact adjacent document to
stdout and nothing to stderr.

## Refusal and failures

Missing, empty, unknown, or extra arguments fail. A missing or incompatible
sibling runtime, or any runtime failure, fails without a fallback parser,
global CLI, result file, or retry.

## Side effects

Inspection is read-only and creates no files.

## Workflow boundary

[Play subagent execution workflow context](../SKILL.md) owns path/digest
guards, result validation and interpretation, record resolution, semantic
checks, and terminal workflow behavior.
