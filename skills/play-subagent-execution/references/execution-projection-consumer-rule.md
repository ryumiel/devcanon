# Execution Projection Consumer Rule

Apply this rule to both executor and standalone Inline Execution admission. The
controller captures the guarded plan bytes once, hashes that exact capture,
compares it with the retained reviewed digest, and derives heading detection,
projection validation, task extraction, and execution only from that capture.
A mismatch returns to fresh D5/D6; never reread the plan path for execution.
After that admission, detect exactly one literal Markdown H2 line
`## Execution Projection` outside fenced code. Prose mentions, fenced examples,
differently labeled metadata, renamed headings, and legacy headings are not
canonical sections.
This rule enforces the planning criteria; it does not redefine producer
authority, authorize mutation, create a parser, schema, registry, or
compatibility route. Its validated dispositions and proof assignments derive
execution context and candidate route resolution only.

Before the structural task-contract gate, skip-dispatch evaluation, inline
execution, implementer/reviewer dispatch, or any other execution route, require
the active controller to retain the live matching `play-planning` return pair as
one aggregate attestation for the exact same lowercase 64-hex digest as the
exact plan bytes being executed. Copied text is not provenance. Do not demand
independent D5/D6 leaf identity or guard evidence. Absent, unknown, malformed,
stale, unreviewed, cross-digest, or otherwise unverifiable aggregate attestation
fails closed with `BLOCKED/NEEDS_CONTEXT`; never infer or substitute a digest,
review, plan, or legacy route.

Require every projection entry to use the exact planning-criteria labels and to
contain one nonblank Entry ID, one nonblank Relationship ID, one effective
contract tier, one affected surface or explicit equivalent surface set, the
selected tier shape, one implementation disposition, and one non-empty closed
proof-assignment list. The accepted common ungrouped sequence is:

```markdown
- **Entry ID:** `<semantic ID>`
  - **Relationship ID:** `<approved behavior or contract ID>`
  - **Effective contract tier:** `FULL` | `LIGHTWEIGHT` | `NO-TRIGGER`
  - **Affected surface:** `<one surface>`
  - **Implementation disposition:** Tasks [`<TASK-ID>`, ...] | No code — `<task-specific reason>`
  - **Proof assignments:**
    - **Task:** `<TASK-ID>`
      **Boundary:** `<concrete boundary>`
```

For a grouped entry, this replaces, and must not accompany,
`**Affected surface:**`:

```text
  - **Equivalent surface set:**
    - `<surface one>`
    - `<surface two>`
```

Derive the effective tier as the strongest declared tier among every
implementation member and proof-assignment task, using `FULL` > `LIGHTWEIGHT` >
`NO-TRIGGER`; a separately authorized exhaustive topology contract also selects
FULL. Reject a declared/effective mismatch. For FULL, insert the exact closed
topology fields after the surface field and before implementation disposition:

```text
  - **Topology role:** `normative owner` | `supporting owner` | `reference` | `derived representation` | `non-normative summary` | `verification`
  - **Normative owner:** `<owner>`
  - **Owner source:** `<authority>`
```

For a FULL `supporting owner` only, insert these immediately after
`**Owner source:**`:

```text
  - **Supporting owner:** `<concrete supporting owner>`
  - **Supporting partition:** `<approved non-overlapping responsibility>`
  - **Conflict precedence:** `<approved precedence against other owners>`
```

All three supporting fields are mandatory for that role and forbidden for every
other role and every non-FULL entry. For LIGHTWEIGHT, insert exactly these
compact fields after the surface field and before implementation disposition:

```text
  - **Participants:** `<every actual known participant>`
  - **Direct relationship:** `<direct producer-consumer or equivalent relationship>`
  - **Owner/authority:** `<owner and named authority>`
  - **Purpose:** `<purpose>`
  - **Inputs/outputs:** `<material inputs and outputs>`
  - **Side-effect owner:** `<material write or side-effect owner, or task-specific none>`
  - **Failure/cleanup:** `<failure and cleanup behavior>`
  - **FULL-trigger absence:** `<task-specific reason every FULL trigger is absent>`
```

For NO-TRIGGER, insert only `**NO-TRIGGER reason:** <task-specific reason no
contract trigger applies>` in that location. Reject mixed shapes, absent
selected-shape fields, FULL-only roles in compact entries, and compact fields in
FULL entries. Angle-bracket values, ellipses, and alternatives explain the
grammar and are not literal plan content.

For FULL entries, require exact coverage of the reviewed approved topology. The
normal participation identity is Relationship ID + semantic surface or surface
set + topology role. Supporting-owner identity additionally includes the
concrete supporting owner and stable approved partition identity or boundary.
Conflict precedence is mandatory validation but not identity. Entry IDs and
each complete participation identity resolve exactly once. A physical or
semantic surface may recur when another identity dimension differs. Reject
false owner roles, unknown roles, missing participation, exact duplicates, and
extra or unapproved participation. Implementation membership and proof
assignments affect context, grouping, and order but are not participation
identity dimensions.

Multiple supporting owners may share one semantic or physical surface only
when the approved topology already names distinct stable, non-overlapping
partition identities or boundaries. Require separate entries. Reject duplicate,
overlapping, equivalent, freely reworded, unstable, or inferred partitions. An
undifferentiated supporting-owner responsibility is a planning/design blocker;
do not repair it by changing the identity key or dropping an owner.

