# Execution Projection Consumer Rule

Apply this conditional rule after the eager executor detects exactly one literal
Markdown H2 line `## Execution Projection` outside fenced code. Prose mentions,
fenced examples, differently labeled metadata, renamed headings, and legacy
headings are not canonical sections. This rule enforces the planning criteria;
it does not redefine producer authority, create a parser, schema, registry, or
compatibility route.

Before the structural task-contract gate, skip-dispatch evaluation, inline
execution, implementer/reviewer dispatch, or any other execution route, require
identifiable D5 Plan Review and D6 Implementer Executability Review PASS
provenance for the exact same lowercase 64-hex digest as the exact plan bytes
being executed. Each review must be independently identifiable, must report
PASS for that digest, and must have completed its required guard lifecycle.
Absent, unknown, malformed, stale, unreviewed, cross-digest, or otherwise
unverifiable provenance fails closed with `BLOCKED/NEEDS_CONTEXT`; never infer
or substitute a digest, review, plan, or legacy route.

Require every projection entry to use the exact planning-criteria labels and to
contain one nonblank Entry ID, one nonblank Relationship ID that identifies an
approved topology relationship, one affected surface or explicit equivalent
surface set, one closed topology role, a normative owner and owner source, a
task/no-code disposition, a closed proof owner, and a concrete proof boundary.
The closed roles are `normative owner`, `supporting owner`, `reference`,
`derived representation`, `non-normative summary`, and `verification`. The
accepted ungrouped field sequence is:

```markdown
- **Entry ID:** `<semantic ID>`
  - **Relationship ID:** `<approved behavior or contract ID>`
  - **Affected surface:** `<one surface>`
  - **Topology role:** `normative owner` | `supporting owner` | `reference` | `derived representation` | `non-normative summary` | `verification`
  - **Normative owner:** `<owner>`
  - **Owner source:** `<authority>`
  - **Task/no-code disposition:** Task `<TASK-ID>` | No code — `<task-specific reason>`
  - **Proof owner:** Task `<TASK-ID>` | Non-task owner — `<concrete owner>`
  - **Proof boundary:** `<concrete boundary>`
```

For a grouped entry, this replaces, and must not accompany,
`**Affected surface:**`:

```text
  - **Equivalent surface set:**
    - `<surface one>`
    - `<surface two>`
```

For `supporting owner` only, insert these immediately after `**Owner source:**`:

```text
  - **Supporting partition:** `<approved non-overlapping responsibility>`
  - **Conflict precedence:** `<approved precedence against other owners>`
```

Both supporting fields are mandatory for that role and forbidden for every
other role. Angle-bracket values and `|` alternatives explain the grammar and
are not literal plan content.

Require the projection to exactly cover every approved relationship + surface or
equivalent surface set + topology-role participation in the reviewed plan's
approved topology, with no omitted or extra participation. Each represented
Relationship ID + surface + topology-role participation occurs exactly once.
Entry IDs must also resolve exactly once. A physical surface may recur for a
distinct relationship or role; reject only duplicate identical relationship +
surface + role participation. Owner roles must truthfully prove the approved
normative or non-overlapping supporting owner invariants. The other roles retain
reference-validity, derived-parity, summary, and verification semantics. Reject
unknown roles, role-incompatible supporting fields, missing or duplicate IDs,
absent or unapproved relationships, false owner roles, and any ambiguous or
malformed value.

Grouping is valid only within one relationship and only when topology role,
normative owner, owner source, implementation disposition, proof owner, and
proof boundary are identical. Supporting-owner grouping additionally requires
identical partition and conflict precedence. Any differing dimension requires
separate entries. Reject grouped entries that obscure different proof owners,
partitions, precedence, task coverage, or other required dimensions.

`Proof owner` uses only `Task <TASK-ID>` or
`Non-task owner — <concrete owner>`. For each current task, derive its expected
Entry ID set as the union of entries whose disposition uses the exact
`Task <TASK-ID>` branch for that Task ID and entries whose task-valued proof
owner names it. `No code — <task-specific reason>` never contributes an
implementation-task reference, regardless of reason text. Deduplicate an ID
when the same task owns both forms. Every task-valued implementation disposition
and proof owner must resolve exactly once to a current task in the same plan;
non-task owners create no task reference.

Require every current task to declare `**Execution Projection references:**`.
It must list exactly its derived union, without duplicates, or use `None — no
projection entry names this task` only when that union is empty. Reject before
execution when a field or expected ID is absent, an ID is extra or duplicated,
an ID resolves zero or multiple times, a task owner is invalid, or a declared
and expected set differs. Do not silently deduplicate, infer entries, resolve
from another plan or source, or let a child resolve controller-owned mappings.

Any missing, renamed, unknown, malformed, duplicate, incomplete, mismatched,
or unreviewed projection fact blocks with `BLOCKED/NEEDS_CONTEXT` and returns to
planning for correction and fresh paired review. Only after provenance,
validation, and exhaustiveness succeed, derive contexts in this order:

1. Add only resolved task-relevant entries—whether implementation-owned,
   proof-owned, or both—to each curated implementer and reviewer context.
2. Retain every validated `No code — <task-specific reason>` entry and its full
   proof tuple in `EXTRACTED_WHOLE_IMPLEMENTATION_CONTEXT`, the controller-
   curated whole-range context supplied to D16/the final whole-implementation
   reviewer until its proof boundary is discharged.

For each no-code entry, a task-valued proof owner receives it through the
existing task union. A non-task proof owner must be concrete; the controller
keeps its named proof boundary visible in the relevant whole-range/final-review
context until discharged. If either named owner or proof boundary cannot be
represented or reached in the active execution flow, block rather than drop or
infer the obligation. Never give children the full plan merely to resolve
entries.

For Contract Example Discipline, accept a valid relationship family containing
a normative-owner surface, reference consumer, and verification surface with
separate implementation and proof tasks, unique entries, and exact task unions.
Reject the named one-dimension invalid families: false role; duplicate identical
participation; grouped differing proof owners; omitted proof-task reference; and
nonexistent task-valued proof owner. Accept repeated physical surfaces across
distinct relationships. Examples must remain source-consistent or explicitly
justified; unsupported, inconsistent, or unverifiable examples block rather
than invite guessing. Verify these outcomes by source inspection and
response-only behavioral evidence, without adding a parser or harness merely
for prose.

The no-code response-only family contains one task-valued proof owner and one
concrete non-task proof owner: the former appears through the task union, while
the controller whole-range/final-review context retains both complete proof
tuples. An unreachable named owner or proof boundary blocks rather than drops
the entry. An invalid no-code reason containing a Task ID does not contribute
implementation ownership to that task's union.
