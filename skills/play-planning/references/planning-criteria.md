# Canonical Planning Criteria

This reference is the single detailed criteria source for plan authoring,
self-review, Plan Review, and Implementer Executability Review. The owning
workflow stays in `../SKILL.md`; do not copy these criteria back into each gate.

## Contents

- [Governing invariant](#governing-invariant)
- [Scope Envelope](#scope-envelope)
- [Planning authority and readiness](#planning-authority-and-readiness)
- [Exact digest and paired-review result contract](#exact-digest-and-paired-review-result-contract)
- [Contract and traceability criteria](#contract-and-traceability-criteria)
- [Ownership-topology mapping](#ownership-topology-mapping)
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

The bundled `planning-readiness-audit.md` exclusively owns audit dimensions,
triggers, outcomes, bounded-assumption rules, and stable missing-decision
records. Planning consumes that recorded result; this criteria reference does
not restate or redefine the audit checklist.

Planning details that remain discoverable from named source files are not
missing authority. Private helper decomposition, internal names, test
implementation, fixtures, concrete commands, and locating individual
references inside already named in-scope consumers or boundaries remain normal
implementation choices when a named authority or explicit discovery criterion
governs the mapping. Determining which consumers or boundary participants are
in scope is planning work, not normal call-site discovery. An omitted known
consumer or boundary mapping is a `CURRENT` task-contract gap; missing authority
for the required mapping is a `BLOCKER`.

For boundary-changing work, exact `Contract Decisions` or an equivalent
clearly labeled design section is authority. If required behavior semantics are
missing, record a BLOCKER and return to the owning design or source. Do not turn
the absence into an assumption.

Before implementation tasks begin, map every design contract decision to
current task coverage, acceptance criteria, ownership, and proof obligations.
Planning may decompose or sequence a decision, but it must not silently omit or
replace it.

This criteria reference owns the shared D5/D6 review-result and gap contract
below. It must not use review gaps to replace missing project authority.

## Exact digest and paired-review result contract

### Exact saved-plan digest

Bind every paired D5/D6 wave to SHA-256 over the exact saved plan bytes after a
complete write or authorized revision. Do not normalize Markdown, convert line
endings, trim whitespace, serialize content, or extract a section. The digest
is lowercase 64-character hexadecimal text. A missing or unreadable plan,
missing hash utility, read failure, or malformed digest blocks the wave.

The expected digest and saved plan path remain controller-local inputs. D5 and
D6 each independently hash the exact plan bytes they read and compare that
computed digest with the expected digest before returning. They must echo their
computed digest in the first line of their independent responses. After both
guard lifecycles settle and clean, the controller independently rehashes the
current exact plan bytes at the join and once more immediately before applying
dual PASS to a handoff. A reviewer-computed, join-time, or pre-handoff mismatch,
or any intervening plan-byte edit, invalidates both responses immediately;
verdicts from different digests never combine.

### Review result shape and exhaustive reporting

The first line is exactly `PASS — digest=<sha256>` or
`FAIL — digest=<sha256>`. PASS contains no `CURRENT` or `BLOCKER` gap. FAIL
reports every concrete in-remit gap before returning FAIL, grouped by task and
defect class, without stopping after the first gap. Reviewers exclude
speculative improvements and out-of-remit findings.

Every authored task has a required `**Task ID:** <UPPER-ASCII-KEBAB>` field
immediately after its heading. The Task ID is a semantic identity assigned
once, unique within the plan, independent of task number, order, and display
title, and preserved unchanged across task insertions, reordering, title edits,
and review revisions. Missing, duplicate, positional, or changed task IDs block
review. `Task N` remains a display and ordering label only.

Each non-passing gap uses `GAP-<TASK>-<CLASS>-<SUBJECT>`. `TASK` is the plan's
non-positional Task ID or `PLAN`; `CLASS` is selected from the closed
table below; and `SUBJECT` is an uppercase ASCII kebab semantic token that
names the contract, not its wording or position. Every gap record contains:

- stable gap ID;
- task ID or `PLAN`;
- defect class;
- classification, exactly `CURRENT` or `BLOCKER`;
- concise finding;
- authoritative source; and
- required correction for `CURRENT`, or exactly one decision owner for
  `BLOCKER`.

The same semantic gap keeps the same ID across reviewers and reruns. Equivalent
duplicate IDs merge and retain reviewer provenance. Conflicting duplicate IDs
make the paired wave malformed and non-passing. A missing field, unknown class,
misapplied class, invalid ID, malformed first line, or digest mismatch is also
non-passing.

### Closed gap classes and precedence

Use the first matching row in this exact precedence order:

| Precedence | Class           | Governing defect                                                                                                                          |
| ---------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | `SIDE-EFFECT`   | Missing or incorrect ownership or permission for filesystem, provider, network, user-home, or another external mutation                   |
| 2          | `ARTIFACT`      | Missing or incorrect artifact producer, validator, schema or shape, path, custody, freshness, persistence, cleanup, or consumer contract  |
| 3          | `LIFECYCLE`     | Missing or incorrect state transition, failure, retry, recovery, rollback, cleanup, continuation, or terminal behavior                    |
| 4          | `BOUNDARY`      | Missing or incorrect boundary participant, required or optional input, output, error, ordering, or interaction contract not covered above |
| 5          | `AUTHORITY`     | Missing, duplicated, conflicting, or unprioritized normative owner not covered above                                                      |
| 6          | `SCOPE`         | Unauthorized work, missing non-goal, or incorrect Scope Envelope or Scope Delta disposition                                               |
| 7          | `REQUIREMENT`   | Approved outcome or hard requirement lacks task or acceptance coverage                                                                    |
| 8          | `DEPENDENCY`    | Task prerequisite or dependency order is missing or incorrect                                                                             |
| 9          | `TRACEABILITY`  | Required mapping among owner, consumer, task, acceptance criterion, or proof is incomplete                                                |
| 10         | `DOCUMENTATION` | Required documentation-impact or adjacent-governance disposition is missing or incorrect                                                  |
| 11         | `VERIFICATION`  | Verification authority, observable evidence, or minimum-sufficient proof is missing or disproportionate                                   |
| 12         | `EXECUTION`     | A residual implementer-facing input, output, or required behavior decision is hidden after all more-specific classes are ruled out        |

### Consolidation, invalidation, and same-digest PASS

Join only after both independent reviewers have settled and completed their
guard lifecycles. Reject digest mismatch, malformed reports, unknown or
misapplied classes, missing stable fields, conflicting gap IDs, or incomplete
in-remit reporting. Consolidate equivalent IDs, retain both reviewer
provenances, and preserve distinct gaps.

Verified `CURRENT` gaps may revise the plan. A `BLOCKER` returns to its named
owner. `FOLLOW-UP` and `OPTIONAL` observations use the existing finding policy
outside the blocking gap records and remain deferred. Any plan-byte edit
invalidates both verdicts, requires a new exact digest, and requires a fresh
paired D5/D6 wave. Handoff is valid only when both reviewers independently PASS
the same current digest.

### Contract examples

#### Valid paired PASS

For a saved plan whose current exact-byte digest is
`0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`, the
canonical response pair is:

D5 response:

```text
PASS — digest=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

D6 response:

```text
PASS — digest=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

Both reviewers independently compute that digest from the exact plan bytes
they read. After both exact guard cleanups, the controller's join-time and
pre-handoff rehashes produce the same digest. With no `CURRENT` or `BLOCKER`
gap, this family passes.

#### Valid complete FAIL

The canonical valid FAIL family uses the same digest and contains two complete,
distinct in-remit gaps so exhaustive reporting has a positive baseline:

```text
FAIL — digest=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
Task: PLANNING-GATES
Class: ARTIFACT
ID: GAP-PLANNING-GATES-ARTIFACT-DIGEST-FRESHNESS
Classification: CURRENT
Finding: The current plan digest is not revalidated before handoff.
Authority: Exact plan digest contract.
Required correction: Recompute and compare the exact-byte digest before handoff.
Task: PLANNING-GATES
Class: LIFECYCLE
ID: GAP-PLANNING-GATES-LIFECYCLE-EARLY-JOIN
Classification: CURRENT
Finding: Routing begins before both reviewer lifecycles settle.
Authority: Paired review lifecycle contract.
Required correction: Join only after both lifecycles settle and clean.
```

#### Single-dimension invalid families

Each invalid family below changes exactly one named dimension from its
applicable valid family; all other facts remain consistent with that family and
source authority. Every invalid family is explicitly non-passing:

- D6 digest mismatch — reject both verdicts and make the wave non-passing;
  relative to the valid paired PASS, change only D6's digest.
- FAIL missing a required stable gap field — reject the malformed report and
  make the wave non-passing; relative to the valid complete FAIL, remove only
  the first gap's `Authority` field.
- conflicting meanings for one stable gap ID — reject consolidation as
  malformed and make the wave non-passing; relative to the valid complete
  FAIL, change only the second gap's ID to reuse the first gap's ID.
- reviewer stops after the first concrete in-remit gap — reject the incomplete
  report and make the wave non-passing; relative to the valid complete FAIL,
  omit only the second gap.
- plan bytes change after PASS — invalidate both verdicts and require a fresh
  paired wave within budget; relative to the valid paired PASS workflow, change
  only the plan bytes after PASS.
- route begins while a sibling remains active — reject the early route and
  wait for settlement and exact cleanup before any join; relative to the valid
  paired PASS workflow, change only sibling settlement state by routing early.

Positive examples must match the post-change contract. Derived facts must
remain consistent with source authority. Unsupported or source-inconsistent
examples are `BLOCKER` findings returned to the owning design or decision
surface; do not guess.

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

### Ownership-topology mapping

For every changed behavior or contract in an approved design, write a table or
equivalent structured mapping that names:

- the stable behavior or contract name and governing design decision;
- exactly one normative owner and the responsibility it defines;
- each optional supporting owner, its explicitly non-overlapping normative
  partition, and conflict precedence;
- every other affected surface, its owner source, and exactly one consumption
  mode: reference, derived representation, non-normative summary, or
  verification;
- current task coverage for the owner and every consumer; and
- the verification owner and the owner invariant, reference-validity boundary,
  or derived-parity boundary it proves.

The mapping is exhaustive over the changed behaviors and affected surfaces
authorized by the design. Repetition never grants authority. References and
non-normative summaries yield to the normative owner on conflict; derived
representations preserve owner parity; verification reports mismatch without
defining policy. Exact wording or diagram-edge proof is required only when the
representation itself is an intentional product contract. Generated skill
packages are derived consumers and never plan edit targets.

Planning is not ready when:

- multiple artifacts independently define the same requirement, state
  transition, routing rule, schema, lifecycle, or failure behavior without an
  approved partition;
- a supporting responsibility overlaps another partition, leaves an approved
  responsibility uncovered, or lacks conflict precedence;
- a changed behavior, affected surface, owner source, consumption mode, task,
  or verification owner is missing;
- a reference or summary is treated as authority because it repeats contract
  detail;
- a derived representation lacks an owner or proportional parity proof;
- verification defines copied policy or expected prose instead of proving an
  owner invariant, reference validity, or derived parity; or
- a reviewer or implementer would have to choose ownership or precedence.

Missing, duplicated, or conflicting project-specific topology is a `BLOCKER`
returned to the owning design; planning must not repair it by inventing an
owner or partition. An approved topology with incomplete or contradictory task
coverage is a `CURRENT` planning gap returned to `play-planning` during
implementation review. Neither route authorizes further synchronized
restatements.

When the plan includes topology examples, apply Contract Example Discipline to
one canonical valid post-change example. Representative invalid families
change one dimension at a time: duplicate the normative owner, overlap a
supporting partition, omit a consumer's owner source or mode, or treat
verification as policy authority. Keep derived facts consistent, require only
the positive and negative proof authorized by the design, and do not create an
exhaustive matrix. Unsupported or inconsistent example facts are
a `BLOCKER` returned to the owning design or decision surface, not invitations
to guess.

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
heading, required `**Task ID:**`, optional `**Mode:** mechanical`, optional
review-routing hints, then `**Files:**`.

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

Do not require the plan to pre-resolve normal implementation choices, private
helper structure, concrete tests, fixtures, commands, or individual-reference
discovery inside already named in-scope consumers or boundaries when a named
authority or explicit discovery criterion governs that discovery. Determining
the in-scope consumers or boundary participants is not normal call-site
discovery. Classify an omitted known mapping as CURRENT and missing mapping
authority as BLOCKER. Do not broaden the Scope Envelope or proof obligations.
Apply minimum-sufficient proof, and classify useful hardening as FOLLOW-UP or
OPTIONAL.
