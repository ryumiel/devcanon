# Resolve task records usage

## Role

Validates one reviewed plan task's canonical record-reference fields and emits
only kind-grouped identifiers for execution-controller context curation.

## Invocation

From the physical repository root, set `PLAN_PATH`, `TASK_ID`, and
`EXPECTED_PLAN_DIGEST`, then run
`node "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/resolve-task-records.mjs"`.
`--help` accepts no additional arguments and prints this adjacent usage
contract. Normal operation accepts no positional arguments or optional inputs.

## Inputs

- `PLAN_PATH`: guarded repo-relative direct-child `.ephemeral/*-plan.md` path;
  both `/` and `\` are rejected inside the filename.
- `TASK_ID`: stable uppercase ASCII kebab identifier for the current task.
- `EXPECTED_PLAN_DIGEST`: reviewed lowercase 64-hex SHA-256 digest.

Normal operation requires definitively empty stdin. Nonempty stdin is refused
before plan resolution and never contributes task or record data. An open pipe
whose emptiness cannot yet be established also fails closed; automated callers
must close stdin rather than leave an unused producer open.

The exact reviewed plan bytes must decode as valid UTF-8. Invalid byte
sequences fail rather than being replaced during decoding.

The selected task must contain exactly one `**Boundary rows:**` field and one
`**Supporting-owner supplements:**` field. Each value is a JSON array of zero
or more unique, non-empty stable identifier strings. JSON whitespace, including
line wrapping outside strings, is accepted. Before `## Tasks`, boundary records
use the exact visible H3 text `Boundary row` followed by the ID in backticks.
Inside at most one `## Supporting-Owner Supplements` section, supplements use
the exact bullet label `Governing Entry ID` followed by the ID in backticks.
These anchors identify records but do not define or extract their bodies.
Code spans use Markdown's one-space padding rule, so identifiers that begin or
end with a backtick retain their exact visible value.
Fenced code and HTML-comment content are invisible and cannot define a section,
task, field, or record anchor. HTML-comment delimiters inside Markdown inline
code spans remain visible literal content and do not start or end a comment.

## Working directory

Run from the planning worktree's physical Git repository root. Invocation from
another directory fails before plan resolution.

## Outputs

Success writes one newline-terminated JSON object to stdout with schema
`play-subagent-execution/task-record-resolution/v1` and exactly these keys:
`schema`, `task_id`, `boundary_row_ids`, and
`supporting_owner_supplement_ids`. The two record-kind values contain only
validated identifier strings in authored request order. The helper never emits
Markdown record bodies, a notice line, or an output file.

## Refusal and failures

The helper fails nonzero without partial structured stdout for an unsafe,
missing, unreadable, nonregular, or symlinked plan; wrong working directory;
missing or malformed inputs; digest mismatch; invalid UTF-8; missing, repeated,
or malformed task fields; duplicate requested IDs; missing or duplicate Task
IDs; unknown, stale, ambiguous, duplicate-definition, or cross-kind record IDs;
or malformed canonical record anchors. Resolution is direct and kind-scoped.
The helper does not normalize or repair the plan, infer semantic applicability,
recursively traverse records, extract Markdown bodies, or forward the complete
plan. Diagnostics JSON-escape caller-controlled paths, task IDs, and record
IDs.

## Side effects

Read-only. The helper creates no file, retained state, Git change, network
operation, provider mutation, user-home mutation, or other external side effect.

## Workflow boundary

[`play-subagent-execution`](../SKILL.md) owns invocation ordering, closed-result
validation, identified-record curation, `BLOCKED/NEEDS_CONTEXT` continuation,
and dispatch gating. Planning criteria own field and carrier semantics. This
helper owns only exact-digest structural identity and kind validation; success
does not grant semantic authority to plan-authored content.
