# ADR-0007: Review Pipeline Delineation Between play-subagent-execution and branch-review

## Status

Accepted

## Context

The `github-issue-priming --auto` workflow chains two reviewers on the same diff:

1. `play-subagent-execution` (Phase 7) runs a per-task two-stage review
   (spec-compliance reviewer, then code-quality reviewer) on each task in the
   plan.
2. `branch-review --fix` (Phase 8) runs a whole-branch review (correctness,
   data-safety, dynamic language/architecture/docs agents, and a critic
   verification pass) on `git diff main...HEAD`.

For single-task plans -- the common case via `github-issue-priming` -- both
reviewers cover the same diff. They use different model floors
(`{{model:standard}}` per-task vs `{{model:deep}}` for branch-review), so they
can disagree. PR #106 (issue #99 post-mortem) is the surfacing example: the
per-task review approved a change that branch-review then flagged with three
blocking issues. The duplication burned tokens and produced contradictory
verdicts.

## Decision

When `play-subagent-execution` extracts a plan with exactly **one** task,
skip both per-task reviewers (spec-compliance and code-quality) for that
task. The implementer agent still runs and self-reviews. The skill's
existing final whole-implementation code-quality reviewer still runs after
the task completes (its scope is out of this ADR, see Consequences). When
invoked downstream by `github-issue-priming --auto`, `branch-review` then
performs whole-diff review on top of that.

For plans with **two or more** tasks, the existing per-task two-stage review
is preserved unchanged. Multi-task plans benefit uniquely from per-task
spec-compliance checking (catching drift before the next task uses the wrong
foundation), and that value is not replicated by an end-of-branch review.
The per-task spec-compliance and code-quality reviewers run at
`{{model:deep}}` (raised from `{{model:standard}}` to match the downstream
`branch-review` / `pr-review` floor), closing the per-task coverage gap
surfaced in PR #106 / issue #99. The same `code-quality-reviewer` agent is
also invoked at the end of `play-subagent-execution` for the whole
implementation regardless of plan size, so the floor raise applies to that
dispatch too — see Consequences for the cost rationale.

This change is internal to `play-subagent-execution`. The
`github-issue-priming --auto` Phase 7 → Phase 8 call sequence is unchanged.

## Consequences

- For the common single-task path through `github-issue-priming --auto`, the
  per-task spec and code-quality reviewer dispatches are eliminated. Token
  cost drops and the contradictory-verdict risk between the two pipelines is
  removed.
- The "final code-quality reviewer for entire implementation" step at the end
  of `play-subagent-execution` is **out of scope for this ADR** and remains
  unchanged. If that step should also be deduplicated against branch-review,
  it requires a separate ADR.
- When `play-subagent-execution` is invoked **outside** `--auto` on a
  single-task plan (no downstream branch-review), the implementer's own
  self-review is the only review before commit. This is an accepted
  trade-off: manual single-task invocations are rare, the implementer
  self-reviews, and the user can run `branch-review` directly. The
  alternative -- detecting the caller at runtime -- is not supported by the
  skill harness.
- The "Skip reviews (spec compliance OR code quality)" Red Flag in
  `play-subagent-execution` no longer flatly forbids skipping; it now
  forbids skipping when the plan has 2+ tasks.
- Future changes touching review-pipeline delineation must update this ADR
  per the ADR governance rule.
- Reviewer cost increases. For multi-task plans the per-task reviewers
  (spec-compliance and code-quality) run at `{{model:deep}}` instead of
  `{{model:standard}}`, bounded by N (number of tasks) × 2 reviewers.
  Additionally, the final whole-implementation code-quality reviewer at the
  end of `play-subagent-execution` (still out of scope for this ADR) shares
  the `code-quality-reviewer` agent and therefore also runs at
  `{{model:deep}}` on every plan, including single-task plans. The increased
  cost is justified by the same rationale as `pr-review` and `branch-review`:
  missing a real bug far outweighs the model cost.

## Alternatives considered

- **Option B -- arbitration logic.** Keep the per-task review but explicitly
  defer to branch-review's verdict on shared findings. Rejected because it
  adds runtime arbitration logic without removing token duplication; the
  redundancy still runs, and the design carries a new failure mode (drift
  between the two reviewers' finding schemas).
- **Option C -- raise per-task reviewer floor to `{{model:deep}}`.** Run
  both pipelines at the same model floor so they agree. Rejected as a
  complete solution to the single-task case: it fixes the disagreement
  symptom but leaves the duplication intact -- for N=1, both pipelines still
  review the same code, just at a higher floor, and the structural problem
  (two reviewers, same diff) is unaddressed. For multi-task plans the
  duplication argument does not apply (per-task and branch-review cover
  different scopes), so the per-task floor was raised to `{{model:deep}}`
  for them in this ADR (issue #110) -- see Decision.
- **Variant -- also drop multi-task per-task code-quality review.** Keep the
  per-task spec reviewer for N>1 plans, drop the per-task code-quality
  reviewer entirely. Rejected as undeclared scope expansion beyond what
  issue #108 asks ("pick A/B/C"); a future ADR can revisit if motivated.

## Related

- Issue: #108
- Surfacing PR / post-mortem: #106 / #99
