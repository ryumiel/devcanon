# Red Flags — `play-subagent-execution`

Behavioral signals that this skill is being violated.

**Never:**

- Start implementation on main/master branch without explicit user consent
- Skip reviews when the plan has 2+ tasks (single-task plans skip per-task review by design — see ADR-0007)
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (conflicts)
- Make per-task implementer subagent read the plan file (controller still curates and inlines the per-task text). The controller MAY accept the plan via a `Plan: <path>` reference from its caller (see § Inputs); the per-task boundary is what stays inlined. See [ADR-0013](../../../docs/adr/adr-0013-path-based-phase-artifact-handoff.md).
- Skip scene-setting context (subagent needs to understand where task fits)
- Ignore subagent questions (answer before letting them proceed)
- Move to next task while either review has open issues

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
