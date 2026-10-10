# ADR-0039: Combine Planning Judgment and Reuse Preparation

## Status

Accepted. This is the active successor to
[ADR-0030](adr-0030-play-planning-readiness-and-parallel-digest-gates.md),
whose paired D5/D6 planning-gate decision is historical.

## Context

Correctness and implementer executability are distinct judgments, but need not
require two independent sessions for every plan version. Paired review repeats
preparation and source discovery even when a revision changes a bounded part of
a plan. Reducing sessions must preserve complete coverage, independent source
inspection, exact-byte approval and refusal of unresolved defects, including
complex work. No performance or quality equivalence is established by this
architectural choice.

## Decision

Select initial issue preparation by unresolved decisions, not size or passing
checks. When current accepted scope, source/consumer ownership, approach and
proof are fully specified and authorized, the issue controller writes one
Execution Note in the existing guarded design carrier and implements inline.
The note is local execution context and exact identity, never planning approval.
Unresolved behavior, interactions, custody, failure or proof receive needed
investigation and planning; explicit research requests remain honored.

For actual plans, retain closed readiness before drafting and exact-byte
SHA-256 identity. Replace
the two planning sessions with one independent reviewer responsible for both
remits. Require explicit complete coverage rather than inferring executability
from a correctness PASS. Permit one comprehensive initial review and at most
one further semantic pass per accepted scope. Focus correction on the full revision diff,
prior gaps and affected dependencies, carrying only proven unaffected coverage.
Material changes require comprehensive review within the same budget or an
explicit owning reassessment. Every genuine blocker prevents approval,
including a defect inspectable but missed during the initial review.

A final complete FAIL limited to an omitted declaration of a mapping explicitly
established by current accepted sources may receive fresh independent D5
verification-only assurance after the two semantic passes. It checks the full
diff, sources, gaps and complete current/carried coverage, binds corrected bytes
and preserves historical FAILs and consumed passes. New or uncertain mapping,
changed meaning/judgment/source, incomplete evidence and failed verification
stop under existing recovery; no automatic retries or budget resets result.
The planning owner defines this narrow exception. Producer and coupled consumers
validate explicit mode and composite provenance together; old PASS is never
transplanted onto new bytes.

Reuse source maps and scoped evidence in existing artifacts while inputs remain
valid. Independent judgment requires checking relevant authoritative sources,
not repeating discovery. Changed authority, source or candidate invalidates
dependent claims; uncertain impact requires broader refresh. D18 retains its
semantic-context responsibility. Final D7/D10 and implementation-internal
D14–D16 review remain outside this consolidation.

The [planning contract](../../skills/play-planning/references/combined-review-contract.md)
owns operational result, coverage, budget and compatibility semantics. The
[routing policy](../guidelines/agent-routing-and-mutation-policy.md#active-combined-planning-route)
owns the retained D5 tuple and D6 retirement. The
[workflow spec](../specs/afds-workflow-routing.md#planning-review-and-preparation-behavior)
owns observable requirements and evaluation limits.

Activate the planning producer and all coupled consumers together. Distinguish
combined review with explicit controller-local provenance; do not create a
persisted result registry or reinterpret legacy PASS results. Preserve separate
exact-digest user approval and all external authority gates. The note route
never enters plan-only helpers, mechanical/reduced executor routes or D5/auto
handoff contracts. Batch continuation distinguishes preparation kind and exact
identity in existing controller-local provenance. Both issue routes retain
source protection, candidate closure, full checks, independent final branch
review and exact publication authority; changed source invalidates later evidence.

## Consequences

- One reviewer must cover both failure families; incomplete coverage stops the
  workflow, rather than gaining a second full reviewer by default.
- A late missed defect still blocks. Fewer sessions do not guarantee fewer
  owner reassessments or faster elapsed time.
- Evidence reuse needs current input identity and honest coverage provenance.
  Lost provenance may require comprehensive re-review, not a reconstructed PASS.
- Current readiness, proportional planning and minimum-sufficient proof survive
  from the predecessor. Stable gap classification remains source-owned.
- Legacy in-flight plans need compatible paired consumers or explicit review
  under the replacement; intermediate mixed contracts are unsupported.
- No role, model default, cache, telemetry service or general framework is added.

## Alternatives considered

- Keep paired sessions and only deduplicate preparation: smaller migration,
  but retains two sessions for judgments one reviewer can explicitly cover.
- Merge remits without coverage evidence: simpler output, but makes omitted
  executability indistinguishable from approval.
- Repeat comprehensive review after every byte edit: preserves digest identity
  but needlessly discards proven unaffected coverage.
- Suppress late findings or approve at the round cap: hides genuine defects and
  weakens the acceptance boundary.
- Add a persistent context/result service: introduces custody and compatibility
  obligations beyond the existing artifact and controller-local mechanisms.
