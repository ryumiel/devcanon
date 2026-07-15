# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent.

**Purpose:** Verify implementation is well-built (clean, tested, maintainable)

**Surface selection:** D15 may dispatch concurrently with D14 against the same
task head. Its result is provisional until same-head D14 passes and current-head
validation succeeds. D16 is a later fresh whole-implementation session governed
by `SKILL.md`'s final-review gate and may run after routes that skipped per-task
spec review.

**Promotion classification:** Workflow-local prompt template paired with the source agent at [`agents/deep-reviewer.yaml`](../../../agents/deep-reviewer.yaml) — referenced from `skills/play-subagent-execution/SKILL.md` for dispatch-time placeholder substitution. The role identity is already promoted; per [`docs/guidelines/agent-authoring-guide.md`](../../../docs/guidelines/agent-authoring-guide.md) §4, workflow-local prompt assembly stays as a template.

**Routes:** D15 and D16 are separate response-only `deep-reviewer`,
frontier/xhigh, source-immutable sessions with zero handoffs. The controller
applies GUARD-001 independently around each session. Do not change source,
tests, configuration, documentation, or external systems; return only the
response. Never reuse a D15 session or result as D16.

**D15 question:** Is Task N at the supplied task head well-built, clean,
tested, and maintainable within its task-local scope?

**D16 question:** Is the complete implementation over the supplied whole-range
base/head well-built, clean, tested, maintainable, and ready for its owning
terminal handoff?

## D15 dispatch fields

```
Task tool (general-purpose):
  REVIEW_SURFACE: D15 per-task
  WHAT_WAS_IMPLEMENTED: [from implementer's report]
  PLAN_OR_REQUIREMENTS: Task N from [plan-file]
  EXTRACTED_PLAN_TASK_EXECUTION_CONTEXT: [EXTRACTED PLAN/TASK EXECUTION CONTEXT]
  BASE_SHA: [commit before task]
  HEAD_SHA: [captured task head]
  DESCRIPTION: [task summary]
```

## D16 dispatch fields

```
Task tool (general-purpose):
  REVIEW_SURFACE: D16 final whole-implementation
  WHOLE_IMPLEMENTATION_SUMMARY: [whole-range implementation summary]
  PLAN_OR_REQUIREMENTS: [whole-plan or authoritative requirements]
  EXTRACTED_WHOLE_IMPLEMENTATION_CONTEXT: [whole-range execution context]
  ORIGINAL_BASE_SHA: [commit before the first task]
  CURRENT_HEAD_SHA: [current committed implementation head]
  WHOLE_IMPLEMENTATION_SCOPE: [complete changed-file and requirement scope]
```

D16 does not require or assume a task-local implementer report and therefore
supports guarded inline D13. Its controller-curated whole-range fields are the
review input even when one task has no child implementer or executor report.

**Trust boundary (load-bearing):** Read the implementation from disk. Do not consume any content snapshot the controller may hold — snapshots are for the controller's bookkeeping only; reviewers read from disk to stay independent of the implementer's framing.

When `REVIEW_SURFACE` is D15, inspect only the captured task base/head and
answer the D15 question. The D15 result remains provisional until a separate
same-head D14 passes and the current task head is unchanged. Any fix invalidates
both results and requires fresh D14 and D15 sessions.

When `REVIEW_SURFACE` is D16, inspect the complete whole-implementation range
and answer the D16 question. D16 starts only after all tasks complete, is
distinct from D15, and must not reuse D15 scope, context, session, or verdict.
The extracted whole-implementation context covers the whole implementation
scope.
If the extracted plan/task execution context contains present Contract Example
Discipline obligations, enforce them as code-quality review obligations using
the controller-supplied `Contract Example Discipline Consumer Rule` subsection
from that extracted context.
Do not infer whether Contract Example Discipline should have been required;
`play-planning` owns that trigger taxonomy.

**In addition to standard code quality concerns, the reviewer should check:**

- Does each file have one clear responsibility with a well-defined interface?
- Are units decomposed so they can be understood and tested independently?
- Is the implementation following the file structure from the plan?
- Did this implementation create new files that are already large, or significantly grow existing files? (Don't flag pre-existing file sizes — focus on what this change contributed.)

**Code-quality reviewer returns:** Strengths, Issues (Blocking/Nit), Assessment
