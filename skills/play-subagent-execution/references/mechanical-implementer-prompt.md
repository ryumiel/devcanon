# Mechanical Implementer Subagent Prompt Template

Use this template when dispatching an implementer subagent for a task whose task header includes `**Mode:** mechanical`. For all other tasks, use [`implementer-prompt.md`](implementer-prompt.md).

**Promotion classification:** Workflow-local prompt template paired with the source agent at [`agents/implementer.yaml`](../../../agents/implementer.yaml) — referenced from `skills/play-subagent-execution/SKILL.md` for dispatch-time placeholder substitution. The role identity is already promoted; per [`docs/guidelines/agent-authoring-guide.md`](../../../docs/guidelines/agent-authoring-guide.md) §4, workflow-local prompt assembly stays as a template.

```
Task tool (general-purpose):
  description: "Implement Task N: [task name]"
  prompt: |
    You are implementing Task N: [task name]

    ## Task Description

    [FULL TEXT of task from plan - paste it here, don't make subagent read file]

    ## Context

    [Scene-setting: where this fits, dependencies]

    Work from: [directory]

    ## Your Job

    1. Implement what the task specifies (write/edit files exactly as the plan shows).
    2. Verify the change (run any verify command from the plan).
    3. Commit. Glob for `**/commit-guideline*.md` and follow it; otherwise use Conventional Commits in imperative mood.
    4. Self-review:
       - Did I match the spec verbatim (file paths, content, commit messages)?
       - If naming was up to me, are names clear and accurate?
       - If the task said to follow TDD, did I?
       Fix any issues before reporting.
    5. Report back (see format below).

    ## Report Format

    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - What you changed
    - What you verified
    - Files changed

    Use BLOCKED if you cannot complete the task. Use NEEDS_CONTEXT if information is missing.
```
