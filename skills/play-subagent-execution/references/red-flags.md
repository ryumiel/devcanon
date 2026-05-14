# Red Flags — `play-subagent-execution`

Behavioral signals that this skill is being violated.

**Never:**

- Start implementation on main/master branch without explicit user consent
- Skip reviews when the plan has 2+ tasks (single-task plans skip per-task review by design)
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (the workflow is serial by design; isolation is not authorization for concurrent implementer dispatch)
- Make per-task implementer subagent read the plan file (controller still curates and inlines the per-task text). The controller MAY accept the plan via a `Plan: <path>` reference from its caller (see [SKILL.md § Inputs](../SKILL.md#inputs)); the per-task boundary is what stays inlined. Skip-dispatch (see [SKILL.md § Skip-Dispatch Path](../SKILL.md#skip-dispatch-path)) is the explicitly-gated exception: with no dispatched subagent, this Red Flag does not apply on that path.
- Skip scene-setting context (subagent needs to understand where task fits)
- Ignore subagent questions (answer before letting them proceed)
- Move to next task while either review has open issues
- Forward implementer-snapshot content into reviewer subagent prompts (the snapshot is for the controller's bookkeeping; reviewers read from disk to remain independent of the implementer's framing)
- Use implementer-snapshot content as an Edit-tool anchor after subsequent commits (the snapshot becomes stale once a fixup or nit-fix lands; re-read from disk before editing)

**Never (when per-task reviewers run — multi-task plans only):**

- Accept "close enough" on spec compliance (spec reviewer found issues = not done)
- Skip review loops (reviewer found issues = implementer fixes = review again)
- Let implementer self-review replace actual review (both are needed)
- **Start code quality review before spec compliance is ✅** (wrong order)

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
