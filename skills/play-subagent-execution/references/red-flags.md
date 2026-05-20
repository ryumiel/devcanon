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
- Make per-task implementer subagent read the plan file (controller still curates and inlines the per-task text). The controller MAY accept the plan via a `Plan: <path>` reference from its caller (see [SKILL.md § Inputs](../SKILL.md#inputs)); the per-task boundary is what stays inlined. Skip-dispatch (see [SKILL.md § Skip-Dispatch Path](../SKILL.md#skip-dispatch-path)) is the explicitly-gated exception: with no dispatched subagent, this Red Flag does not apply on that path.
- Skip scene-setting context (subagent needs to understand where task fits)
- Ignore subagent questions (answer before letting them proceed)
- Move to next task while an executor-required review has open issues
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
- Skip the quality rerun after a spec fixup unless irrelevance is proven;
  unclear staleness or irrelevance classification fails closed to rerunning code
  quality

**If subagent asks questions:**

- Answer clearly and completely
- Provide additional context if needed
- Don't rush them into implementation

**If reviewer finds issues:**

- Implementer (same subagent) fixes them
- Reviewer reviews again
- Repeat until approved
- Don't skip the re-review

**If subagent fails task:**

- Dispatch fix subagent with specific instructions
- Don't try to fix manually (context pollution)
