# Combined Planning Review Contract

Status: active. This reference is the planning owner's complete D5 contract;
it replaces the retired paired D5/D6 gate. Rationale belongs to
[ADR-0039](../../../docs/adr/adr-0039-combined-planning-review.md).

## Ownership and retained requirements

`play-planning` owns authoring, preflight, result validation, revision and
handoff. Its independent reviewer owns the judgment of both remits below.
The [routing policy](../../../docs/guidelines/agent-routing-and-mutation-policy.md)
owns dispatch tuples. Accepted project/design authority owns behavior and scope;
planning may decompose it but cannot create missing authority.

Keep the current readiness audit, Scope Envelope/Delta, stable task and gap
identities, closed gap classes and precedence, proportional tiers, execution
projection, traceability and minimum-sufficient proof. This change removes
repeated review sessions, not independently necessary execution facts. An
applicable source or boundary reference can carry a fact once; no inverse edge,
duplicate proof or speculative FULL contract is required merely for appearance.

## Combined remit

One independent D5 reviewer must cover both dimensions for the complete plan,
including complex multi-boundary work:

| Dimension     | Required judgment                                                                                                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness   | Accepted intent and scope, requirement and Contract Decision coverage, unjustified tasks, normative owners, affected producers/consumers, boundary and projection completeness, semantic task membership, proportional tiers, dependency intent, documentation impact and sufficient proportional proof. |
| Executability | Each task is startable by a competent non-senior implementer using its named sources: paths and inputs, executable dependency order, required I/O and failure behavior, mutation ownership, cleanup/rollback safety and implementer-visible acceptance proof.                                            |

The reviewer can originate a gap from either dimension. Preserve the current
`CURRENT`/`BLOCKER` distinction and required gap fields; both prevent PASS.
`FOLLOW-UP`/`OPTIONAL` feedback remains nonblocking and does not force another
session. Normal implementation choices do not become missing policy decisions.

Coverage must name `PLAN` and every stable Task ID, identify the applicable
dimension(s), inspected authoritative source references, and the judgment.
A dimension may be inapplicable to an individual row only with a concrete
reason; neither dimension may be omitted from the complete plan. Missing,
contradictory or incomplete coverage is non-passing, including context
exhaustion. Prepared summaries are untrusted navigation aids: the reviewer
independently reads the relevant authoritative sources and may challenge them.

## Review identity and result

Use the existing controller-local result custody; add no persisted review
artifact or schema registry. The exact contract tag is
`planning-review/combined-v1`. A valid response starts with these two lines:

```text
PASS — digest=<sha256>
Planning review contract: planning-review/combined-v1
```

Replace `PASS` with `FAIL` for a complete review containing any `CURRENT` or
`BLOCKER` gap. The digest remains lowercase 64-hex SHA-256 of the exact saved
plan bytes, without normalization. The reviewer computes it independently and
compares the expected digest before responding. Missing input, unsupported
contract, unavailable reviewer, malformed response, guard failure or incomplete
coverage produces no valid PASS or handoff; retain a concise failure reason.
Do not represent an incomplete review as complete FAIL coverage.

After those lines, include `## Coverage` and, for FAIL, `## Gaps` with every
concrete in-remit gap under the existing gap contract. Nonblocking observations
may follow separately. Each coverage row records task/PLAN identity, dimension,
source references, judgment, and evidence origin. Initial coverage is
`rechecked`. Correction coverage is either `rechecked` or `carried-forward`.
Carried coverage references the exact prior result by retained session identity,
contract tag, digest and row identity, with the reason it remains applicable.
These are controller-local evidence references, not public artifact paths.

Capture source-immutability before each fresh response-only dispatch, verify
before interpreting it, retain validated results, and complete exact cleanup
before integration. Source mutation or cleanup failure is terminal under the
existing guard owner. The controller rehashes after cleanup and immediately
before handoff. Any mismatch or intervening edit invalidates approval.

## Budget and correction coverage

The accepted scope is the approved Scope Envelope together with its governing
project/design authority. The controller retains that identity, original plan
bytes, validated result, stable gaps, input provenance and number of dispatched
semantic passes. One comprehensive initial semantic pass and at most one
additional semantic pass are allowed. A dispatched failed, unavailable or
incomplete semantic attempt consumes its pass and stops automatic continuation; no retry chain is introduced. A
pre-dispatch validation failure consumes no pass but blocks dispatch until fixed.
Existing slot-recovery rules remain separate and cannot manufacture a result.

