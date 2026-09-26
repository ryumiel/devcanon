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
draft issue body; do not request implementation or tracker publication. This is
a narrow change. The confirmed requirements include automated verification of
visible filtered role-scoped rows in visible order, the three columns and UTF-8
quoting, header-only empty output, and both the over-limit error and
no-partial-download failure behavior.

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
draft for this new behavior-change intent. The proposed column change is not
already accepted content in the current spec. The required automated
verification covers the four `id`, `name`, `status`, and `created_at` columns.
This request is not a request to slice the existing spec.

## Structural Proposal With Pending Shaping

All paths and identifiers in this scenario are hypothetical evaluator inputs.
Retain the concrete proposal's confirmed export behavior, scope, boundaries,
acceptance criteria, automated verification expectation, current source and
test evidence, and pending documentation destination. A user additionally
confirms that the records export requires a new cross-product access contract.
The requested draft identifies `docs/adr/records-export-access.md` as the owning
artifact to shape and names that contract decision as a prerequisite. Request a
proposal draft; do not request implementation or tracker publication.

## Broad Nonstructural Proposal

All paths and identifiers in this scenario are hypothetical evaluator inputs.
Current behavior evidence is `src/records/visible-rows.ts` and
`src/records/visible-rows.test.ts`, which establish the visible filtered,
role-scoped row constraint. A user confirms the complete CSV behavior from the
concrete proposal for twelve export categories: accounts, contacts, invoices,
payments, subscriptions, refunds, products, orders, shipments, returns, quotes,
and credits. Every category exports visible filtered role-scoped rows in visible
order with `id`, `name`, and `status` columns and UTF-8 quoting; an empty result
is header-only; more than 10,000 rows returns an actionable error; and a failed
export produces no partial download. The confirmed requirements include
automated verification for the full CSV behavior in every category. No existing
records-export behavior document exists. `docs/specs/records.md` is the named
destination for its required creation and is pending scope work, not accepted
evidence. The user explicitly describes the twelve-category scope as large. No
architectural decision, contract boundary, schema migration, security policy, or
broad workflow shaping is involved. Request one draft that combines
implementation with the pending documentation creation; do not request tracker
publication.

## Missing Critical Requirement

Use the concrete proposal above, but remove the confirmed no-partial-download
behavior after a failure while retaining the actionable error above 10,000 rows.
Remove no-partial-download from the automated verification expectation as well.
Ask for an executable issue draft without supplying a choice for that behavior.

## Unresolved Constraint Conflict

Use the concrete proposal above, but provide one current source constraint that
limits export to an administrator role and a conflicting request for all roles.
Do not confirm which constraint should govern.

## Ready Existing-Spec Control

All paths and identifiers in this scenario are hypothetical evaluator inputs.
Request slicing from `docs/specs/records-export.md` at the `## CSV Export
Contract` heading. That owned behavior spec states that visible, filtered,
role-scoped rows are exported in visible order with `id`, `name`, and `status`
columns and UTF-8 quoting; an empty result is header-only; more than 10,000 rows
returns an actionable error; and a failed export produces no partial download.
Its scope is the records export endpoint, and its boundaries exclude hidden rows
and exports for rows outside the caller's role scope. Its acceptance criteria
require those row-selection, CSV, empty-result, over-limit, and failure
behaviors. Its verification expectations require automated endpoint tests for
each acceptance criterion, including the no-partial-download failure case. Its
evidence is `src/records/visible-rows.ts` and
`src/records/visible-rows.test.ts`, which establish the current visible-row
constraint.

## Missing Verification From Ready Existing-Spec Control

Use the Ready Existing-Spec Control unchanged, but remove only its verification
expectations. The owning path and heading, behavior, scope, boundaries,
acceptance criteria, and evidence remain present.
