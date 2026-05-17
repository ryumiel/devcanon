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

- Controller rereads may be reduced through curated handoff and valid snapshots; reviewers still read from disk
- Controller curates exactly what context is needed
- Subagent gets complete information upfront
- Questions surfaced before work begins (not after)

**Quality gates:**

- Self-review catches issues before handoff
- Executor-owned risk-based review routing per task on multi-task plans:
  hard-risk and unclear tasks run two-stage review (spec compliance, then
  code quality), medium-risk tasks may run `spec-only`, and low-risk tasks may
  use `none-final-only` when the final whole-diff review guarantee is present
- Single-task plans rely on either the final code-quality reviewer
  (direct/manual) or downstream `branch-review --fix` on the
  `issue-priming-workflow --auto` path
- Review loops ensure fixes actually work
- Spec compliance prevents over/under-building
- Code quality ensures implementation is well-built
- Reduced review routes remain bounded by final whole-diff review with no
  remaining `Blocking` findings

**Cost:**

- More subagent invocations on hard-risk tasks (implementer + 2 reviewers per
  task), with reduced routes available for lower-risk work
- Controller does more prep work (extracting all tasks upfront)
- Review loops add iterations
- But catches issues early (cheaper than debugging later)
