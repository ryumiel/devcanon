# Code Quality Reviewer Prompt Template

**Target selection:** Codex uses reviewer with the balanced profile at high effort. Claude retains deep-reviewer
with frontier capability and its catalog Claude effort. The enclosing execution
skill owns this target-specific selection; scope, guards and result contracts
are identical. Validate the selected target role, not the other target's role.

Use this template when dispatching a code quality reviewer subagent.

**Purpose:** Verify implementation is well-built (clean, tested, maintainable)

**Surface selection:** The controller supplies `REVIEW_SURFACE`. This template
owns the task quality review and whole-implementation quality review questions, reviewer action, and report schema.
`lifecycle-status-policy.md` owns task quality review and whole-implementation quality review dispatch timing, same-head
disposition, invalidation, and terminal transitions.

**Promotion classification:** Workflow-local prompt template paired with the source agent at [`agents/reviewer.yaml`](../../../agents/reviewer.yaml) — referenced from `skills/play-subagent-execution/SKILL.md` for dispatch-time placeholder substitution. The role identity is already promoted; per [`docs/guidelines/agent-authoring-guide.md`](../../../docs/guidelines/agent-authoring-guide.md) §4, workflow-local prompt assembly stays as a template.

**Routes:** task quality review and whole-implementation quality review are separate response-only `reviewer`,
frontier/high, source-immutable sessions with zero handoffs. The controller
applies GUARD-001 independently around each session. Do not change source,
tests, configuration, documentation, or external systems; return only the
response. Findings are evidence; mutation disposition belongs to the controller.
Start a fresh whole-implementation quality review after task quality review.
Use a separate session and result.

**Fresh configuration:** Before either capture, validate `reviewer`,
`frontier`, the nonblank full model in the controller/owner-supplied
already-rendered `TASK_QUALITY_REVIEW_MODEL` or already-rendered `WHOLE_IMPLEMENTATION_QUALITY_REVIEW_MODEL` binding,
independent `high`,
source-immutable and external-none authority, a route-local
`task_quality_review_<instance_ordinal>` or `whole_implementation_quality_review_<instance_ordinal>`, `fork_turns: "none"`,
the fully substituted route-specific prompt, response-only output, and its
distinct termination. Task quality review terminates through its independent/provisional
same-head loop; whole-implementation quality review uses its fresh whole-range review and exact ADR-0016 skip
or final fix/fresh-review/terminal route. A missing, blank, unresolved, or
mismatched binding blocks before capture or spawn; do not locate a source
checkout or use an alias, nearby, or ambient model. Apply
`subagent-lifecycle` for allocation and cleanup. Task quality review and whole-implementation quality review are always fresh
one-shot reviewers and are never reused across routes or review rounds.

**task quality review question:** Is Task N at the supplied task head well-built, clean,
tested, and maintainable within its task-local scope?

**whole-implementation quality review question:** Is the complete implementation over the supplied whole-range
base/head well-built, clean, tested, maintainable, and ready for its owning
terminal handoff?

## Task quality review dispatch fields

```
Task tool (general-purpose):
  REVIEW_SURFACE: task-quality-review
  WORKING_DIRECTORY: [repository root]
  WHAT_WAS_IMPLEMENTED: [from implementer's report]
  TASK_REQUIREMENTS: |
    [FULL INLINE TEXT of Task N requirements]
  TASK_SOURCE_LOCATOR: [optional plan-file or authoritative source path]
  EXTRACTED_PLAN_TASK_EXECUTION_CONTEXT: [EXTRACTED PLAN/TASK EXECUTION CONTEXT]
  BASE_SHA: [commit before task]
  HEAD_SHA: [captured task head]
  DESCRIPTION: [task summary]
```

## Whole-implementation quality review dispatch fields

```
Task tool (general-purpose):
  REVIEW_SURFACE: whole-implementation-quality-review
  WORKING_DIRECTORY: [repository root]
  WHOLE_IMPLEMENTATION_SUMMARY: [whole-range implementation summary]
  PLAN_OR_REQUIREMENTS: [whole-plan or authoritative requirements]
  EXTRACTED_WHOLE_IMPLEMENTATION_CONTEXT: [whole-range execution context]
  ORIGINAL_BASE_SHA: [commit before the first task]
  CURRENT_HEAD_SHA: [current committed implementation head]
  WHOLE_IMPLEMENTATION_SCOPE: [complete changed-file and requirement scope]
```

Whole-implementation quality review does not require or assume a task-local implementer report and therefore
supports guarded inline exact task execution. The working directory and base/head fields are
controller-trusted structured inputs, distinct from untrusted implementer
reports. Its controller-curated whole-range fields are the review input even
when one task has no child implementer or executor report.

**Trust boundary (load-bearing):** Read the implementation from disk. Do not consume any content snapshot the controller may hold — snapshots are for the controller's bookkeeping only; reviewers read from disk to stay independent of the implementer's framing.

When `REVIEW_SURFACE` is `task-quality-review`, inspect only the captured task base/head from
`WORKING_DIRECTORY` and answer the task quality review question using the inline
`TASK_REQUIREMENTS`; `TASK_SOURCE_LOCATOR` is provenance, not required child
context.

When `REVIEW_SURFACE` is `whole-implementation-quality-review`, inspect the complete whole-implementation range
from `WORKING_DIRECTORY` and answer the whole-implementation quality review question. Whole-implementation quality review is distinct from task quality review
and must not reuse task quality review scope, context, session, or verdict.
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
