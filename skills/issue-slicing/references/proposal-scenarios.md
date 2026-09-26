# Proposal-Origin Scenarios

Use these focused evaluator inputs to retest `issue-slicing` proposal-origin
judgment. They are not policy, a Markdown output template, or a generalized
harness. Evaluators receive the inputs only; the controller keeps expected
outcomes separate.

## Concrete Proposal

All identifiers below are explicitly hypothetical evaluator inputs, not
references to this repository. A user confirms a CSV export for visible,
filtered, role-scoped rows in their visible order. It has `id`, `name`, and
`status` columns; UTF-8 quoting; header-only output for zero rows; an actionable
error above 10,000 rows; and no partial download after a failure. Current
behavior evidence is
`src/records/visible-rows.ts` and
`src/records/visible-rows.test.ts`, which describe the visible-row constraint.
No feature spec or existing records-export artifact exists.
`docs/specs/records.md` is the named destination for required behavior
documentation and is pending scope work, not accepted evidence. Request only a
draft issue body; do not request implementation or tracker publication.
The draft must include an automated acceptance-verification expectation covering
the confirmed export behavior: visible filtered role-scoped rows in visible
order, the three columns and UTF-8 quoting, header-only empty output, and both
the over-limit error and no-partial-download failure behavior.

## Confirmed Existing-Feature Behavior Change

All paths and identifiers in this scenario are hypothetical evaluator inputs.
Retain the concrete proposal's confirmed export behavior, scope, boundaries,
acceptance criteria, automated verification expectation, current source and
test evidence. This replaces the concrete proposal's no-spec and pending-
destination state: an existing `docs/specs/records.md` currently governs the CSV
export with the visible-row constraint and is current evidence for that behavior.
Updating that spec for the proposed export change is pending scope work, not
accepted evidence. A user additionally confirms that the export must include a
`created_at` column and explicitly preserve that constraint. Request a proposal
draft for this new behavior-change intent; it must make the current constraint
and confirmed column change visible. The proposed column change is not already
accepted content in the current spec. Its automated verification expectation now
covers the four `id`, `name`, `status`, and `created_at` columns. This request is
not a request to slice the existing spec.

## Structural Proposal With Pending Shaping

All paths and identifiers in this scenario are hypothetical evaluator inputs.
Retain the concrete proposal's confirmed export behavior, scope, boundaries,
acceptance criteria, automated verification expectation, current source and
test evidence, and pending documentation destination. A user additionally
confirms that the records export requires a new cross-product access contract.
The requested draft identifies `docs/adr/records-export-access.md` as the owning
artifact to shape and names that contract decision as a prerequisite. Request a
proposal draft that records the concrete proposal and pending prerequisite only;
do not request an implementation slice or a narrow hybrid that combines the
broad contract shaping with implementation.

## Missing Critical Requirement

Use the concrete proposal above, but remove the confirmed no-partial-download
behavior after a failure while retaining the actionable error above 10,000 rows.
Remove no-partial-download from the automated verification expectation as well.
Ask for an executable issue draft without supplying a choice for that behavior.

## Unresolved Constraint Conflict

Use the concrete proposal above, but provide one current source constraint that
limits export to an administrator role and a conflicting request for all roles.
Do not confirm which constraint should govern.

## Existing-Spec Readiness Gap

Request slicing from a named existing behavior spec that has a problem
statement, scope, boundaries, acceptance criteria, and evidence but no
verification expectations.

## Ready Existing-Spec Control

Request slicing from a named existing behavior spec with a clear owning pointer,
scope, boundaries, acceptance criteria, verification expectations, and evidence.
