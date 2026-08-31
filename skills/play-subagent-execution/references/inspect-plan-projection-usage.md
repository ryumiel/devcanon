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
unchanged. Successful inspection returns an untrusted closed
`planning-projection/v1` envelope. The controller accepts success only when it
has exactly one newline-terminated JSON object on stdout, empty stderr, and
status 0; local `--help` writes this exact adjacent document to stdout and
nothing to stderr.

The success root has exactly `schema`, `plan_path`, `projection`, and `tasks`.
`schema` is the literal `planning-projection/v1`; `plan_path` is a nonempty
string that exactly equals the guarded repository-relative path. `projection`
is an object with exactly `start`, `end`, and `entries`; `start` and `end` are
nonnegative integers with `start < end`, and `entries` is a nonempty array.
Each entry has exactly `entry_id`, `affected_surfaces`, `owner_source`, `mode`,
`implementation_task_ids`, `no_code_reason`, `proof`, `start`, and `end`.
There are unique nonempty `entry_id` values, and both `entry_id` and `task_id`
are strings matching the UPPER-ASCII-KEBAB grammar
`^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$`; `owner_source` is a nonempty string;
`affected_surfaces` is a nonempty array of nonempty unique strings; and `mode`
is `authority`, `reference`,
`derived representation`, `non-normative summary`, or `verification`.

All ranges are zero-based, end-exclusive integer offsets in the decoded input:
`0 <= projection.start < projection.end <= input.length`,
`projection.start <= entry.start < entry.end <= projection.end`, and
`0 <= task.start < task.end <= input.length`. `projection.start` is the start
offset of the literal `## Execution Projection` H2 heading, and
`projection.end` is the start offset of the peer `## Tasks` H2 heading,
excluding that terminator. Each entry's `start` and `end` are the mdast
`listItem.position` offsets for the complete projection entry. Each task's
`start` is the start offset of its canonical `### Task` H3 heading, and its
`end` is the start offset of the next canonical Task H3 or the first following
H2 section, whichever comes first; otherwise it is `input.length`.

An entry's disposition is either nonempty unique task IDs with
`no_code_reason: null`, or an empty task-ID array with a nonempty no-code
reason. `proof` is an object with exactly `owner_type`, `owner`, and `boundary`;
`owner_type` is `task`, `reviewer`, or `controller`, and `owner` and `boundary`
are nonempty strings. `tasks` is an array of task objects with unique nonempty
`task_id` values, each with exactly `task_id`, `heading`, `start`, and `end`;
its strings are nonempty, its ranges are nonnegative integers with
`start < end`, and every task-valued disposition or proof reference must
resolve exactly once against `tasks`. Every range is within the decoded
saved-plan input length.

## Refusal and failures

Missing, empty, unknown, or extra arguments fail. A missing or incompatible
sibling runtime, or any runtime failure, fails without a fallback parser,
global CLI, result file, or retry.

Failure writes nothing to stdout, writes exactly one newline-terminated JSON
object with exactly `ok: false`, `code`, and `message` to stderr, and exits
nonzero. The closed failure-code set is `plan-path-invalid`, `plan-unreadable`,
`execution-projection-missing`, `execution-projection-duplicate`,
`tasks-section-missing`, `task-heading-before-tasks`,
`projection-entry-missing`, `projection-entry-field-invalid`,
`entry-id-duplicate`, `task-id-invalid`, `task-id-duplicate`, and
`task-reference-unknown`. A duplicate literal peer `## Tasks` heading makes
the Tasks terminator ambiguous and uses `tasks-section-missing`. The runtime
reports the first finding in source order. This contract does not constrain
message prose and does not define precedence for equal offsets.

The controller maps a zero-status malformed or unknown success, including an
extra key, wrong nested type, bad identifier, empty affected surfaces, or invalid range,
path mismatch, reference inconsistency, or inconsistent result, to
`BLOCKED/NEEDS_CONTEXT`. It also maps a zero-status
channel violation, including extra stdout bytes or nonempty success stderr, to
`BLOCKED/NEEDS_CONTEXT` before every path-backed consumer. There is no repair,
fallback, or partial use.

## Side effects

Inspection is read-only and creates no files.

## Workflow boundary

[Play subagent execution workflow context](../SKILL.md) owns path/digest
guards, result validation and interpretation, record resolution, semantic
checks, and terminal workflow behavior.
