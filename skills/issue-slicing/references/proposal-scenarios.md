# Proposal-Origin Scenarios

Use these focused evaluator inputs to retest `issue-slicing` proposal-origin
judgment. They are not policy, a Markdown output template, or a generalized
harness. Evaluators receive the inputs only; the controller keeps expected
outcomes separate.

## Concrete Proposal

A user confirms a CSV export for visible, filtered, role-scoped rows. It has
`id`, `name`, and `status` columns; UTF-8 quoting; header-only output for zero
rows; an explicit error above 10,000 rows; and no partial download after a
failure. Current source and tests describe visibility behavior. No feature spec
or existing records-export artifact exists. `docs/specs/records.md` is the named
destination for the required behavior documentation.

## Missing Critical Requirement

Use the concrete proposal above, but remove the confirmed limit and failure
behavior. Ask for an executable issue draft without supplying a choice for that
behavior.

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