For LIGHTWEIGHT, require every actual known participant and direct relationship
plus every compact fact, without any FULL-only topology role. For NO-TRIGGER,
require the task-specific reason and common assignment core without invented
topology. Grouping is valid only within one relationship when effective tier,
the selected tier shape, exact implementation task set or no-code disposition,
and exact proof-assignment set are identical. FULL grouping also requires
identical topology role, normative owner, and owner source; supporting-owner
grouping additionally requires identical owner, partition, and precedence.
Reject any group that obscures a differing required dimension.

The implementation disposition is exactly one non-empty duplicate-free
`Tasks [<TASK-ID>, ...]` set or `No code — <task-specific reason>`. `Proof
assignments` is a non-empty list of unique Task IDs, each paired with one
concrete boundary. Every listed ID resolves exactly once to a current task. For
each task, derive its expected Entry ID set as the union of entries whose
implementation set contains it and entries whose proof assignments name it.
No-code reason text never contributes an implementation reference. Deduplicate
an Entry ID when the same task is both an implementation member and proof
assignee. Never duplicate a participation merely because multiple tasks
implement or prove it.

Validate proof readiness from execution order. Every proof assignment runs only
after all implementation members for its entry complete. A read-only proof task
must depend on every implementation member for each assigned entry. A
source-mutating proof assignee must be an implementation member, be the final
implementation member for that entry, name every other implementation member as
a task dependency, and prove after its own commit; at most one assignment per
entry may use that route. Every other independent assignment uses a dedicated
`read-only proof` task. Bind each controller-local result summary to the checked
HEAD. Any later relevant commit affecting the entry's
relationship, participation, implementation member, or proof boundary
invalidates the affected assignment and requires it to run again before final
review. Do not create a receipt, ledger, persistent discharge state, or new
route identity. A source-mutating assignee may rerun its proof checkpoint after
a later relevant commit without manufacturing an empty or unrelated commit.

Require every current task to declare `**Execution Projection references:**`.
It must list exactly its derived union, without duplicates, or use `None — no
projection entry names this task` only when that union is empty. Reject before
execution when a field or expected ID is absent, an ID is extra or duplicated,
an ID resolves zero or multiple times, a task owner is invalid, or a declared
and expected set differs. Do not silently deduplicate, infer entries, resolve
from another plan or source, or let a child resolve controller-owned mappings.

Require every current task to declare exactly one execution route field with
the value `source-mutating` or `read-only proof`. Every no-code proof assignment
and any proof that is not diff-verifiable must use the read-only route. A
read-only proof task may inspect and run permitted checks but may not edit
durable source or create a commit. Reject a mutating assignment for no-code
proof, a read-only implementation member, a missing route, or mixed route text.

Any missing, renamed, unknown, malformed, duplicate, incomplete, mismatched,
or unreviewed projection fact blocks with `BLOCKED/NEEDS_CONTEXT` and returns to
planning for correction and fresh paired review. Only after provenance,
validation, and exhaustiveness succeed, derive contexts in this order:

Add only resolved task-relevant entries—whether implementation-owned,
proof-assigned, or both—to each curated implementer, assessor, and reviewer
context.

For each no-code entry, every proof-assignment task receives it through the
existing task union and must declare the `read-only proof` execution route. Any
proof boundary that cannot be established from the committed implementation
diff likewise belongs to a dedicated read-only proof task. If that task or proof
boundary cannot be represented and executed in the active flow, block rather
than drop or infer the obligation. Never give children the full plan merely to
resolve entries.
For every proof-assignment task, require its extracted verification expectations
or checklist to cite the resolved Entry ID and execute its assigned proof
boundary at a fresh eligible HEAD; a reference declaration alone does not
complete the proof obligation.

For Contract Example Discipline, accept a valid relationship family containing
a normative-owner surface, reference consumer, and verification surface with
separate implementation and proof tasks, unique entries, and exact task unions.
Reject the named one-dimension invalid families: false role; duplicate identical
participation; grouped differing proof-assignment sets; omitted proof-task
reference; and nonexistent proof-assignment task. Accept repeated physical surfaces across
distinct relationships. Examples must remain source-consistent or explicitly
justified; unsupported, inconsistent, or unverifiable examples block rather
than invite guessing. Verify these outcomes by source inspection and
response-only behavioral evidence, without adding a parser or harness merely
for prose.

The pressure family crosses tier, topology role, supporting-owner cardinality,
implementation-task and proof-assignment cardinality, proof freshness,
mutating/read-only proof route, entrypoint,
final-review route, and recovery owner. It includes LIGHTWEIGHT-only,
NO-TRIGGER-only, mixed FULL/LIGHTWEIGHT, shared mixed-tier, two-task
implementation, two partitioned supporting owners on one surface, dedicated
read-only no-code proof, two independent proof assignments, a single read-only
task, inline and dispatched proof, capture-once inline admission, and both
implementation-defect and reviewed-plan-defect recovery. Reject
duplicate or unresolved task members, invalid task routes, missing proof
assignments, proof before implementation completion, stale proof after a later
relevant commit, a non-final source-mutating proof assignee,
inline execution that parses bytes other than its validated capture,
duplicate/equivalent/overlapping partitions, and FULL-only facts in compact
entries. Verify all values and interacting pairs plus these named critical
scenarios through source inspection and response-only evidence; do not create a
parser, harness, ledger, or persistent discharge state.
