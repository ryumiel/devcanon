# Fix disposition execution

Use this reference only after the Branch Review Phase 3 workflow has selected
an eligible `--fix` route and read this file successfully. That workflow owns
candidate qualification, proportionality, grouping limits, hard stops,
reporting, the remaining-set envelope, and approval-summary order. Do not
reclassify a withheld candidate, select a route, or continue after a stop.

## Group and execute selected units

Make one same-invariant grouping pass over eligible blockers. Use only the
existing finding text, evidence, anchors, classifications, and active-diff
context. A selected claim retains its required critic verdict; an ordinary
claim retains `critic: null` and `not-required` verification. When blockers
share a root invariant, name it in the report, inspect adjacent same-invariant
active-diff surfaces, and form one cohesive bounded group only when every
included finding remains independently eligible under the main workflow.

Nits are report-only under v3 and do not enter this execution flow.

For each resulting unit, reapply the main workflow's hard-stop rule before any
edit. On a hit, halt immediately and leave later units unprocessed. For a
selected control-flow correction, retain the main workflow's fail-before
behavioral regression proof before the edit and require its pass-after proof;
this reference neither restates nor broadens that eligibility condition. Apply
the bounded fix for every selected unit. For an authorized behavior-preserving
compliance correction, retain the shared Writing Skills rule and current-source
violation proof before editing; inspect preservation of intended behavior and
public contracts, prove corrected-source rule compliance, and run appropriate
static analysis or typechecks and relevant existing behavioral tests. Do not
manufacture a runtime failure for typing-only work or satisfy the rule through
suppression or unsafe assertion. For a selected control-flow correction,
the pass-after proof must succeed before full validation and commit. Run
`pnpm run check` for TypeScript repositories (or the repository-defined
equivalent elsewhere), and commit it. A failed required proof or validation
halts without a commit. After a commit, validate and independently review the
changed candidate before selecting another fix unit. Resolution requires new
review evidence; do not subtract claims from the old-head artifact to approve
new source. Apply the owning workflow’s same-defect-family reassessment bound.

Before composing each commit, glob for `**/commit-guideline*.md` and follow the
found format. If none exists, use `fix(<scope>): <what was fixed>`.