For an initial complete FAIL containing only correctable `CURRENT` gaps, the
owner may revise within accepted authority and use the remaining pass. A
`BLOCKER` returns to its named decision owner before revision or continuation.
For an initial PASS, leaving nonblocking feedback deferred requires no further
review. Any later edit, including a nit edit, invalidates that approval and
requires the remaining pass or reassessment.

Before correction, the controller compares the complete exact-byte plan diff,
all prior gaps and relevant input changes. It supplies that evidence and the
validated prior result to a fresh independent reviewer. The reviewer verifies
prior corrections, the full diff, affected dependencies and invariants, and
coverage applicability. Every current plan row must be rechecked or have valid
carried coverage. A prior FAIL can supply unaffected coverage but never approval.
Unknown impact or unavailable original bytes/provenance forbids focused carry;
use comprehensive review within the remaining pass or stop for reassessment.

Any genuine blocker prevents PASS, including a pre-existing inspectable defect
missed initially and first found during correction or comprehensive re-review.
Report it honestly as missed initially; finding-admission rules cannot suppress
it. If it remains after the final semantic pass, stop for reassessment unless the
source-established declaration exception below applies. Renaming tasks,
findings, sessions, files or contracts never replenishes the budget. A correction
made after the final PASS invalidates that PASS; it cannot be approved without
an explicitly reopened review cycle.

## Source-established declaration verification

The planning producer may correct an omitted governing-entry declaration after
a final complete mapping-only FAIL, including when both semantic passes are
consumed, only under this exception. The current accepted issue/design sources
must explicitly establish the exact mapping and the complete prior review must
leave only that declaration omission unresolved. Unchanged task wording and a
producer assertion of nonmateriality are insufficient. No new requirement or
mapping, changed tasks, dependencies, normative ownership, design, permissions,
proof obligations, acceptance criteria or reviewer judgment qualifies. Ambiguous,
conflicting or uncertain meaning remains semantic work under the budget above.
This exception does not cover edits after a final PASS.

Before writing, retain original plan bytes and digest, every complete prior
result and gap, consumed semantic passes, accepted source identities and the
repository/root/base/head/dirty-state identity. Retain complete PLAN/task
correctness and executability coverage with exact prior session identity,
contract tag, digest and row identity. Missing, stale, contradictory or incomplete
inputs stop; do not invent coverage or repair history. The producer applies only
the source-established declaration correction and supplies the complete exact
original/current diff, all gaps, relevant input changes and current mapping
sources. A consumer cannot make this correction on the producer's behalf.

Run canonical path/projection/digest preflight, then dispatch one fresh independent
D5 using the existing source-immutable, external-none, response-only tuple and
guard lifecycle. Set its purpose to verification-only; retain the consumed
semantic history rather than assigning a third semantic review wave. D5 reads
the authoritative mapping sources independently, checks the full diff and all
gaps, and validates applicability of every retained coverage row to current
sources and bytes. Every PLAN/task dimension must have current rechecked or
justified carried evidence. This is complete current assurance, not a new
semantic judgment or an old FAIL promoted to approval.

A successful response uses the existing PASS/digest and combined-v1 lines,
followed by `Review mode: verification-only`, complete `## Coverage`, and exact
carried provenance. It binds corrected bytes without consuming a semantic pass.
Verify the guard before interpreting the response, retain the validated current
result together with every historical result/digest/gap and the unchanged
semantic-pass count, complete exact cleanup, and rehash before handoff.

Failed, incomplete, unavailable, malformed or uncertain verification stops
local automatic continuation at the existing exhausted recovery/reassessment
route. No automatic redispatch, repeated no-progress submission, semantic-budget
reset, relabeling of historical FAILs or reopened cycle is authorized. Source or
candidate drift invalidates dependent evidence. Other edits use ordinary review
or reassessment. Nonblocking observations may remain separate and deferred.

## Material changes and reassessment

A change is material if it changes accepted behavior/outcomes; authority,
permissions or ownership; architecture/boundary participants or interaction;
the set of affected producers or consumers; or acceptance/verification strategy
or sufficiency. Wording, ordering and normal implementation-detail changes are
nonmaterial only when none of those facts changes. Uncertain materiality is
material. The planning controller records the comparison to the named owning
sources; a reviewer may reject an unjustified nonmaterial classification.

Material change requires comprehensive review, not focused carry, within the
remaining pass. First obtain any missing project/design/policy owner decision;
review cannot authorize the change. If no pass remains, or coverage cannot fit,
stop. At reassessment retain scope, digests, consumed passes, unresolved gaps,
failed coverage and exactly one decision owner per unresolved decision.

