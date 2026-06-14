# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent.

**Purpose:** Verify implementation is well-built (clean, tested, maintainable)

**Per-task dispatch only:** for `spec-and-quality`, this reviewer may dispatch
concurrently with spec compliance against the same task head. Its result is
provisional until same-head spec compliance passes and current-head validation
succeeds. The final whole-implementation code-quality reviewer is governed by
`SKILL.md`'s final-review gate and may run after routes that skipped per-task
spec review.

**Promotion classification:** Workflow-local prompt template paired with the source agent at [`agents/code-quality-reviewer.yaml`](../../../agents/code-quality-reviewer.yaml) — referenced from `skills/play-subagent-execution/SKILL.md` for dispatch-time placeholder substitution. The role identity is already promoted; per [`docs/guidelines/agent-authoring-guide.md`](../../../docs/guidelines/agent-authoring-guide.md) §4, workflow-local prompt assembly stays as a template.

```
Task tool (general-purpose):
  WHAT_WAS_IMPLEMENTED: [from implementer's report]
  PLAN_OR_REQUIREMENTS: Task N from [plan-file]
  EXTRACTED_PLAN_TASK_EXECUTION_CONTEXT: [EXTRACTED PLAN/TASK EXECUTION CONTEXT]
  BASE_SHA: [commit before task]
  HEAD_SHA: [current commit]
  DESCRIPTION: [task summary]
```

**Trust boundary (load-bearing):** Read the implementation from disk. Do not consume any content snapshot the controller may hold — snapshots are for the controller's bookkeeping only; reviewers read from disk to stay independent of the implementer's framing.

When this template is used as the final whole-implementation code-quality
reviewer surface, the extracted context covers the whole implementation scope.
If the extracted plan/task execution context contains present Contract Example
Discipline obligations, enforce them as code-quality review obligations using
[`contract-example-discipline-consumer-rule.md`](contract-example-discipline-consumer-rule.md).
Do not infer whether Contract Example Discipline should have been required;
`play-planning` owns that trigger taxonomy.

**In addition to standard code quality concerns, the reviewer should check:**

- Does each file have one clear responsibility with a well-defined interface?
- Are units decomposed so they can be understood and tested independently?
- Is the implementation following the file structure from the plan?
- Did this implementation create new files that are already large, or significantly grow existing files? (Don't flag pre-existing file sizes — focus on what this change contributed.)

**Code-quality reviewer returns:** Strengths, Issues (Blocking/Nit), Assessment
