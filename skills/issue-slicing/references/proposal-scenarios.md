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

## Confirmed Diagnostic Policy Change

All paths and behavior below are hypothetical evaluator inputs. An existing
helper at `src/checks/diagnostic-tail.ts` shows the final 10 lines of a failed
check's output by default and already accepts an explicit excerpt-length
override. `src/checks/diagnostic-tail.test.ts` verifies its current behavior.
The owning `docs/guidelines/check-diagnostics.md`, at `## Output Policy`,
documents the default and override precedence. That guideline is current
behavior evidence; its update is pending scope work.

The user confirms changing the default to 20 lines. Outputs of 20 lines or
fewer must appear in full; longer outputs must show their final 20 lines in
original order. An explicit override must continue to take precedence. Exit
status, sanitization, and the diagnostic source remain unchanged. The scope is
one default value, its existing tests, and the matching guideline paragraph.
Verification covers empty output, output below and at the new limit, output
above the limit, and an explicit override. No new command, configuration schema,
ownership boundary, security policy, migration, or cross-workflow contract is
involved. There is no separate approval, external dependency, or review-size
constraint. Request an issue draft delivering the confirmed helper behavior and
updating the documented diagnostic-output policy together.

## Existing Policy-Only Draft

Use Confirmed Diagnostic Policy Change unchanged. The user supplies an
unpublished draft titled "Revise diagnostic-output policy" whose scope and
acceptance criteria only change the guideline from 10 to 20 lines. It excludes
the helper default and tests as future work because the guideline is called
shared policy; it names no unresolved decision or other delivery constraint.
The user asks to revise this draft to deliver the confirmed working outcome,
including the helper behavior, documentation, and verification.

## Small Structural Proposal

Use Confirmed Diagnostic Policy Change, but replace its unchanged-sanitization
and no-security-policy statements with this requirement: the helper will show
previously redacted credential values to a new operator role. Whether that role
may see those values is a new, unresolved security-policy decision owned by
`docs/guidelines/diagnostic-access.md`. The user confirms that this decision
requires shaping first and requests a proposal draft identifying that owner.
The code edit remains one default value and one disclosure branch; no permission
to disclose credentials or implement before that decision is supplied.

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
