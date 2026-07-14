# Canonical Planning Criteria

This reference is the single detailed criteria source for plan authoring,
self-review, Plan Review, and Implementer Executability Review. The owning
workflow stays in `../SKILL.md`; do not copy these criteria back into each gate.

## Contents

- [Governing invariant](#governing-invariant)
- [Scope Envelope](#scope-envelope)
- [Planning authority and readiness](#planning-authority-and-readiness)
- [Contract and traceability criteria](#contract-and-traceability-criteria)
- [Task contract criteria](#task-contract-criteria)
- [Minimum-sufficient proof](#minimum-sufficient-proof)
- [Finding classifications](#finding-classifications)
- [Gate remits](#gate-remits)

## Governing invariant

Planning may make approved scope executable, but it must not create new
product, infrastructure, governance, or verification obligations.

Every current task must map to an authoritative requirement and be necessary
to satisfy an in-scope outcome. Planning may decompose and sequence approved
decisions. It must not invent behavior semantics, authority, ownership,
mutation rights, lifecycle policy, or proof obligations.

## Scope Envelope

Write `## Scope Envelope` before file mapping or task planning. Include:

- **In-scope outcomes:** observable results the plan must produce.
- **Authoritative requirements:** stable requirement IDs or named owning
  sources that authorize those outcomes.
- **Explicit non-goals:** work the plan must not create.
- **Authorized durable surfaces:** source, tests, configuration, docs,
  schemas, protocols, or generated-source owners the approved work may change.
- **Deferred concerns:** useful hardening, generalization, or optimization that
  is not required now.
- **Blockers:** required decisions or authority that planning cannot supply.

If the approved work contains multiple independent subsystems, stop and return
to design decomposition instead of hiding them in one Scope Envelope.

### Expansion triggers

Treat each of these as scope expansion unless the user, approved design, issue,
specification, ADR, guideline, or other owning source explicitly authorizes it:

- a new reusable subsystem or framework;
- a durable schema, protocol, marker, or artifact family;
- retention, evidence-custody, or evidence-lifecycle policy;
- a generalized benchmark or evaluation harness;
- new source, external, or mutation authority;
- cross-provider evaluation beyond the acceptance criteria; or
- unrelated governance or documentation-policy changes.

Without authority, place the concern in Deferred Follow-ups. Do not turn it
into a task, acceptance criterion, proof obligation, or blocking review gap.

### Scope Delta

Write `## Scope Delta` before task planning. Map every proposed addition to its
authority, necessity, and disposition:

| ID  | Proposed addition                  | Authority               | Necessary for            | Disposition |
| --- | ---------------------------------- | ----------------------- | ------------------------ | ----------- |
| SD1 | Update an owning source skill      | Approved requirement R1 | Required behavior        | CURRENT     |
| SD2 | Add a generalized benchmark corpus | None                    | Useful future confidence | FOLLOW-UP   |

Allowed dispositions are `CURRENT`, `BLOCKER`, `FOLLOW-UP`, and `OPTIONAL` as
defined below. A `CURRENT` row must name authoritative scope and necessity. A
`BLOCKER` row must name the missing owner decision. Unauthorized additions are
never `CURRENT`.

For example, an approved change may authorize focused source, routing,
rendering, and regression-test work while leaving generalized benchmark
corpora, evidence-retention protocols, marker languages, and broad integrity
frameworks as FOLLOW-UP. The owning requirements, not the example, determine
the actual disposition.

## Planning authority and readiness

Before task planning, confirm that authoritative inputs decide:

- scope, outcomes, and non-goals;
- source precedence and conflict resolution;
- changed boundary participants;
- mutation and side-effect ownership;
- failure, recovery, retry, rollback, cleanup, and continuation semantics;
- artifact custody, validation, freshness, and lifecycle; and
- verification authority and acceptance evidence.

Planning details that remain discoverable from named source files are not
missing authority. Private helper decomposition, internal names, call-site
discovery, test implementation, fixtures, and concrete commands remain normal
implementation choices unless the approved design fixes them as contract.

For boundary-changing work, exact `Contract Decisions` or an equivalent
clearly labeled design section is authority. If required behavior semantics are
missing, record a BLOCKER and return to the owning design or source. Do not turn
the absence into an assumption.

Before implementation tasks begin, map every design contract decision to
current task coverage, acceptance criteria, ownership, and proof obligations.
Planning may decompose or sequence a decision, but it must not silently omit or
replace it.

## Contract and traceability criteria

### Contract-heavy work

Use a concise contract table when work depends on cross-skill handoffs,
generated or derived paths, helper scripts, source-owned policy, schemas,
interfaces, execution roots, state transitions, or fail-closed behavior. Name:

- inputs and optional inputs;
- execution root or cwd;
- source-of-truth and precedence;
- producers, validators, adapters, and consumers;
- outputs, derived paths, and allowed overrides;
- mutation or side-effect owner;
- missing, invalid, failure, recovery, and cleanup behavior; and
- observable proof.

For governance or workflow-policy changes, compare the Adjacent Governance
Policy Set in `docs/guidelines/documentation-checklists.md`. Update only the
surfaces whose existing trigger is met; record task-specific reasons for
inapplicable surfaces.

For generated artifacts, helper I/O, `.ephemeral` handoffs, or side-channel
data, apply the Side-Channel Artifact Contract Checklist from the same owner.
Do not create a new artifact family merely to make planning more exhaustive.
Include the relevant Side-Channel Artifact Contract Checklist obligations only
when its existing trigger applies.

### Boundary-contract traceability

For producer, validator, adapter, or consumer boundaries, assign stable row IDs
and name:

- boundary name and authoritative source;
- required input tuple;
- producer;
- validator or policy authority;
- adapter or consumer;
- failure behavior for missing or mismatched authority; and
- observable proof per participant.

Every row maps to a current task or an explicit no-code disposition. Every
participant has coverage and proof. A final consumer test does not cover a
missing producer, validator, or adapter obligation.

Every applicable task contract checklist references its governing boundary row
IDs or explicitly names the rows that own the task's participant coverage and
proof obligations. Plan Review fails a checklist that omits relevant row IDs or
row ownership, even when it precisely restates the boundary details.

Every governed boundary row cites the relevant design contract decision or
records why that decision is non-applicable. A no-code disposition still names
the governing decision and explains why implementation work is unnecessary.

Proof must be executable without prescribing implementation. Name diagnostic
shape, validation ordering, source inspection target or discovery criteria,
evidence location, terminal-state behavior, and forbidden-surface absence when
they are relevant. Phrases such as “stable diagnostic,” “source inspection,”
“rollback covered,” or “fail closed” are insufficient without an observable
condition.

### Contract Example Discipline

Plans that change schemas, APIs, function shapes, artifacts, CLI output, helper
I/O, or cross-skill contracts include `Contract Example Discipline` or an
equivalent section. Name:

- one canonical valid post-change example and its authority;
- representative invalid families derived by changing one contract dimension;
- required positive and negative proof; and
- intentionally out-of-scope invalid families.

Positive examples match the target post-change contract, not the pre-change
contract. Invalid examples change exactly one named contract dimension from the
canonical valid example unless intentional multi-fault behavior is explicitly
named. When source facts change, derived fields in examples or fixtures remain
consistent with those facts or the plan explicitly justifies why they do not.

Do not author implementation code, test bodies, fixture bodies, helper names,
line edits, shell recipes, or command sequences. Do not expand a focused
acceptance test into an exhaustive matrix unless authority requires it.

For presentation-only CLI output, existing output conventions and named source
types may authorize the canonical valid example when the approved design does
not introduce a new output contract. Invalid families cover only in-scope
contract failures. If none applies, state that with a task-specific reason; do
not invent a format decision or negative-test matrix to satisfy the section.

### Documentation-impact traceability

Every `Documentation impact` item from the issue, design, or owning source maps
to at least one current plan task. Plan Review fails when an item has no task
coverage or is replaced by copied issue comments, review history, validation
logs, or agent-local plans instead of an update to the owning durable artifact.

### Hard-requirement traceability

When the design has `## Hard Requirements`, write a `## Traceability Matrix`
before tasks. Every requirement maps to current task coverage, acceptance
criteria, and minimum-sufficient proof. Incidental modal prose, examples,
comments, or live evidence do not create additional hard requirements.

## Task contract criteria

Every current task includes:

- purpose and completed goal;
- explicit non-goals;
- exact affected files or authoritative discovery criteria;
- source-of-truth references and authority surfaces;
- acceptance criteria;
- risks and dependencies;
- verification expectations; and
- a contract checklist when a non-trivial trigger applies.

Non-trivial triggers include multi-step implementation, durable docs or policy,
cross-agent handoffs, schemas or interfaces, generated artifacts, state or
lifecycle behavior, fail-closed behavior, safety-sensitive behavior, and
compatibility or versioning. A trivial task may omit the checklist only with a
task-specific reason.

A required checklist covers trigger criteria, owner and authority, affected
consumers or generated outputs, must-preserve behavior, required state and
failure behavior, applicable spec or procedure work, relevant risks, and proof
obligations. Each field is populated or marked `N/A` with a task-specific
reason. Unknown authority becomes a BLOCKER, not an invented contract.

For a boundary-touching task, include a task-local I/O or operation map only
when needed to make approved behavior executable. When applicable, it names
current source, target surface, required inputs, optional inputs, missing or
empty behavior, outputs, errors, explicit write targets or side-effect owner,
validation-before-write or other validation-order requirements, failure
behavior, forbidden side effects, dirty or rollback behavior, and required
verification. It must not prescribe private implementation choices discoverable
from the named sources.

Compose related work when it shares one subsystem, authority, verification
route, and safe working context. Split work with different authorities,
independent rollback, or reviewed dependency boundaries. Do not split tasks to
manufacture review infrastructure or compose unrelated work to reduce dispatch
count.

Plans contain no placeholders such as `TBD`, generic “add validation,” or
“write tests” without behavior and proof. References to existing artifacts are
verified. Forward-looking paths are clearly owned by a current task.

Review-routing hints remain non-authoritative inputs to
`play-subagent-execution`. Hard-risk triggers from
`skills/play-subagent-execution/references/review-routing-policy.md` are not
under-classified; unclear cases default to `spec-and-quality`, and
foundation-producing tasks are not below `spec-only`. Field order is the task
heading, optional `**Mode:** mechanical`, optional review-routing hints, then
`**Files:**`.

## Minimum-sufficient proof

Use the narrowest existing repository mechanism that demonstrates each
acceptance criterion. Prefer, in order appropriate to the repository:

- focused existing tests;
- source or generated-output inspection;
- a bounded smoke check; and
- existing validation or render commands.

Do not require generalized harnesses, exhaustive matrices, new protocols,
marker languages, durable evidence systems, or cross-provider evaluation when
focused evidence suffices. Broader proof becomes CURRENT only when an
authoritative requirement demands it. Otherwise classify it FOLLOW-UP or
OPTIONAL.

Verification expectations name observable evidence categories and owning
surfaces, not exact command recipes. “Run tests” is too vague, while a focused
behavior, source surface, ordering check, rendered target, or absence check is
sufficient. Exact commands remain an implementer choice after source reading.

## Finding classifications

Every self-review and subagent review finding uses one classification:

- `CURRENT`: required by authoritative approved scope. It blocks PASS and may
  be fixed in the plan after authority is verified.
- `BLOCKER`: required for approved scope but missing an owning decision or
  authority. It blocks PASS and stops plan mutation until resolved.
- `FOLLOW-UP`: useful hardening, generalization, or future work. It does not
  block PASS and must not become a current task.
- `OPTIONAL`: preference or optimization. It does not block PASS.

PASS may coexist with FOLLOW-UP and OPTIONAL findings. Reports preserve those
items in Deferred Follow-ups without promoting them into tasks.

Before changing the plan for a finding, verify its authoritative requirement,
Scope Envelope row, and Scope Delta disposition. Only CURRENT findings may be
fixed automatically. BLOCKER stops. FOLLOW-UP and OPTIONAL remain deferred.

Plan Review fails any unauthorized task addition, any CURRENT task without an
authoritative requirement and necessity, or any attempt to use proof scope as a
reason to create unapproved infrastructure.

## Gate remits

### Self-Review

Check the Scope Envelope and Scope Delta first. Then check authoritative
coverage, placeholders, task contracts, contract and boundary traceability,
examples, hard-requirement coverage, file citations, documentation impact, and
minimum-sufficient proof. Classify findings before editing. Do not use
“fix inline” as authority.

### Plan Review

Validate approved scope, requirement coverage, unjustified tasks, dependencies,
contract and traceability coverage, documentation impact, and proof
proportionality. Report all concrete in-remit findings. Classify each finding.
CURRENT and BLOCKER findings prevent PASS. FOLLOW-UP and OPTIONAL findings do
not. Explicitly fail missing design Contract Decision and Documentation impact
item mappings. Do not repeat executability review or invent new requirements.

### Implementer Executability Review

Validate whether a competent non-senior implementer can begin after reading the
task and named sources without choosing missing product, policy, ownership,
side-effect, error, rollback, or guardrail semantics.

Do not require the plan to pre-resolve normal implementation choices,
call-site discovery, private helper structure, concrete tests, fixtures, or
commands discoverable from named sources. Do not broaden the Scope Envelope or
proof obligations. Apply minimum-sufficient proof. Classify missing authority
as BLOCKER, genuine task-contract omissions as CURRENT, and useful hardening as
FOLLOW-UP or OPTIONAL.
