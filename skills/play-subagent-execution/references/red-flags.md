# Red Flags — `play-subagent-execution`

Behavioral signals that this skill is being violated.

**Never:**

- Start implementation on main/master branch without explicit user consent
- Skip or weaken the executor-computed review route. Hard-risk triggers force
  `spec-and-quality`; unclear classifications default to `spec-and-quality`;
  reduced routes require the verified shared `issue-priming-workflow --auto`
  Phase 6 path with controller-local parent state and a valid
  `issue-priming/auto-handoff/v1` artifact for the final whole-diff gate.
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (the workflow is serial by design; isolation is not authorization for concurrent implementer dispatch)
- Make per-task implementer subagent read the plan file (controller still curates and inlines the per-task text). The controller MAY accept the plan via a `Plan: <path>` reference from its caller (see [SKILL.md § Inputs](../SKILL.md#inputs)); the per-task boundary is what stays inlined. Skip-dispatch (see [skip-dispatch policy](skip-dispatch-policy.md)) is the explicitly-gated exception: with no dispatched subagent, this Red Flag does not apply on that path.
- Skip scene-setting context (subagent needs to understand where task fits)
- Ignore questions from a D12 implementer when they remain within
  judgment-bearing scope (answer before letting D12 proceed)
- Move to next task while an executor-required review has open issues
- Stop after an implementation summary, verification summary, or review pass
  report instead of returning to the verified owning caller or resolving
  branch-level review status on the direct/manual path. Those summaries are
  status reports only, not terminal workflow states; a review-required workflow
  must hand off to `branch-review` before `play-branch-finish`, use
  `branch-review --fix` only with owning-workflow authority or explicit
  operator confirmation for auto-committed fixes, and wait for review approval
  evidence or an explicit branch-review waiver before finish. A workflow
  without that requirement may invoke `play-branch-finish`.
- Treat plan-authored snapshot hints as authoritative. Snapshot request/skip
  classification belongs to `play-subagent-execution`; unclear cases request a
  snapshot.
- Treat a missing snapshot as valid after the controller requested one. Missing,
  unreadable, or malformed requested snapshots are lifecycle/report incidents
  even though the controller can fall back to default DONE fields plus its own
  git/disk reads.
- Treat absence of a snapshot as a violation when the controller skipped the
  snapshot request. No-snapshot DONE reports are valid when they include status,
  summary, tests, files changed, base SHA, and head SHA.
- Forward implementer-snapshot content into reviewer subagent prompts (the snapshot is for the controller's bookkeeping; reviewers read from disk to remain independent of the implementer's framing)
- Use implementer-snapshot content as an Edit-tool anchor after subsequent commits (the snapshot becomes stale once a fixup or nit-fix lands; re-read from disk before editing)

**Never (when the effective route includes per-task reviewers):**

- Accept "close enough" on spec compliance (spec reviewer found issues = not done)
- Skip review loops (reviewer found issues = implementer fixes = review again)
- Let implementer self-review replace an executor-required review
- Accept a code-quality result as final before same-head spec compliance passes
  and current task-head validation succeeds
- Treat advisory, stale, or superseded quality as final task approval
- Reuse either D14 or D15 result after any fix commit. Every fix commit
  invalidates both D14 and D15 results, including a previously passing or
  provisional result; both reviews must run fresh against the new same task
  head. There is no quality-irrelevance exception after a fix.

**If a D12 implementer asks questions:**

For D12 implementer questions within judgment-bearing scope, answer clearly,
provide needed context, and let D12 proceed. Do not rush D12 into
implementation before the question is resolved.

**If a D13 executor reaches an exact-task boundary:**

For a D13 executor, a clarifying question or `NEEDS_CONTEXT`/`BLOCKED` caused by
judgment, policy interpretation, missing authorization, or widened scope stops
D13 and reclassifies the task to D12. Do not answer and let D13 proceed,
redispatch D13, or use a more capable model for D13.

**If reviewer finds issues:**

- Implementer (same subagent) fixes them
- Reviewer reviews again
- Repeat until approved
- Don't skip the re-review

**If subagent fails task:**

- Dispatch fix subagent with specific instructions
- Don't try to fix manually (context pollution)
