# Advantages — `play-subagent-execution`

Comparative notes on why this skill exists. Per-turn instruction lives in
`SKILL.md`; this file is rationale that the model loads on demand.

**vs. Manual execution:**

- Subagents follow TDD naturally
- Fresh context per task (no confusion)
- Serial-safe implementer isolation (fresh contexts without parallel implementer dispatch)
- Subagent can ask questions (before AND during work)

**vs. Executing Plans:**

- Same session (no handoff)
- Continuous progress (no waiting)
- Review checkpoints automatic

**Efficiency gains:**

- Controller rereads may be reduced through curated handoff and targeted
  snapshots on tasks whose controller-computed classification requests them;
  reviewers still read from disk
- Low-risk localized tasks can skip snapshot output and rely on default DONE
  fields plus controller-computed git/disk reads
- Controller curates exactly what context is needed
- Subagent gets complete information upfront
- Questions surfaced before work begins (not after)

**Quality gates:**

- Self-review catches issues before handoff
- Executor-owned risk-based review routing per task on multi-task plans:
  hard-risk and unclear tasks use same-head `spec-and-quality` review, where
  spec compliance and code quality may dispatch concurrently when practical and
  quality disposition is final only after same-head spec pass plus current-head
  validation. Medium-risk tasks may run `spec-only` and low-risk tasks may use
  `none-final-only` only on the verified shared
  `issue-priming-workflow --auto` Phase 6 path with controller-local parent
  state and a valid `issue-priming/auto-handoff/v1` artifact, where Phase 7 reruns
  `branch-review --fix` after any auto-fix or mechanical-nit commit until the
  final run reports zero blocking findings auto-fixed, no unresolved remaining
  `Blocking` findings except findings whose `critic` verdict is `INVALID` or
  `DOWNGRADE`, and no additional mechanical nit commits
- Single-task plans skip per-task reviewer dispatch and rely on the final
  code-quality reviewer plus direct/manual branch-level review status resolution,
  or downstream `branch-review --fix` on the `issue-priming-workflow --auto`
  path
- Review loops ensure fixes actually work
- Spec compliance prevents over/under-building
- Code quality ensures implementation is well-built
- Reduced review routes remain bounded by a mandatory final whole-diff gate whose final run is after any Phase 7 commits; unresolved remaining `Blocking` findings with any other critic value stop the workflow

**Cost:**

- More subagent invocations on hard-risk tasks (implementer + 2 reviewers per
  task), with reduced routes available for lower-risk work
- Controller does more prep work (extracting all tasks upfront)
- Review loops add iterations
- But catches issues early (cheaper than debugging later)
