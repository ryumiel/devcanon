# Canonical Planning Criteria

This reference is the single detailed criteria source for plan authoring,
self-review, Plan Review, and Implementer Executability Review. The owning
workflow stays in `../SKILL.md`; do not copy these criteria back into each gate.

## Contents

- [Governing invariant](#governing-invariant)
- [Scope Envelope](#scope-envelope)
- [Planning authority and readiness](#planning-authority-and-readiness)
- [Proportional contract planning](#proportional-contract-planning)
- [Exact digest and paired-review result contract](#exact-digest-and-paired-review-result-contract)
- [Blocking materiality and review convergence](#blocking-materiality-and-review-convergence)
- [Contract and traceability criteria](#contract-and-traceability-criteria)
- [Ownership-topology mapping](#ownership-topology-mapping)
- [Execution projection](#execution-projection)
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

## Proportional contract planning

Classify each task against this closed tier set before selecting contract
detail. The tier changes how compactly an approved contract may be expressed;
it never weakens an applicable boundary, omits a known participant, or changes
what counts as a blocking defect. Ambiguous classification defaults to `FULL`.

- `FULL`: required for this proportional route when any `LIGHTWEIGHT`
  eligibility dimension below is false or unclear. FULL
  treatment includes authority and precedence; required and optional inputs;
  outputs; every participant and its traceability; material side-effect
  ownership; lifecycle, failure, recovery, cleanup, and trust-boundary
  behavior; every applicable side-channel obligation; canonical valid and
  invalid examples; projection-owned proof allocation; and task-local
  verification expectations.
- `LIGHTWEIGHT`: allowed only when all five behavioral dimensions are true:
  exactly one behavioral owner; no public schema or API; no security-sensitive
  or untrusted boundary; no external mutation; and outputs and side effects are
  bounded and recoverable. Selected projection entries record its common owner/source,
  participants, relationships, and proof allocation. The compact task record
  adds purpose, inputs and outputs, producer or consumer direction when it is an
  independently necessary execution fact identified by neither the selected
  projection tuple nor an applicable directly cited boundary row, material
  write or side-effect owner, failure and cleanup behavior, focused verification
  expectations, and the explicit reason all five
  eligibility dimensions are true. Changing any one dimension makes this
  `LIGHTWEIGHT` route invalid and requires the applicable stronger treatment.
- `NO-TRIGGER`: allowed only when the task changes no contract, boundary,
  lifecycle, side effect, generated or side-channel artifact, interface,
  policy, or other non-trivial task-contract trigger. State a task-specific
  reason. The ordinary task fields, acceptance criteria, and
  minimum-sufficient proof still apply.

Do not infer LIGHTWEIGHT from a small diff, private implementation naming, an
artifact type, programming language, repository layout, path, or implementation
mechanism. Persistence or filesystem effects alone do not require `FULL`; judge
whether the five behavioral dimensions remain true. Missing owners,
participants, membership, proof, and execution facts remain blocking at every
tier.

The no-external-mutation dimension concerns mutation of externally controlled
or outside the authorized worktree state. A filesystem output inside the
authorized worktree is not external solely because it persists.
The fifth dimension separately determines whether outputs and side effects are
bounded and recoverable. Write ownership and permission remain subject to
existing mutation-authority and `SIDE-EFFECT` validation, while applicable
lifecycle behavior remains independently required.

### Proportionality examples

- **Valid `LIGHTWEIGHT` example:** one behavioral owner produces a bounded,
  recoverable filesystem output inside the authorized worktree for
  private internal behavior. There is no public schema or API, no
  security-sensitive or untrusted boundary, and no mutation of externally
  controlled or outside the authorized worktree state. Its compact
  contract owns task-local inputs, outputs, write owner, failure and cleanup
  behavior, and focused verification; its projection entry records common
  participation and proof allocation. Existing mutation-authority permission
  checks and the fifth dimension's bounded/recoverable requirement still apply.
  Persistence and the filesystem mechanism do not by themselves require `FULL`.
- **Invalid behavioral-owner mutation:** relative to that valid example, add a
  second behavioral owner. Exactly one behavioral owner is no longer true, so
  this `LIGHTWEIGHT` route is ineligible.
- **Invalid public-contract mutation:** relative to the valid example, expose
  the output as a public schema or API. The no-public-contract dimension is
  false, so this `LIGHTWEIGHT` route is ineligible.
- **Invalid trust-boundary mutation:** relative to the valid example, accept
  untrusted input or cross a security-sensitive boundary. The trusted-boundary
  dimension is false, so this `LIGHTWEIGHT` route is ineligible.
- **Invalid external-mutation mutation:** relative to the valid example, add a
  provider, network, user-home, system-wide, a write outside the authorized
  worktree, or another externally controlled mutation. The no-external-mutation
  dimension is false, so this `LIGHTWEIGHT` route is ineligible.
- **Invalid recovery mutation:** relative to the valid example, make only the
  output or side effect unbounded or unrecoverable. The bounded-recoverable
  dimension is false, so this `LIGHTWEIGHT` route is ineligible.
- **Valid `FULL` example:** a durable cross-owner boundary names its authority
  and precedence; required and optional inputs; outputs; every producer,
  validator, adapter, and consumer with participant traceability; the material
  side-effect owner; lifecycle, failure, recovery, cleanup, and trust-boundary
  behavior; every applicable side-channel obligation; canonical valid and
  invalid examples; projection-owned proof allocation; and task-local
  verification expectations for every participant.
- **Invalid consumer-omission mutation:** relative to that valid example,
  remove exactly one known consumer and its proof while preserving all other
  facts. The omitted known consumer remains a blocking gap; a final-consumer
  test or smaller diff does not make the contract complete.

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
immediately after its heading. The task record also contains exactly one
`**Boundary rows:**` field and one `**Supporting-owner supplements:**` field
using the canonical JSON-array shape defined below; their relative position and
the order of unrelated task fields are non-semantic. The Task ID is a semantic identity assigned
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
- `Authority`: the authoritative requirement or owner that makes correction
  necessary;
- `Concrete blocker`: the specific acceptance, execution, or safety condition
  that cannot be satisfied;
- `Inspection insufficiency`: why named source inspection and normal
  implementer discovery cannot resolve the defect; and
- `Smallest correction or decision owner`: the minimum plan correction for
  `CURRENT`, or exactly one decision owner for `BLOCKER`.

The same semantic gap keeps the same ID across reviewers and reruns. Equivalent
duplicate IDs merge and retain reviewer provenance. Conflicting duplicate IDs
make the paired wave malformed and non-passing. A missing field, unknown class,
misapplied class, invalid ID, malformed first line, or digest mismatch is also
non-passing.

### Closed gap classes and precedence

Use the first matching row in this exact precedence order:

| Precedence | Class           | Governing defect                                                                                                                          |
| ---------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | `SIDE-EFFECT`   | Missing or incorrect ownership or permission for a filesystem write, provider, network, user-home, or another external mutation           |
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

`SIDE-EFFECT` separately catches missing or incorrect filesystem-write
ownership or permission. A filesystem write is external only when it mutates
externally controlled or outside the authorized worktree state.

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
Authority: Exact plan digest contract.
Concrete blocker: The current plan digest is not revalidated before handoff.
Inspection insufficiency: The plan cannot prove a future controller rehash.
Smallest correction or decision owner: Require the pre-handoff exact-byte rehash.
Task: PLANNING-GATES
Class: LIFECYCLE
ID: GAP-PLANNING-GATES-LIFECYCLE-EARLY-JOIN
Classification: CURRENT
Authority: Paired review lifecycle contract.
Concrete blocker: Routing begins before both reviewer lifecycles settle.
Inspection insufficiency: The plan's early route is itself the lifecycle defect.
Smallest correction or decision owner: Join only after both lifecycles settle and clean.
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

## Blocking materiality and review convergence

A finding blocks only when all four materiality fields are concrete and
supported: `Authority`, `Concrete blocker`, `Inspection insufficiency`, and
`Smallest correction or decision owner`. A reviewer cannot use desired detail,
personal preference, generic risk, or a possible improvement as a substitute
for any field. If named source inspection or normal implementation discovery
is sufficient, the finding is not a blocking execution gap.

Wave one is exhaustive: D5 and D6 each report every concrete blocking gap in
their distinct remit for the current digest. Wave two verifies every prior
blocking gap against the revised plan and checks for regressions introduced by
the revision. A newly blocking wave-two gap must add a `New evidence basis`
field naming one of these bounded bases:

- a newly discovered concrete source fact;
- a contradiction exposed by the correction;
- an invalid dependency or path;
- an omitted current surface; or
- a material safety defect.

The basis must identify evidence that was not reasonably available from the
first-wave plan and named sources, rather than rephrasing an earlier finding.
Optional infrastructure, available preferences, speculative hardening, and
unsupported proof expansion cannot become blocking acceptance in wave two.
Newly noticed ordinary defects that were inspectable in wave one do not gain a
new acceptance obligation; reviewers preserve exhaustive first-wave
accountability instead of serializing review.

Review convergence has a maximum of two paired waves. After a non-passing
second wave, return unresolved `BLOCKER` findings to their named owners and
surface unresolved authorized `CURRENT` gaps without inventing a third review
wave or weakening them. The controller retains prior gap IDs, provenance,
evidence bases, and verification status only as controller-local review state.
This creates no persistent result artifact, helper, schema, registry, or
standing review protocol.

Wave-two terminal state is computed independently for each prior gap record
after both reviewers settle on the same digest. A prior gap whose correction is
verified and that neither recurs nor regresses remains `RESOLVED` + `PASSED`
even when a distinct valid new-evidence gap makes the overall wave non-passing.
For a consumable valid same-digest pair, that prior gap becomes `UNRESOLVED` +
`FAILED` only when the same gap recurs, its correction regresses, or its own
record or transition is malformed or out of order. An orthogonal new-evidence
`CURRENT` or `BLOCKER` never rewrites that prior record to unresolved. The
overall wave still surfaces every valid new or unresolved gap and stops after
wave two without weakening the no-third-wave rule.

A final-wave operational or reviewer verification failure prevents a
consumable valid same-digest pair when it includes guard capture failure; spawn
failure; reviewer unavailability; a malformed or semantically rejected
response; a wrong digest; guard verification or cleanup failure; a join-time
or pre-handoff mismatch; plan or source drift; or an equivalent terminal
invalidation. For any such failure, the controller transitions each
still-pending prior record from `CORRECTED` + `PENDING` to `UNRESOLVED` +
`FAILED`, records concrete verification-failure evidence without claiming that
the correction recurred or regressed, surfaces the operational failure and
every affected prior gap, prohibits execution handoff, and stops without a
third wave. This operational settlement applies only to still-pending records;
it never overwrites a record already settled from a consumable valid
same-digest pair.

### Convergence examples

- **Valid wave-two evidence example:** wave one reports a missing consumer
  proof. The revision adds that proof but exposes a newly discovered concrete
  source fact showing that the consumer also rejects stale input. Wave two
  verifies the prior correction, checks that the revision introduced no
  regression, and reports the newly material stale-input gap with `New evidence
basis` pointing to that source fact.
- **Invalid available-evidence mutation:** relative to the valid wave-two
  example, change only the evidence basis to a source fact already available in
  the named first-wave sources. It cannot originate a new wave-two blocker.
- **Invalid optional-infrastructure mutation:** relative to the valid wave-two
  example, change only the new gap to a request for an optional generalized
  validation service. Optional infrastructure is not blocking acceptance.

Material omissions and unsafe execution remain fail-closed at every tier and
wave. In particular, missing consumers, invalid paths or dependencies,
ambiguous mutation ownership, unsafe cleanup, malformed review results, and
digest or guard failures prevent handoff. Stable gap IDs and classes,
exact-digest freshness, paired independent reviews, and the two-wave stop remain
mandatory.

## Contract and traceability criteria

### Contract-heavy work

Select contract-heavy detail from the task's contract tier. For `FULL` or a
separately named material authority, use the complete contract-heavy or
helper-I/O table when work depends on cross-skill handoffs, generated or
derived paths, helper scripts, source-owned policy, schemas, interfaces,
execution roots, state transitions, or fail-closed behavior. Reference the
governing projection Entry IDs for the common relationship tuple, then add:

- inputs and optional inputs;
- execution root or cwd;
- source-of-truth and precedence;
- producer, validator, adapter, or consumer roles and direction only when they
  are independently necessary and identified by neither the governing
  projection tuple nor an applicable directly cited boundary row;
- outputs, derived paths, and allowed overrides;
- mutation or side-effect owner;
- missing, invalid, failure, recovery, and cleanup behavior; and
- observable task-local verification conditions without restating proof
  allocation.

A valid `LIGHTWEIGHT` contract-heavy record consumes selected projection
entries for every actual known participant and independently necessary
execution relationship, owner/source, and proof allocation. It adds only
purpose, inputs and outputs, producer or consumer direction when independently
necessary and absent from both the projection tuple and an applicable directly
cited boundary row, material write or side-effect owner, failure and cleanup
behavior, focused verification expectations, and
the explicit reason all five eligibility dimensions are true. It does not
acquire the complete table merely because it has bounded, recoverable helper
I/O or filesystem effects. Add family
detail only for a concrete approved task-local need or an independently
applicable material authority.
Ambiguity defaults to `FULL`. Known omissions remain blocking, as does any
false eligibility dimension or independently applicable material authority.
Persistence, filesystem effects, artifact type, language, repository layout,
path, or implementation mechanism alone do not activate `FULL`.

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

For every changed behavior or contract in an approved design, select topology
detail from its contract tier. In an executable plan, the Execution Projection
is the single common mapping for the stable relationship and governing decision,
affected surface or equivalent set, normative owner/source and responsibility,
consumption mode, current task or no-code disposition, and proof owner/boundary.
Do not repeat those fields in a second topology table.

`FULL`, or a separately named material authority, requires that common mapping
to be exhaustive over every changed behavior and affected surface authorized by
the design. Represent each approved relationship once for an assigned task's
curated execution context. Carry independently necessary producer or consumer
direction in the projection tuple when it identifies that fact. Otherwise carry
it exactly once in the applicable directly cited boundary row, or in the
tier-specific task record when no distinct boundary row applies. Other
task-local structures consume that carrier without repeating it. Add an inverse producer, consumer,
or reference entry only when it adds a different owner/source, mode,
implementation disposition, proof boundary, or independently necessary
execution fact. When an approved relationship has supporting owners, add only
a supplement keyed by the governing projection Entry ID that names each
supporting owner, its explicitly
non-overlapping normative partition, and conflict precedence. The supplement
must not restate the projection tuple. A valid `LIGHTWEIGHT` compact record adds
only its independently necessary task-local purpose, inputs and outputs,
producer or consumer direction when absent from both the projection tuple and
an applicable directly cited boundary row, material write or side-effect owner,
failure and cleanup behavior, and explicit reason
all five eligibility dimensions are true; its selected projection entries supply the common
participant, relationship, owner, and proof facts. It need not manufacture
inverse entries, supporting owners, partitions, consumers, or example families
that do not exist.

Repetition never grants authority. References and non-normative summaries yield
to the normative owner on conflict; derived representations preserve owner
parity; verification reports mismatch without defining policy. Exact wording or
diagram-edge proof is required only when the representation itself is an
intentional product contract. Generated skill packages are derived consumers
and never plan edit targets. Known omissions remain blocking at every tier.
Any false eligibility dimension or independently applicable material authority
remains blocking and requires the applicable stronger treatment;
`LIGHTWEIGHT` never waives it. Persistence and filesystem effects alone do not
make a dimension false.

Planning is not ready at every tier when:

- multiple artifacts independently define the same requirement, state
  transition, routing rule, schema, lifecycle, or failure behavior without an
  approved partition;
- a reference or summary is treated as authority because it repeats contract
  detail;
- verification defines copied policy or expected prose instead of proving an
  owner invariant, reference validity, or derived parity; or
- a reviewer or implementer would have to choose ownership or precedence.

For `FULL` or a separately named material authority, planning is not ready when
a required exhaustive projection or Entry-ID-keyed topology supplement field is
missing, including when:

- a supporting responsibility overlaps another partition, leaves an approved
  responsibility uncovered, or lacks conflict precedence;
- a changed behavior, affected surface, owner source or responsibility,
  consumption mode, implementation disposition, proof owner/boundary, or
  independently necessary execution relationship is missing from its
  projection entry; or
- a derived representation lacks an owner or proportional parity proof.

A `LIGHTWEIGHT` mapping is not ready when its selected projection entries omit
an actual known participant, owner/source, proof allocation, or independently
necessary execution relationship, or when its compact task-local record omits
purpose, inputs and outputs, independently necessary producer or consumer
direction absent from both the projection tuple and an applicable directly
cited boundary row, material write or side-effect owner, failure and cleanup
behavior, focused verification expectations, or
an explicit statement that all five eligibility dimensions are true. An absent equivalent inverse
producer-consumer or reference entry alone is not an omission. Unclear tier
eligibility defaults to `FULL`; the compact route never excuses a known
consumer or an independently triggered obligation.

Missing, duplicated, or conflicting project-specific topology is a `BLOCKER`
returned to the owning design; planning must not repair it by inventing an
owner or partition. An approved `FULL` or separately authorized exhaustive
topology with incomplete or contradictory task coverage is a `CURRENT` planning
gap returned to `play-planning` during implementation review. An approved
`LIGHTWEIGHT` compact topology with an omitted actual known participant,
independently necessary execution relationship, or required compact field is
likewise a `CURRENT` planning gap. Neither route authorizes further synchronized
restatements.

Topology examples activate Contract Example Discipline only when that
discipline is already triggered by `FULL` or a separately named material
authority. Under that existing trigger, apply it to one canonical valid
post-change topology example. Representative invalid families change one
dimension at a time: duplicate the normative owner, overlap a supporting
partition, omit a consumer's owner source or mode, or treat verification as
policy authority. Keep derived facts consistent, require only the positive and
negative proof authorized by the design, and do not create an exhaustive
matrix. Merely expressing a valid `LIGHTWEIGHT` compact topology as an example
does not trigger canonical invalid families or positive and negative FULL
proof. Unsupported or inconsistent example facts are a `BLOCKER` returned to
the owning design or decision surface, not invitations to guess.

### Execution projection

Every executable plan contains exactly one literal Markdown H2
`## Execution Projection` outside fenced code, followed by the peer H2
`## Tasks` before any `### Task` heading. The peer heading terminates the
projection section. The ordering invariant is that any
`## Traceability Matrix` precedes `## Execution Projection`;
`## Execution Projection` is the final peer H2 before `## Tasks`, and only
projection entries occur between those two headings. The approved design owns
the project-specific truth; the
projection is its single plan-local representation of the common relationship
tuple. It does not create authority, execution order, task routes, proof actors,
retained evidence, or review state. The same entry shape applies to `FULL`,
`LIGHTWEIGHT`, and `NO-TRIGGER`; independently necessary tier-specific execution
fields remain mandatory exactly once in the tier-specific task context,
including an applicable directly cited boundary row, and are not copied into
this index.

The section contains one or more entries. Each entry contains exactly these six
fields and no renamed, duplicate, or additional projection-scoped metadata:

1. `Entry ID`: a unique, plan-local stable `UPPER-ASCII-KEBAB` token using the
   same identifier form as `Task ID`.
2. `Affected surface or equivalent set`: a nonempty JSON array of unique,
   nonempty strings. One member is a singleton surface; two or more members
   declare an equivalent set that shares the complete descriptive tuple. Array
   order has no semantic meaning, and uniqueness uses exact decoded-string
   equality.
3. `Owner/source`: the normative owner, the responsibility it defines, and the
   exact approved decision, contract, or relationship-specific authority
   locator.
4. `Mode`: exactly one of `authority`, `reference`, `derived representation`,
   `non-normative summary`, or `verification`.
5. `Implementation disposition`: either `Tasks [...]`, containing a nonempty,
   unordered, duplicate-free set of current stable Task IDs, or
   `No code — <task-specific reason>`.
6. `Proof`: exactly one `Task <TASK-ID> — <boundary>`,
   `Reviewer <existing responsibility> — <boundary>`, or
   `Controller <existing responsibility> — <boundary>` pair.

Every Task ID in `Tasks [...]` and every `Task <TASK-ID>` proof owner resolves
to exactly one current task in the plan. Reviewer and controller forms must name
an existing responsibility; no form can invent an actor, route, dependency, or
lifecycle. Task-set display order has no semantic meaning. Multiple checks owned
by the same proof actor belong in its one concrete boundary. Independently owned
proof responsibilities for different surfaces in one approved relationship use
separate entries with the same authority locator. A second independently owned
proof responsibility for the same relationship and semantic surface requires a
distinct approved relationship; planning must not invent one merely to
serialize another proof owner. A physical surface may occur in different
entries when it participates in different approved relationships,
distinguished by their exact authority locators.
Implementation disposition and task-valued proof ownership are the canonical
plan-local membership facts; they do not establish project authority or an
execution route. Entry IDs remain available for optional references from other
plan sections when that avoids restating the tuple. Tasks carry no required
Entry-ID field.

The projection represents each relationship once for the curated task context.
When independently necessary producer or consumer direction is not identified
by the projection tuple, carry it exactly once: the applicable directly cited
boundary row owns it, or the tier-specific task record owns it when no distinct
boundary row applies. Other task-local structures consume that carrier without
repeating it.
A reverse producer, consumer, or reference entry is required only when it
contributes a different owner/source, mode, implementation disposition, proof
boundary, or independently necessary execution fact. An equivalent inverse
relationship or duplicate proof allocation in a boundary record, task contract,
or traceability matrix is not required and must not be a review blocker.

Multiple affected surfaces may share one entry only when owner/source, mode,
implementation disposition, and proof are all equal. If any one differs,
split the entry. Reviewers may block a grouping that hides a semantic
difference or omits a required fact, but a preference for another table shape,
row order, or otherwise equivalent normalization is non-blocking.

D5 owns semantic completeness: it validates whether projection membership is
truthful and complete against approved design and task contracts. An omitted,
extra, or conflicting task membership; stale or unresolvable Entry ID; missing
authoritative owner; omitted execution-relevant participant; or absent
independently necessary execution relationship is a `CURRENT` planning gap.
D5 must not block solely because an equivalent inverse relationship or duplicate
proof allocation is absent. D6 may report the shared fact only when it
identifies the concrete task-local startability defect it causes.

The execution consumer performs structural resolution only. A missing or
duplicate canonical section, missing `## Tasks` terminator, task heading before
that terminator, alternate heading used in its place, second section purporting
to be a projection, fenced-only heading, unknown projection-scoped metadata,
or an Entry or Task ID that resolves to zero or multiple definitions blocks
before execution and returns to planning. For each task, the consumer
mechanically selects the entries whose explicit implementation disposition or
task-valued proof names that Task ID and appends only those entries to the
existing curated task context. It does not infer missing entries or semantic
applicability, validate whether membership or topology is truthful or
exhaustive, or route execution or review. Pre-projection plans are unsupported
and receive no compatibility bypass.

Example of a valid grouped entry:

```markdown
- **Entry ID:** `EP-1`
  - **Affected surface or equivalent set:** ["source-a", "source-b"]
  - **Owner/source:** `owner.md` — owns source-to-rendered parity under decision `REL-1`
  - **Mode:** `derived representation`
  - **Implementation disposition:** Tasks [`EDIT-SOURCES`]
  - **Proof:** Task `EDIT-SOURCES` — rendered parity
```

From this valid entry, changing only owner/source, mode, implementation
disposition, or proof for `source-b` requires a separate entry. Merely
reordering the same task set does not. Keeping two otherwise complete,
tuple-equal entries may invite a non-blocking compaction suggestion, but is not
by itself a semantic defect.

### Boundary-contract traceability

Every executable task carries each canonical record-reference field exactly
once:

```markdown
**Boundary rows:** ["BR-A", "BR-B"]
**Supporting-owner supplements:** ["EP-SUPPORTING-OWNERS"]
```

Each value is a JSON array containing zero or more unique, non-empty string
identifiers without line breaks. JSON whitespace and the order of unrelated
task fields are non-semantic. Missing or repeated fields, invalid JSON,
non-array values, non-string or empty entries, and duplicate identifiers are
structurally invalid. The declared field selects the lookup kind: boundary-row
IDs never resolve as supporting-owner supplements, and governing projection
Entry IDs listed for supplements never resolve as boundary rows.

Plan-level boundary records retain their existing stable non-empty,
no-line-break row IDs in their owning sections. Boundary-row IDs are
kind-scoped and do not inherit Task ID's `UPPER-ASCII-KEBAB` grammar. Each
supporting-owner supplement is keyed by exactly one governing projection Entry
ID, and tasks select that supplement with the same Entry ID; the existing Entry
ID form therefore applies. A prose mention or reference from the other record
kind does not substitute for the uniquely identified record. These identity
rules do not define a Markdown or record-body grammar; the controller
interprets the reviewed plan structure and D5 owns semantic completeness.

For producer, validator, adapter, or consumer boundaries, select traceability
detail from the contract tier. `FULL` or a separately named material authority
requires stable boundary row IDs and the complete participant-specific
traceability shape. Each row names its governing projection Entry ID, boundary
name and authoritative source, independently necessary required input tuple,
boundary-specific validator or policy authority, ordering and failure behavior,
and observable verification conditions. When producer or consumer direction is
an independently necessary execution fact that the projection tuple does not
identify, the row is its single task-local carrier and names that direction. The governing entry supplies the
shared affected-participant association and proof allocation; do not repeat
them in the row.

For `FULL` or a separately named material authority, downstream boundary-row
consumers reference the governing projection Entry IDs for task or no-code
disposition, common participant relationships, owner/source, and proof
allocation. Boundary rows add only participant-specific inputs, direction when
independently necessary and absent from the projection tuple, validation,
failure behavior, and observable
verification conditions not already present in the projection tuple. Task
checklists consume the selected projection and applicable boundary rows without
repeating either mapping. The execution consumer includes only the records
selected by the task's canonical fields. Each listed identifier resolves
exactly once within its declared record kind. Unknown, stale, ambiguous,
duplicate, and cross-kind identifiers fail closed. The consumer does not
discover inverse references, recursively follow another reference, infer
semantic applicability, or forward the complete plan to resolve references.
Plan Review fails a missing or malformed required field, an unresolvable or
ambiguous identifier within the named record kind, a missing governing Entry ID
when a distinct boundary record depends on it, or an independently necessary
boundary fact, but not a checklist merely because it declines to restate those
details or omit an equivalent inverse relationship.
Each governed row
cites the relevant design contract decision or records why that decision is
non-applicable. A no-code projection disposition names that governing decision
and explains why implementation work is unnecessary.

Directly cited boundary records may exclusively own independently necessary
participant-specific inputs, outputs, directions, derived destinations,
ordering, validation, failure behavior, and observable boundary conditions.
A consumer, output, destination, or direction already carried by an applicable
directly cited boundary record does not also become an Execution Projection
surface unless its projection-owned authority, common relationship, mode,
implementation membership, or proof ownership differs. Task contracts remain
the single carrier for task-local files, mutation authority, behavior,
dependencies, acceptance criteria, risks, and verification expectations.
Missing owners, participants, implementation membership, proof ownership, or execution facts remain blocking.

Boundary-carrier review examples:

- **Valid boundary-carried context:** a task's `Boundary rows` field selects
  `BR-DERIVED`. The governing projection entry owns the authoritative common
  relationship, mode, task membership, and proof. `BR-DERIVED` exclusively
  owns one participant's direction, inputs, derived output and destination,
  validation order, and failure behavior. The assembled context is complete;
  the participant-specific facts are not repeated as projection surfaces.
- **Invalid missing-participant mutation:** relative to that valid example,
  remove one required participant from both the projection relationship and
  the selected boundary record. The semantic omission remains blocking.
- **Invalid missing-authority mutation:** remove the normative owner/source
  from the governing projection entry while preserving the boundary facts. The
  boundary record does not replace projection authority, so the omission
  remains blocking.
- **Invalid missing-task-membership mutation:** remove the current Task ID from
  the governing entry's implementation disposition and proof. Boundary
  selection does not infer projection membership, so the omission remains
  blocking.
- **Invalid missing-proof mutation:** remove proof ownership from the governing
  entry while preserving the selected boundary record. Boundary facts do not
  replace projection proof allocation, so the omission remains blocking.
- **Valid representation-only mutation:** reorder the two canonical reference
  fields, change unrelated prose, or vary JSON whitespace without changing the
  decoded IDs or assembled semantic carriers. D5 does not block the equivalent
  representation, while the exact saved-plan digest still changes and requires
  a fresh paired review wave.

A valid `LIGHTWEIGHT` boundary record consumes the selected projection entries
for every actual known participant and independently necessary execution
relationship, owner/source, and proof allocation. It adds the closed compact
task-local purpose, inputs and outputs, producer or consumer direction when it
is independently necessary and not identified by the projection tuple,
material write or side-effect owner, failure and cleanup behavior, focused
verification expectations, and an explicit reason all five eligibility
dimensions are true.
It does not require an equivalent inverse producer-consumer or reference entry.
It is sufficient unless specifically authorized applicable extra detail is
required by a concrete approved task-local need or an independently applicable
material authority. Only that named detail applies; it does not activate the
complete downstream row-consumer shape. A final consumer test does not cover a
missing producer, validator, or adapter obligation, and it cannot excuse any
other known consumer omission. Ambiguity defaults to `FULL`. Known omissions,
false eligibility dimensions, and independently applicable material authority
remain blocking. Persistence or filesystem effects alone do not require
`FULL`.

Proof must be executable without prescribing implementation. Name diagnostic
shape, validation ordering, source inspection target or discovery criteria,
evidence location, terminal-state behavior, and forbidden-surface absence when
they are relevant. Phrases such as “stable diagnostic,” “source inspection,”
“rollback covered,” or “fail closed” are insufficient without an observable
condition.

### Contract Example Discipline

Contract Example Discipline is required for FULL or a separately named material
authority. Under either trigger, plans that change schemas, APIs, function
shapes, artifacts, CLI output, helper I/O, or cross-skill contracts include
`Contract Example Discipline` or an equivalent section. Name:

- one canonical valid post-change example and its authority;
- representative invalid families derived by changing one contract dimension;
- required positive and negative proof; and
- intentionally out-of-scope invalid families.

A valid `LIGHTWEIGHT` compact record does not require canonical valid and
invalid example families merely because its bounded, recoverable single-owner
mechanism has helper I/O. Its focused verification expectations cover its named compact
contract. A known
participant or independently necessary execution relationship still cannot be
omitted, and any false eligibility dimension or independently applicable
material authority remains blocking and requires the applicable stronger
treatment.

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
before `## Execution Projection`, never between that section and `## Tasks`.
Every requirement maps to current task coverage and acceptance criteria. The
matrix does not reallocate or repeat the Execution Projection's proof
allocation; task-local verification expectations and
minimum-sufficient proof show how that acceptance is demonstrated. Incidental
modal prose, examples, comments, or live evidence do not create additional hard
requirements. An uncovered hard requirement remains blocking.

## Task contract criteria

Every current task includes:

- purpose and completed goal;
- explicit non-goals;
- exact affected files or authoritative discovery criteria;
- source-of-truth references and authority surfaces;
- acceptance criteria;
- risks and dependencies;
- verification expectations; and
- tier-appropriate contract fields when a non-trivial trigger applies.

Non-trivial triggers include multi-step implementation, durable docs or policy,
cross-agent handoffs, schemas or interfaces, generated artifacts, state or
lifecycle behavior, fail-closed behavior, safety-sensitive behavior, and
compatibility or versioning. A trivial task may omit the checklist only with a
task-specific reason explaining why no contract fields are triggered.

For `FULL` or a separately named material authority, use the complete
non-trivial-task checklist. Selected projection entries cover the common
relationship tuple. The checklist adds trigger criteria, task-local mutation
authority, affected execution consumers or generated outputs not already
represented by that tuple, must-preserve behavior, required state and failure
behavior, applicable spec or procedure work, relevant risks, and task-local
verification expectations. Each field is populated or marked `N/A` with a
task-specific reason. Unknown authority becomes a BLOCKER, not an invented
contract.

Selected projection entries satisfy the relationship-level owner/source,
affected participation, implementation membership, and proof-allocation facts.
The task checklist remains the executable owner of task-local mutation
authority, required behavior, acceptance, and verification expectations; it
references or consumes the selected entries and does not restate their tuple.

A valid `LIGHTWEIGHT` task consumes its selected projection entries for every
actual known participant and independently necessary execution relationship,
normative owner/source, and proof allocation. Its closed compact task-local
fields add purpose, inputs and outputs, producer or consumer direction when
independently necessary and absent from both the projection tuple and an
applicable directly cited boundary row, material write or side-effect owner,
failure and cleanup behavior, focused verification
expectations, and the explicit reason all five eligibility dimensions are true. It does not
restate the projection tuple, duplicate an equivalent inverse relationship, or
acquire FULL-only checklist fields or `N/A` entries. Add checklist detail only
for a concrete approved task-local need or an independently applicable material
authority.

For `FULL` or a separately named material authority, include the complete
task-local operation map when needed to make approved boundary behavior
executable. It names current source, target surface, required inputs, optional
inputs, missing or empty behavior, outputs, errors, explicit write targets or
side-effect owner, validation-before-write or other validation-order
requirements, failure behavior, forbidden side effects, dirty or rollback
behavior, and required verification. A valid `LIGHTWEIGHT` boundary-touching
task satisfies common participation and relationship mapping through its
selected projection entries and adds only its closed compact task-local
operation facts. It does not acquire FULL-only operation-map detail unless a
concrete approved task-local need or an independently applicable material
authority requires it. It must not prescribe private implementation choices
discoverable from the named sources.

Across checklist and operation-map selection, ambiguity defaults to `FULL`.
Known omissions, false eligibility dimensions, and independently applicable
material authority remain blocking. Persistence and filesystem effects alone
do not require `FULL`.

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
foundation-producing tasks are not below `spec-only`. Only the task heading and
immediately following required `**Task ID:**` field are positional. The required
`**Boundary rows:**`, `**Supporting-owner supplements:**`, and
`**Contract tier:**` fields, optional `**Mode:** mechanical`, optional
review-routing hints, and `**Files:**` may otherwise be ordered without changing
the task's semantics.

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
item mappings. D5 owns ordinary defects in approved-scope coverage, normative
authority, boundary and consumer completeness, requirement traceability,
dependency intent, documentation impact, and proof proportionality. It does not
repeat task-local executability review or invent new requirements.

D5 also owns projection completeness, grouping materiality, semantic task
membership, and tier validation; tier-local facts remain in task contracts. It
rejects stale or unresolvable Entry IDs, missing authority, omitted
execution-relevant participants, missing task membership, and uncovered hard
requirements, but not an equivalent inverse relationship or duplicate proof
allocation absent from a secondary structure.

When the assembled execution context is semantically complete, a
representation-only wording or ordering difference is non-blocking. D5 does not
require repeated singular prose selectors, duplication of facts exclusively
and correctly carried by an applicable boundary record, or `FULL` treatment
solely because bounded recoverable output persists or uses the filesystem.
Missing owners, participants, implementation membership, proof ownership, or
execution facts remain blocking.

### Implementer Executability Review

Validate whether a competent non-senior implementer can begin after reading the
task and named sources without choosing missing product, policy, ownership,
side-effect, error, rollback, or guardrail semantics.

Do not require the plan to pre-resolve normal implementation choices, private
helper structure, concrete tests, fixtures, commands, or individual-reference
discovery inside already named in-scope consumers or boundaries when a named
authority or explicit discovery criterion governs that discovery. Determining
the in-scope consumers or boundary participants is not normal call-site
discovery. Ordinary omitted or missing consumer or boundary mapping coverage
and mapping-authority findings are D5-owned. D6 may report the shared fact only
by naming a concrete task-local startability defect caused in D6's own remit;
the shared fact alone does not transfer ordinary finding ownership. Do not
broaden the Scope Envelope or proof obligations. Apply minimum-sufficient
proof, and classify useful hardening as FOLLOW-UP or OPTIONAL. D6 owns ordinary
defects in task-local startability: named source and path validity, executable
dependency order, required I/O and failure behavior, mutation ownership,
cleanup safety, and implementer-visible acceptance proof. It does not reopen
D5's approved-scope or proportionality judgment.

D6 reports projection facts only for concrete task-local startability defects;
it does not reopen D5's plan-wide judgment or request an equivalent inverse
relationship or duplicate proof allocation.

The remits are orthogonal rather than successive approval levels. D5 may PASS
while D6 reports a material task-local execution gap, such as an invalid named
path that prevents the implementer from starting. Conversely, D6 must not block
on optional whole-plan infrastructure, a generalized harness, or other
hardening that lacks approved authority; classify it FOLLOW-UP or OPTIONAL.
Both reviewers still report genuine omissions in their own remits, and neither
PASS cures the other's material gap.

Both reviewers may inspect shared plan and source facts, but only the remit
owner originates an ordinary finding. A reviewer that discovers an ordinary
defect owned by the other remit leaves origination to that owner rather than
duplicating or reclassifying it. When shared facts create a cross-remit
contradiction, a reviewer may report only after explaining the concrete defect
the contradiction causes in that reporting reviewer's own remit; shared facts
alone do not transfer ordinary defect ownership.

### Orthogonal-review examples

- **Valid orthogonal result:** D5 returns PASS because approved scope,
  consumers, requirements, documentation impact, and proportional proof are
  complete. D6 returns a material `EXECUTION` gap because one task names an
  invalid source path and a competent implementer cannot start from the named
  inputs. The D6 gap states its own task-local blocker; D5 PASS does not cure it.
- **Invalid optional-hardening mutation:** relative to the valid orthogonal
  result, change only D6's gap from the invalid source path to a request for an
  optional whole-plan validation service. D6 must not block because that
  hardening has no approved authority.
- **Valid cross-remit contradiction:** D6 may inspect a shared requirement and
  report that its contradiction with a task-local write owner leaves mutation
  authority ambiguous for the implementer. The report explains that concrete
  D6 defect; it does not originate an ordinary D5 coverage finding.
