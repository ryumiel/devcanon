# Fix disposition execution

Use this reference only after the Branch Review Phase 3 workflow has selected
an eligible `--fix` route and read this file successfully. That workflow owns
candidate qualification, proportionality, grouping limits, hard stops,
reporting, the remaining-set envelope, and approval-summary order. Do not
reclassify a withheld candidate, select a route, or continue after a stop.

## Group and execute selected units

Make one same-invariant grouping pass over eligible critic-verified blockers.
Use only the existing finding text, evidence, anchors, classifications, and
active-diff context. When blockers share a root invariant, name it in the
report, inspect adjacent same-invariant active-diff surfaces, and form one
cohesive bounded group only when every included finding remains independently
eligible under the main workflow.

Make the separate fixable-nit grouping pass. Keep a proposed group ungrouped
when any member needs judgment, exceeds its 1-3 line bound, crosses a file or
scope, or triggers a stop. Do not add finding fields or change the authority of
individual anchors or classifications.

For each resulting unit, reapply the main workflow's hard-stop rule before any
edit. On a hit, halt immediately and leave later units unprocessed. For a
selected control-flow correction, retain the main workflow's fail-before
behavioral regression proof before the edit and require its pass-after proof;
this reference neither restates nor broadens that eligibility condition. Apply
the bounded fix for every selected unit. For a selected control-flow correction,
the pass-after proof must succeed before full validation and commit. Run
`pnpm run check` for TypeScript repositories (or the repository-defined
equivalent elsewhere), and commit it. A failed required proof or validation
halts without a commit. A committed grouped unit removes every included finding
from the final remaining set and never processes a member again. A resolved
fixable nit is likewise not a caller-owned mechanical-nit commit.

Before composing each commit, glob for `**/commit-guideline*.md` and follow the
found format. If none exists, use `fix(<scope>): <what was fixed>`. Every fixed
nit commit includes `Reported by branch-review at <path>:<line>` in its body;
a grouped nit commit includes one such line per fixed nit.
