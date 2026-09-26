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

## Missing Critical Requirement

Use the concrete proposal above, but remove the confirmed no-partial-download
behavior after a failure while retaining the actionable error above 10,000 rows.
Ask for an executable issue draft without supplying a choice for that behavior.

## Unresolved Constraint Conflict

Use the concrete proposal above, but provide one current source constraint that
limits export to an administrator role and a conflicting request for all roles.
Do not confirm which constraint should govern.

## Existing-Spec Readiness Gap

Request slicing from a named existing behavior spec that has scope and a problem
statement but no acceptance criteria or verification expectations.

## Ready Existing-Spec Control

Request slicing from a named existing behavior spec with a clear owning pointer,
scope, boundaries, acceptance criteria, verification expectations, and evidence.
