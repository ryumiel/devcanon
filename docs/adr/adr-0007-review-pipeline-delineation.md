# ADR-0007: Review Pipeline Delineation Between play-subagent-execution and branch-review

## Status

Accepted

## Note

ADR-0016 later refines the `issue-priming-workflow --auto` single-task path
described here. The per-task-review skip decision in this ADR remains
authoritative, but statements below that the final whole-implementation
reviewer always runs on that caller-scoped path should now be read together
with ADR-0016.

ADR-0018 later refines the multi-task path described here. The multi-task
two-stage review policy remains the hard-risk and fail-closed route, but
multi-task tasks may use reduced per-task routes only under ADR-0018's
guarded, executor-owned routing conditions.

## Context

The `github-issue-priming --auto` workflow (and its sibling
`linear-issue-priming --auto`) hands off to `issue-priming-workflow`, which
chains two reviewers on the same diff:

1. `play-subagent-execution` (`issue-priming-workflow` Phase 6) runs a
   per-task two-stage review (spec-compliance reviewer, then code-quality
   reviewer) on each task in the plan.
2. `branch-review --fix` (`issue-priming-workflow` Phase 7) runs a
   whole-branch review (correctness, data-safety, dynamic
   language/architecture/docs agents, and a critic verification pass) on
   `git diff <base>...HEAD` where `<base>` is the repository's default
   branch.

For single-task plans -- the common case via `github-issue-priming` -- both
reviewers cover the same diff. They use different model floors
(`{{model:standard}}` per-task vs `{{model:deep}}` for branch-review), so they
can disagree. The surfacing failure mode was a per-task review approving a
change that branch-review later flagged with multiple blocking issues. The
duplication burned tokens and produced contradictory verdicts.

## Decision

When `play-subagent-execution` extracts a plan with exactly **one** task,
skip both per-task reviewers (spec-compliance and code-quality) for that
task. The implementer agent still runs and self-reviews. At the time this
ADR landed, the skill's final whole-implementation code-quality reviewer
still ran after the task completed. ADR-0016 later narrowed the
`issue-priming-workflow --auto` single-task path so that when downstream
`branch-review --fix` is explicitly guaranteed, that final reviewer is
skipped; outside that caller-scoped carve-out, the final reviewer still
runs.

For plans with **two or more** tasks, the per-task two-stage review
(spec-compliance, then code-quality) continues to run. Multi-task plans
benefit uniquely from per-task spec-compliance checking (catching drift
before the next task uses the wrong foundation), and that value is not
replicated by an end-of-branch review. The pipeline structure is unchanged;
the per-task reviewers' model tier is raised from `{{model:standard}}` to
`{{model:deep}}` to match the downstream `branch-review` / `pr-review`
floor, closing the per-task coverage gap surfaced by the contradictory-review
failure mode.
The same `code-quality-reviewer` agent is also invoked at the end of
`play-subagent-execution` for the whole implementation regardless of plan
size, so the floor raise applies to that dispatch too — see Consequences
for the cost rationale.

This change is internal to `play-subagent-execution`. The
`issue-priming-workflow` Phase 6 → Phase 7 call sequence (driven by
`github-issue-priming --auto` and `linear-issue-priming --auto`) is
unchanged.

## Consequences

- For the common single-task path through `github-issue-priming --auto`, the
  per-task spec and code-quality reviewer dispatches are eliminated. Token
  cost drops and the contradictory-verdict risk between the two pipelines is
  removed.
- The "final code-quality reviewer for entire implementation" step at the end
  of `play-subagent-execution` was **out of scope for this ADR** at the time
  it landed. ADR-0016 later narrows that step away only for the
  `issue-priming-workflow --auto` single-task path.
- When `play-subagent-execution` is invoked outside that caller-scoped
  `--auto` path on a single-task plan, the final whole-implementation
  reviewer remains the built-in review before commit, and operators may run
  `branch-review` manually for additional whole-diff coverage.
- The "Skip reviews (spec compliance OR code quality)" Red Flag in
  `play-subagent-execution` no longer flatly forbids skipping; it now
  forbids skipping when the plan has 2+ tasks.
- ADR-0015 introduces a further optimization within the single-task path: when
  three runtime guardrails (single-task plan, `**Mode:** mechanical`, no TDD
  step-pair markers) plus one upstream precondition (`play-planning`'s
  plan-review PASS) all hold, the implementer dispatch itself is also skipped —
  the controller executes Write/Edit + verify + commit inline. ADR-0016
  later narrows the `issue-priming-workflow --auto` single-task subset of
  that path further by skipping the final whole-implementation reviewer when
  downstream `branch-review --fix` is guaranteed.
- Future changes touching review-pipeline delineation must update this ADR
  per the ADR governance rule.
- Reviewer cost increases. For multi-task plans the per-task reviewers
  (spec-compliance and code-quality) run at `{{model:deep}}` instead of
  `{{model:standard}}`, bounded by N (number of tasks) × 2 reviewers.
  Additionally, the final whole-implementation code-quality reviewer at the
  end of `play-subagent-execution` shares the `code-quality-reviewer` agent
  and therefore runs at `{{model:deep}}` on every path except the
  caller-scoped single-task `issue-priming-workflow --auto` carve-out later
  introduced by ADR-0016. The increased cost on the remaining paths is
  justified by the same rationale as `pr-review` and `branch-review`:
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
  for them in this ADR -- see Decision.
- **Variant -- also drop multi-task per-task code-quality review.** Keep the
  per-task spec reviewer for N>1 plans, drop the per-task code-quality
  reviewer entirely. Rejected as undeclared scope expansion beyond what
  the decision request covered; a future ADR can revisit if motivated.

## Related

- Follow-up refinement: ADR-0016
- Follow-up refinement: ADR-0018
