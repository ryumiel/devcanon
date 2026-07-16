# Planning Readiness Audit

This reference is the normative owner of the pre-drafting readiness audit used
by `play-planning`. Project designs and repository sources own project-specific
decisions; this reference owns when the audit runs, what it checks, and the
closed result contract. Planning must not use assumptions to invent missing
authority.

## Exhaustive audit triggers

Evaluate every trigger below explicitly. The list is exhaustive and has no
catch-all trigger.

| Trigger ID          | Audit is required when the work changes                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RA-CONTRACT`       | A cross-skill handoff, generated or derived path, helper or script I/O, source-owned policy boundary, schema or interface, execution root, state transition, or fail-closed behavior |
| `RA-STATE`          | Lifecycle, retry, rollback, cleanup, continuation, failure, or recovery semantics                                                                                                    |
| `RA-MULTI-BOUNDARY` | Two or more independently owned producer, validator, adapter, or consumer boundaries                                                                                                 |
| `RA-SIDE-EFFECT`    | Filesystem mutation beyond the planning artifact, user-home mutation, provider or network mutation, or another external side effect                                                  |
| `RA-EVALUATION`     | An evaluation, approval gate, reviewer remit, verification authority, or acceptance-evidence contract                                                                                |
| `RA-GOVERNANCE`     | A reusable skill or agent procedure, ADR-governed decision, guideline, contribution or review policy, or durable documentation ownership rule                                        |

The audit is required when any trigger is `true`. It may be skipped only when
all six trigger IDs are explicitly `false` and the controller records one
work-specific reason that names both the bounded operation and the authority
that makes every trigger false. An omitted trigger, a generic reason such as
“simple change,” or a reason that does not establish both facts is invalid and
produces `NOT_READY`.

## Audit dimensions

When the audit is required, inspect every dimension before file mapping or task
drafting:

- approved scope, authoritative requirements, and explicit non-goals;
- authoritative sources, their conflict precedence, and any incomplete or
  conflicting source claims;
- every boundary participant and its producer, validator, adapter, or consumer
  responsibility;
- mutation and external side-effect ownership and permission;
- lifecycle, failure, retry, rollback, cleanup, continuation, and recovery
  decisions;
- artifact production, validation, schema or shape, path, custody, freshness,
  persistence, cleanup, and consumption; and
- verification authority, acceptance evidence, and minimum-sufficient proof.

An incomplete, conflicting, or unowned required decision in any dimension is
not an implementation choice. Record it as a missing decision and return
`NOT_READY`.

## Closed outcomes

Return exactly one of these outcomes:

- `READY`: every required decision is owned and no recorded assumption is
  needed.
- `READY_WITH_RECORDED_ASSUMPTIONS`: authority is complete and only bounded,
  reversible, low-risk implementation assumptions remain.
- `NOT_READY`: at least one required project, policy, ownership, lifecycle,
  side-effect, failure, recovery, custody, conflict, or verification decision
  is missing or unresolved.

`NOT_READY` stops before drafting or writing a plan and returns every stable
missing-decision record to its named owner. `READY_WITH_RECORDED_ASSUMPTIONS`
requires the complete assumption records to be included in the saved plan so
self-review, D5, and D6 consume the same facts. `READY` records the outcome but
does not fabricate an empty assumptions table.

## Recorded assumptions

An assumption is allowed only for a reversible, bounded, low-risk
implementation choice. Every assumption has:

- a stable semantic ID;
- the assumption statement;
- one owner or source surface;
- rationale and supporting evidence;
- the bounded affected surface;
- risk;
- a reversal trigger; and
- a proof expectation.

An assumption cannot supply project or policy authority, select side-effect or
mutation ownership, waive a failure or recovery path, or resolve conflicting
normative sources. A missing or empty required field makes the audit
`NOT_READY`.

## Stable missing-decision records

Use `MD-<DIMENSION>-<SUBJECT>`, where `DIMENSION` and `SUBJECT` are uppercase
ASCII kebab-case semantic tokens. Do not use positional counters. Each record
contains:

- the stable ID;
- the missing decision;
- the reason planning cannot choose it; and
- exactly one owning source or design surface.

Keep the same ID across reassessment until the decision is resolved. Equivalent
duplicates merge without changing the ID. Reuse of one ID for conflicting
meanings, or naming zero or multiple owner surfaces, fails closed as
`NOT_READY`.
