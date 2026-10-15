# Slicing Scenarios

Use these focused evaluator inputs to exercise cohesion, dependency judgment,
simplification, and explicit batch requests. All artifacts, constraints, and
identifiers below are hypothetical input evidence, not claims about this repo.
Supply only the relevant scenario and its referenced baseline to the evaluator;
keep expected outcomes separate. Request drafts only, with no tracker mutation.

## Bounded Drill Specification

A user confirms one local voice drill using an approved training card already
available at `content/drills/first-card.yaml`. The accepted product intent in
`docs/product-requirements/local-drill.md`, at `## First Delivery`, is one brief,
one fixed clearance, learner readback, specific correction or clarification,
retry against the same issued values, and explicit completion. The current
`docs/specs/local-drill.md`, at `## Ownership`, fixes Host-owned evaluation and
ephemeral state, no simulator dispatch, and a fresh drill after disconnect.
Existing voice transport and Start/End behavior are available in
`src/voice/session.ts` and its lifecycle tests.

The user requests design work only: resolve the chosen card's accepted spoken
variations, response-evidence association, feedback/progression rules, and
interruption/recovery details together in `docs/specs/local-drill.md`. Those
answers are the deliverable, not confirmed implementation requirements. The
specification issue must preserve card provenance, define a complete interaction
and expected outcomes for correct, incorrect, incomplete, and unclear readbacks,
and include a lifecycle/acceptance matrix and implementation verification plan.
Verify the specification by walking the complete, retry, interruption, End, and
fresh-Start journeys against the existing lifecycle ownership and card values.
There is no external access constraint, separate approval requirement, or review
size constraint requiring separate design deliveries. Ask for a draft issue or
issues for this bounded specification outcome, without implementation work.

## One Issue Per PR

Use Bounded Drill Specification unchanged. Add a local contributor convention:
each issue must be delivered in its own PR. The user asks for a simple first
delivery and no speculative framework work.

## Inherited Discussion Chain

Use Bounded Drill Specification unchanged. The user supplies an unpublished
draft plan with three issue titles: select card, define evaluation, define
lifecycle. It proposes card → evaluation → lifecycle as blocking relationships.
Its only rationale is that content is discussed before evaluation and evaluation
before lifecycle. The card is already selected and accessible as in the baseline.
Ask to assess the boundaries and proposed dependencies and return revised drafts.

## Reduced Scope

Use Bounded Drill Specification unchanged. An earlier unpublished plan had four
issues: content catalog, grading engine, drill lifecycle, and capability registry.
The user now confirms only the one-card drill and its bounded deterministic
checks using existing voice lifecycle ownership. Catalogs, generic grading,
registries, persistence, and synchronization are excluded. Ask to simplify the
whole draft set while preserving the first drill's required design decisions
and evidence, with no live issue closures or relationship changes.

## Reusable Prerequisite

Two existing accepted specs, `docs/specs/imports.md#format-contract` and
`docs/specs/audit-reader.md#format-contract`, require a shared parser. Their
complete acceptance contract fixes UTF-8 input, required `id` and `timestamp`
fields, rejection of malformed or duplicate IDs with an actionable error, and
no partial results on failure. The import consumer displays valid records and
the audit consumer counts them; both use the same parser output and errors.
The parser's public API is already settled at `src/records/types.ts`; no new
contract decision remains. Current consumer fixtures live in
`src/imports/fixtures.ts` and `src/audit/fixtures.ts`.

The user requests a batch of implementation drafts. The parser is independently
testable and publishable as a shared module before either consumer integration;
each integration needs that landed module and separately demonstrates its
spec's result. Verification requires parser valid/malformed/duplicate/failure
tests and each consumer's integration test against those same fixtures.
Describe the boundaries and required predecessor outputs. There is no reason
for one consumer integration to block the other.

## Distinct Approval Constraint

Use Bounded Drill Specification unchanged except for this approval constraint:
a content custodian must review the adapted card and provenance before a
separate lifecycle approver may accept the complete drill specification. The
content review produces a versioned approved card and its permitted-use record;
the lifecycle approval consumes those exact outputs. The custodian can review
the content independently, and these are mandatory separate approval deliveries.
Both decisions are documented in `docs/guidelines/content-approval.md`.
Ask for design drafts accounting for this constraint. The specification remains
the same eventual owning file; do not infer consolidation from that file alone.

## Single Ready Issue

Use Ready Existing-Spec Control from
[proposal scenarios](proposal-scenarios.md#ready-existing-spec-control).
Ask for exactly one provider-neutral draft. No batch or dependency is requested.

## Explicit Independent Batch

Use Ready Existing-Spec Control from
[proposal scenarios](proposal-scenarios.md#ready-existing-spec-control) for a
records export. Also request a second, independent audit CSV export. Its named
owner `docs/specs/audit-export.md#csv-export-contract` fixes visible,
role-scoped audit rows in visible order, UTF-8 `id` and `timestamp` columns,
header-only empty output, an actionable error above 1,000 rows, and no partial
download on failure. Automated endpoint tests must verify each behavior.
`src/audit/visible-rows.ts` and its named row-selection tests establish current
selection constraints. Both specs are complete, and each export has independent
consumers and can ship without the other. Ask for two drafts in one response,
with no tracker fields, manifests, or live mutation.

## Batch With Blocked Work

Use Explicit Independent Batch, but remove only the audit export's verification
expectations. The audit owning path, scope, acceptance criteria, and current
evidence remain supplied. Ask for the same two drafts in one response. The
records-export input remains complete and independent.