Only the user acting for the relevant owner, or an explicitly authorized owning
workflow with authority over that decision, can reopen a cycle. The decision
must resolve or reframe the blockers, name the accepted revised scope and
sources, justify reopening, and explicitly authorize a new bounded cycle. A
materially revised scope alone is insufficient. An unchanged-scope reopening
must explicitly acknowledge exhausted/failed review and its remedy. `--auto`,
renaming, a new session or repeated prompting is not such a decision. Retain
prior outcomes; do not erase them or claim historical results cover new bytes.
Each authorized new cycle again has at most two semantic passes; it is not an automatic
continuation loop. Readiness is rechecked before drafting its revised plan.

## Exceptional specialist

The planning controller may request at most one focused specialist per accepted
scope only for a concrete consequential disputed claim or knowledge gap that
combined review cannot resolve. Use the existing D4 owner to validate an
accepted source-immutable, external-none, response-only route, full configured
tuple, bounded question, inputs, output and termination before dispatch. No
new route, model override, capability escalation or full second plan review is
created. Missing authority or unsupported route stops the request.

A specialist supplies evidence, not PASS or scope authority. It neither resets
nor adds a planning pass. Any resulting plan correction still needs the
remaining D5 pass; with none remaining return to reassessment. An unavailable
specialist leaves the affected decision unresolved. Do not borrow final-review
D10 as a planning route.

## Handoff and compatibility

This contract applies to actual plans. Issue priming may instead select its
Execution Note route for settled work; that note is consumed inline by the
issue owner, never as a plan or combined PASS. No review notices, contract tag,
reviewed tier or auto-handoff are synthesized for a note. Existing planned
consumers and the review budget remain unchanged.

After a valid current combined PASS, retain producer identity, contract tag,
plan path, digest, coverage and successful cleanup in controller-local state.
For verification-only assurance, also retain explicit mode, full current/carried
coverage provenance, original/current identities, historical semantic results
and consumed passes. Consumers validate that composite evidence against the
source-established declaration rule above; a historical PASS cannot authorize
changed bytes. Rehash immediately before consumption. Unsupported or stale
composite evidence stops without downgrade.
Emit the existing `Plan written to <path>.` and `Reviewed digest: <sha256>`
notices, followed by `Planning review contract: planning-review/combined-v1`.
Consumers receive that exact tag alongside `Plan:` and `Expected digest:`.
The notices and tag are not bearer tokens: validate producer provenance and
current bytes before consumption. Missing, unsupported, mixed or stale reviewed
provenance stops a reviewed route; do not downgrade it to unreviewed execution.

There is no implicit conversion from legacy paired results. An in-flight legacy
plan can continue only with its complete valid dual PASS and compatible old
producer/consumer bundle. A migrated consumer requires combined-v1 and explicit
re-review under it. If a supported resume cannot recover provenance, rebuild
current preparation and obtain an explicitly authorized comprehensive review
cycle; do not reconstruct approval from a summary or historical digest alone.

The existing auto-handoff v1 schema remains unchanged because it records
parent/head/Phase 7 guarantees, not planning approval. Planning provenance is a
separate mandatory check in the auto parent and executor, before reduced-route
eligibility. Invalid auto-route evidence retains its current `spec-and-quality`
fallback only after valid planning assurance; it cannot cure invalid planning.
Direct unreviewed executor input retains its existing FULL structural route,
without claiming combined assurance or mechanical eligibility from this tag.

`review-response-parent-owned` requires the same current combined evidence
before the parent applies its separate Plan Approval Gate to the exact reviewed
digest. The producer supplies reviewed bytes and provenance; it does not decide
whether explicit current-session authority already satisfies that gate for an
eligible behavior-preserving compliance or necessary-completion correction
covering the entire plan and every affected responsibility. Necessary
completion requires its causal link, violated approved contract, necessity,
design-determined result, and exact authority before mutation. The parent
retains all separate execution proof and review gates.
The parent owns that limited decision and rehashes immediately before execution.
Any changed bytes require current assurance under this contract (semantic
review within budget or the qualifying verification-only exception) and a new
parent authority assessment; prior approval cannot cover new bytes, and the human approval loop
has no automatic cycle-reset effect. Preserve mechanical
execution's independent eligibility/guardrails and D14–D16. All producer and
consumer changes must activate together; no intermediate one-PASS/two-PASS mix
is supported.
