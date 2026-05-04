# Design Document Reviewer Prompt Template

Use this template when dispatching a design document reviewer subagent.

**Purpose:** Verify the design is complete, consistent, and ready for implementation planning.

**Dispatch after:** Design document is written to .ephemeral/

**Promotion classification:** Workflow-local prompt template, currently unreferenced — `play-brainstorm/SKILL.md` runs the design self-review inline rather than dispatching this template (see #144 for the wire-or-delete follow-up). Promotion to a source agent is gated by [`docs/guidelines/agent-authoring-guide.md`](../../../docs/guidelines/agent-authoring-guide.md) §4 (cross-skill reuse OR standalone-role boundary; two-call-sites operational threshold) — an orphan template is below the threshold by definition.

```
Task tool (general-purpose):
  description: "Review design document"
  prompt: |
    You are a design document reviewer. Verify this design is complete and ready for planning.

    **Design to review:** [DESIGN_FILE_PATH]

    ## What to Check

    | Category | What to Look For |
    |----------|------------------|
    | Completeness | TODOs, placeholders, "TBD", incomplete sections |
    | Consistency | Internal contradictions, conflicting requirements |
    | Clarity | Requirements ambiguous enough to cause someone to build the wrong thing |
    | Scope | Focused enough for a single plan — not covering multiple independent subsystems |
    | YAGNI | Unrequested features, over-engineering |

    ## Calibration

    **Only flag issues that would cause real problems during implementation planning.**
    A missing section, a contradiction, or a requirement so ambiguous it could be
    interpreted two different ways — those are issues. Minor wording improvements,
    stylistic preferences, and "sections less detailed than others" are not.

    Approve unless there are serious gaps that would lead to a flawed plan.

    ## Output Format

    ## Design Review

    **Status:** Approved | Issues Found

    **Issues (if any):**
    - [Section X]: [specific issue] - [why it matters for planning]

    **Recommendations (advisory, do not block approval):**
    - [suggestions for improvement]
```

**Reviewer returns:** Status, Issues (if any), Recommendations
