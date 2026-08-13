# Execution Projection Consumer Rule

Apply this rule only when the exact plan contains the exact Markdown H2 line
`## Execution Projection` outside fenced code. Prose mentions, differently
labeled metadata, fenced examples, and unknown or legacy headings do not
trigger it. Require exactly one such section; multiple canonical sections fail
closed.

Before the structural task-contract gate or any dispatch, including direct or
unreviewed `FULL` execution, structurally validate every projection entry. Each
entry uses the exact field labels defined by the planning criteria and must
provide a unique nonblank semantic ID, exactly one affected surface or explicit
equivalent set, a normative owner and owner source, a closed
consumption mode (`reference`, `derived representation`, `non-normative
summary`, or `verification`), a task/no-code disposition, a proof owner, and a
concrete proof boundary. Use exactly one of the two disposition forms shown
below. The task-owned form names one Task ID; the no-code form supplies a
task-specific reason and names no current implementation task. An equivalent
surface set must explicitly list every grouped surface; grouping is valid only
when owner/source, consumption mode, disposition, and proof owner/boundary are
identical for the entire set.

The accepted entry field sequence is:

```markdown
- **Entry ID:** `<semantic ID>`
  - **Affected surface:** `<one surface>`
  - **Normative owner:** `<owner>`
  - **Owner source:** `<authority>`
  - **Consumption mode:** `<closed mode>`
  - **Task/no-code disposition:** Task `<TASK-ID>` | No code — `<task-specific reason>`
  - **Proof owner:** `<owner>`
  - **Proof boundary:** `<concrete boundary>`
```

`**Equivalent surface set:**` with an explicit surface list replaces, and must
not accompany, `**Affected surface:**` for a grouped entry. Angle-bracket values
and the `|` alternatives above explain the grammar; they are not literal plan
content. Across the entire projection, each affected surface, including every
member of an equivalent set, must occur exactly once.

Require every current task to declare
`**Execution Projection references:**`. Derive that task's expected ID set from
the entries whose task/no-code disposition names its Task ID. Reject before
dispatch unless every task-owned disposition resolves to exactly one current
task in the same plan. Also reject when the field or an expected ID is absent,
a declared reference is duplicated, an ID resolves zero or multiple times, the
declared and expected ID sets differ, or any entry, task, or reference
relationship is ambiguous or semantically mismatched.
`None — no projection entry names this task` is valid only when the derived
expected set is empty.

Any missing, duplicate, ambiguous, incomplete, or semantically mismatched entry
or task linkage fails closed with `BLOCKED/NEEDS_CONTEXT` and returns to
planning for correction and fresh review. Do not infer an entry, silently
deduplicate, resolve from another plan or source, or let an implementer or
reviewer resolve controller-owned references.

After validation, add only the resolved task-relevant entries to curated
execution context. Never give children the full plan merely to provide
projection context.

If the exact canonical heading is absent, continue through the existing
paired-review and direct/unreviewed `FULL` routes. Do not require the projection
task field, invent a projection, or infer task references.
