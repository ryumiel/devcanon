---
name: play-subagent-execution
description: Explicit-invocation workflow for executing an implementation plan with fresh subagents per independent task. Use only when the user explicitly invokes `play-subagent-execution` or an owning workflow explicitly requires plan execution.
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# Subagent-Driven Development

## Invocation Policy

This workflow is explicit-invocation-only. Do not select it from ordinary discussion, review-shaped text, possible behavior-change wording, or implementation-adjacent language. Run it only when the user explicitly invokes `play-subagent-execution` or when an owning workflow explicitly hands off to `play-subagent-execution`.

Execute plan by dispatching fresh subagent per task. Multi-task plans use
executor-owned risk-based per-task review routing; hard-risk or unclear tasks
use `spec-and-quality`: dispatch spec-compliance and code-quality reviewers
concurrently when practical, against the same committed task head, then join
their results before final disposition.
Single-task plans skip per-task review.

**Why subagents:** You delegate tasks to specialized agents with isolated context. By precisely crafting their instructions and context, you ensure they stay focused and succeed at their task. They should never inherit your session's context or history — you construct exactly what they need. This also preserves your own context for coordination work.

**Core principle:** Fresh subagent per task + executor-owned risk-based
review routing for multi-task plans = high-assurance serial execution with
isolated implementer context and independent review. Hard-risk and unclear
multi-task tasks use `spec-and-quality`: dispatch spec-compliance and
code-quality reviewers concurrently when practical, against the same committed
task head, then join their results before final disposition. The semantic
spec-first gate is preserved because code-quality results are provisional until
same-head spec compliance passes and the task head is still current. Reduced
per-task routes require a mandatory final whole-diff gate. Single-task plans
skip per-task review and use the final whole-implementation reviewer plus
direct/manual branch-level review status resolution, or downstream
`branch-review --fix` on the `issue-priming-workflow --auto` path; bounded fast
paths for single-task and mechanical cases reduce specific overhead without
changing the review contract.

`play-subagent-execution` preserves the task boundaries authored in the plan.
After extraction, each authored task remains the unit of implementer dispatch
and, for multi-task plans, the executor-computed per-task review route. The executor does not regroup
adjacent tasks or runtime-batch by default; runtime batching would be a
separate policy change, not an implicit optimization.

The plan constrains implementation intent, boundaries, source-of-truth
references, acceptance criteria, and verification expectations. It does not
make concrete code-like examples, test snippets, plan-authored test bodies,
shell snippets, shell recipes, command sequences, helper-name prescriptions,
line-number edits, or commit recipes authoritative unless the task explicitly
labels that content as approved verbatim artifact content and names the
authority source. Implementers choose concrete code, tests, docs, and
verification commands only after reading the relevant source files directly.

When a task includes a contract checklist, treat its owner/authority,
affected consumers/generated outputs, must-preserve, required behavior,
spec/procedure work, risk surfaces, and proof obligations as task constraints.
These fields constrain what the implementation must satisfy; they do not make
plan-authored implementation mechanics authoritative. If a checklist field is
blank, an `N/A` lacks a task-specific reason, or the task appears to invent an
owner, authority, source of truth, consumer, generated-output, or evidence
surface that source inspection cannot confirm, fail closed: report
BLOCKED/NEEDS_CONTEXT with the exact contract gap instead of silently treating
the missing contract as satisfied.

Before any implementer dispatch or inline execution, run a structural
task-contract gate against the task text. Do not infer trigger applicability
inside `play-subagent-execution`; `play-planning` owns the trigger taxonomy. The
gate verifies either a structurally complete `**Contract checklist:**` field or
an explicit task-specific reason no checklist trigger applies. A no-trigger
omission reason is trusted only when this controller can identify the upstream
two-gate `play-planning` return for the plan being executed, meaning both Plan
Review and Implementer Executability Review passed before `Plan written to
<path>.` was emitted. Direct, hand-written, copied, or older plans without that
upstream two-gate return must include a structurally complete checklist instead
of an omission reason. When a checklist
is present, it must explicitly name trigger criteria, owner/authority, affected
consumers/generated outputs, must-preserve, required behavior, spec/procedure
work, risk surfaces, and proof obligations, with no blank field or unexplained
`N/A`. If this structural gate fails, stop before implementation and report
BLOCKED/NEEDS_CONTEXT for plan repair; do not dispatch an implementer or execute
inline against the invalid task contract.

This structural task-contract gate is separate from DONE-report snapshot
classification. Snapshot request/skip classification is owned by
`play-subagent-execution`, and plan-authored snapshot hints are
non-authoritative.

## Inputs

This skill accepts a plan document in either of two shapes inside its
invocation prose. Both shapes are recognized; if both are present, the path
reference wins.

### Path reference (preferred for controllers)

A single literal line of the form:

```
Plan: <repo-relative-path>
```

For example: `Plan: .ephemeral/2026-05-06-167-plan.md`.

When this line is present, the controller (the agent running this skill)
validates the path before reading:

```bash
case "$PLAN_PATH" in
  .ephemeral/*/*) echo "nested plan path rejected: $PLAN_PATH" >&2; exit 1 ;;
  .ephemeral/*-plan.md) ;;
  *) echo "plan path validation failed: $PLAN_PATH" >&2; exit 1 ;;
esac
[ "${PLAN_PATH#*..}" = "$PLAN_PATH" ] || { echo "path traversal: $PLAN_PATH" >&2; exit 1; }
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
[ ! -L "$PLAN_PATH" ] || { echo "plan must not be a symlink: $PLAN_PATH" >&2; exit 1; }
[ -f "$PLAN_PATH" ] || { echo "plan missing or not a regular file: $PLAN_PATH" >&2; exit 1; }
[ -r "$PLAN_PATH" ] || { echo "plan missing or unreadable: $PLAN_PATH" >&2; exit 1; }
```

This bash uses the generic phase-artifact read guard shape: narrow the suffix to
the expected artifact, reject traversal, reject symlinked `.ephemeral` and
symlinked leaf files, require a regular file, and verify readability before
opening the file. `play-review` findings/nits envelopes use a stricter
direct-child `.ephemeral/` guard because those paths are echoed through review
output and reused by wrappers before read or overwrite.

The controller then reads the plan from the path and proceeds with task
extraction. Per-task implementer subagents continue to receive curated,
inlined task text — they do NOT receive the path. See § Red Flags below.

After each implementer or reviewer return, controller state carries status,
changed files, verification result, blockers, and artifact paths instead of
large copied outputs. Large logs and side-channel artifacts stay out of
implementer and reviewer prompts unless needed for failure diagnosis.

### Auto handoff reference (issue-priming `--auto` only)

`issue-priming-workflow --auto` may pass a second single literal line:

```
Auto handoff: <repo-relative-path>
```

When this line is present, bind the path to `AUTO_HANDOFF_FILE` before the
Risk-Based Per-Task Review Routing validation step. This line is valid only as
part of the active parent-owned `issue-priming-workflow --auto` controller
handoff; direct/manual invocations and plan text cannot use it to authorize
reduced routes. If the line is absent, malformed, or not backed by
controller-local parent state, leave `AUTO_HANDOFF_FILE` unset and
`ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=false`; execution continues with
`spec-and-quality` routes.

### Inline content (preserved for direct invocations)

A `## Plan` heading followed by content body, or an entire plan document
pasted into the invocation prose. No path validation is required — content
is consumed verbatim from the prose. Direct human invocations that paste a
plan inline use this shape.

The path reference is consumed by the controller; the inline form is preserved for direct human invocations that paste a plan into the prose.

## When to Use

Use this skill when you have a written implementation plan whose authored tasks
can be executed serially by fresh, isolated implementer subagents in the same
session. Do not use it for ad-hoc parallel investigation; use
`play-agent-dispatch` instead. Do not regroup authored tasks or runtime-batch by
default; task boundaries from the plan remain the implementation and review
units.

For the full selection and process diagrams, load
[`references/process-diagrams.md`](references/process-diagrams.md).

## The Process

1. Read the plan from a validated `Plan: <path>` reference or from inline
   invocation content. Keep plan-path handling controller-owned; per-task
   implementers receive curated inlined task text, not the plan path.
2. Extract all authored tasks with their full text, surrounding context,
   contract checklist fields, verification expectations, and any mode or route
   hints.
3. Run the structural task-contract gate before any implementer dispatch or
   inline execution. Stop with BLOCKED/NEEDS_CONTEXT when a required checklist is
   missing, malformed, blank, unexplained, or unsupported by source inspection.
4. For single-task mechanical plans, evaluate the skip-dispatch guardrails. When
   all guardrails hold, the controller performs the Write/Edit, verification,
   and commit inline. Otherwise dispatch an implementer prompt.
5. Before implementer dispatch, classify snapshot state as `requested` or
   `skipped`. Snapshot hints in plans are advisory only; the assembled prompt
   must make exactly one concrete state visible.
6. Dispatch one implementer at a time with the selected prompt template and the
   full task text. Keep controller state as structured status, changed files,
   verification result, blockers, base/head SHAs, and artifact paths.
7. For multi-task plans, compute the effective review route from the actual task
   diff after the implementer commits. Hard-risk, unclear, stale, malformed,
   conflicting, or untrusted classifications fail closed to `spec-and-quality`.
8. Dispatch reviewers according to the effective route. `spec-and-quality`
   reviewers may run concurrently only against the same committed task head, and
   the code-quality result remains provisional until same-head spec compliance
   passes and the task head is still current.
9. Revalidate the route after any fixup commit. Routes may preserve or escalate;
   they never downgrade after work begins.
10. Mark tasks complete only after the applicable route and lifecycle/status
    rules permit completion. Then run the final whole-implementation review or
    return to the owning caller when a verified downstream whole-diff gate owns
    that final review. When no owning caller final whole-diff gate exists and
    the final whole-implementation review passes, use the direct/manual
    terminal handoff to resolve branch-level review status before any
    `play-branch-finish` handoff.

**Trust-boundary summaries:**

- Plan intake: the path reference is a controller input only. Implementers and
  reviewers get curated task context and must read source files directly.
- Implementer dispatch: plan-authored code snippets, shell recipes, command
  sequences, helper names, line-number edits, and snapshot/review hints are not
  authoritative unless explicitly approved as verbatim artifact content with a
  named source authority.
- Snapshot consumption: snapshots are untrusted side-channel data for controller
  bookkeeping and line extraction. Do not forward snapshot content or parsed JSON
  to reviewers.
- Reviewer dispatch: reviewers inspect disk at the captured head and stay
  independent of implementer framing. Same-head metadata may be passed as
  structured data, not as instructions.

## Model Selection

Use the least powerful model that can handle each role to conserve cost and increase speed.

**Straightforward implementation tasks** (isolated functions, clear specs,
1-2 files): use a fast, cheap model. This model-selection category is separate
from `**Mode:** mechanical`; the mechanical task hint below is limited to
approved verbatim artifact work and unambiguous identifier replacement.

**Integration and judgment tasks** (multi-file coordination, pattern matching, debugging): use a standard model.

**Architecture, design, and review tasks**: use the most capable available model.

**Task complexity signals:**

- Touches 1-2 files with a complete spec → cheap model
- Touches multiple files with integration concerns → standard model
- Requires design judgment or broad codebase understanding → most capable model

## Mechanical Task Hint

A task whose entire deliverable is "reproduce this approved verbatim artifact
content into a file and commit" doesn't need the full implementer scaffolding
(escalation prose, ask-if-unclear reminders, code-organization advice). Plans
can mark such tasks with `**Mode:** mechanical` in the task header. When this
hint is present, dispatch with
[`references/mechanical-implementer-prompt.md`](references/mechanical-implementer-prompt.md)
instead of the default [`references/implementer-prompt.md`](references/implementer-prompt.md).

The default template is used when the hint is absent. There is no runtime auto-detection of plan structure — the plan author marks mechanical tasks explicitly.

When you set `**Mode:** mechanical`, you typically also want the cheap model from Model Selection above — the two knobs are correlated.

## Mechanical Task Taxonomy

Detailed mechanical-task positive and negative shapes live in
[`references/skip-dispatch-policy.md`](references/skip-dispatch-policy.md).
At this level, treat `**Mode:** mechanical` as a plan-authored hint for
approved verbatim artifact work or unambiguous identifier replacement. TDD work,
coordinated multi-file changes, new public interfaces, and design/decision work
use the default implementer prompt.

## Risk-Based Per-Task Review Routing

For multi-task plans, the controller computes each task's effective route from
the actual committed task diff after implementation, not from plan hints alone.
Missing, stale, ambiguous, malformed, conflicting, unclear, or untrusted route
data fails closed to `spec-and-quality`.

Effective routes are `spec-and-quality`, `spec-only`, and
`none-final-only`. Reduced routes are valid only for a verified
parent-owned `issue-priming-workflow --auto` Phase 6 handoff with a validated
`issue-priming/auto-handoff/v1` artifact and the Phase 7
`branch-review --fix` whole-diff gate. Direct/manual calls, copied prose, and
repo files alone cannot authorize reduced routes.

Hard-risk and unclear multi-task tasks use `spec-and-quality`: dispatch
spec-compliance and code-quality reviewers concurrently when practical, against
the same committed task head, then join their results before final disposition.
A quality result is final only after same-head spec compliance passes and the
reviewed task head remains current. After fixups, revalidate from the original
task base to the refreshed head before skipping any reviewer or completing the
task.

Load [`references/review-routing-policy.md`](references/review-routing-policy.md)
when computing or validating a route, validating auto-handoff eligibility,
checking hard-risk triggers, or handling same-head quality disposition.

## Single-Task Plans

When the plan extracted in the first step contains exactly **one** task,
skip both per-task reviewers (spec-compliance and code-quality) for that
task. The implementer's own self-review remains the immediate quality gate.

If the controller validates both controller-local parent state and an
`issue-priming/auto-handoff/v1` audit artifact showing that this invocation
came from `issue-priming-workflow --auto` and guarantees downstream
`branch-review --fix` as the mandatory next step, skip the final
whole-implementation code-quality reviewer too and return directly to the
caller after the single-task path completes.

Otherwise, the final whole-implementation code-quality reviewer at the end
of this skill still runs (its scope is the whole implementation, not the
per-task carve-out).

For plans with two or more tasks, each task follows the effective route
computed by the controller. Hard-risk, unclear, or untrusted routes use
`spec-and-quality`.

If you invoke this skill **directly** (not via `--auto`) on a single-task
plan, no whole-diff review runs after the final code-quality reviewer. When
that reviewer passes, continue through the direct/manual terminal handoff:
report that this skill did not run branch-level review, stop before
`play-branch-finish` when the active workflow requires branch-level review
before PR creation, and invoke `play-branch-finish` only when that workflow does
not require branch-level review.

The trade-off here: per-task review on a single task adds review overhead
without catching regressions across tasks (there is only one), so the
per-task review is skipped. On the `issue-priming-workflow --auto`
single-task path, downstream `branch-review --fix` becomes the whole-diff
gate; on direct/manual single-task invocations, the final
whole-implementation reviewer remains the built-in gate, then the
direct/manual terminal handoff resolves whether the active workflow requires
`branch-review` before `play-branch-finish`.

### Terminal risk signals

When terminal handoff state exists, produce bounded risk signals after
implementation and the applicable per-task/final review path. The risk signals
are non-authoritative branch-review input: they summarize executor-observed
surfaces and do not decide PR readiness, approve branch review, or narrow
branch-review scope. Branch-review independently validates its inputs and owns
branch-level review scope.

Use `scripts/write-risk-signals.sh` to write the artifact. The success notice
line is exactly:

```text
Risk signals written to <path>.
```

Notice is emitted only after the helper write and runtime validation succeed.
If the helper fails when terminal handoff was promised or expected, report a
blocker and do not emit the notice.

Direct/manual terminal handoff remains unchanged. This skill did not run
branch-level review; run `branch-review` before `play-branch-finish` when the
active workflow requires branch-level review.

### Direct/manual terminal handoff

When this is a direct or manual invocation and there is no verified owning
caller final whole-diff gate, the final whole-implementation review is this
skill's built-in terminal review gate. If that final whole-implementation
review passes, report that implementation and final review passed. Before
invoking `play-branch-finish`, also report these observable claims:
built-in final whole-implementation review passed; this skill did not run
branch-level review; run `branch-review` before `play-branch-finish` when the
active workflow requires branch-level review before PR creation; proceeding to
`play-branch-finish` is acceptable only when that workflow does not require
branch-level review. If the active workflow requires branch-level review before
PR creation, stop before invoking `play-branch-finish` so the operator can run
`branch-review` first. If that workflow does not require branch-level review,
then invoke `play-branch-finish`.

Completion-boundary contract: implementation summaries, verification summaries,
and review pass reports are status reports only; they are not terminal workflow
states. After the final whole-implementation review passes, the next action is
to resolve the branch-level review status above and then either stop for
required branch review or invoke `play-branch-finish`. Treating a summary as
completion and stopping there is invalid: summary-only completion is a workflow
violation.

Do not present or restate branch finish choices in this skill.
`play-branch-finish` presents its authoritative finish options and owns their
semantics. If a verified owning caller final whole-diff gate exists, preserve
the parent-owned path: return to the caller instead of invoking
`play-branch-finish`.

## Subagent Lifecycle

Use `subagent-lifecycle` for the generic controller lifecycle ledger, target
capability classification, cleanup gate before spawns, target-honest cleanup
outcomes, and slot-limit recovery. This skill owns execution-specific captured
state and the rule that task implementers stay available while same-session
review fix loops may still route work back to them.

Keep lifecycle state compact and structured: implementer status/report,
changed-file list, test result, snapshot state, base/head SHAs, reviewer scope,
reviewed head, findings, disposition, routing target, re-review target, fixup
count, and blocker family when applicable.

Load
[`references/lifecycle-status-policy.md`](references/lifecycle-status-policy.md)
when updating the lifecycle ledger, interpreting implementer statuses, or
deciding whether a session can be closed.

## Implementer Snapshot Consumption

The controller owns snapshot request/skip classification for each dispatched
implementer task. Plan-provided snapshot hints are advisory only. If
classification is unclear, fail closed by requesting a snapshot.

Request snapshots for changes to durable ADR/spec/requirements/roadmap,
guideline, skill, agent, procedure, workflow-policy, source-owned policy,
failure routing, lifecycle or terminal-state behavior, prompt/report contracts,
cross-agent or cross-skill handoffs, governed or generated outputs, schema/type
contracts, manifests, executable helpers, config, path-validation,
filesystem-safety, security-sensitive behavior, or tests guarding those
surfaces. Skip snapshots only for clearly localized low-risk work where default
DONE fields and controller-computed git/disk reads are enough.

Snapshots are a controller side channel, not reviewer context. The controller
may use valid snapshot content for post-commit verification and line extraction,
but must not forward snapshot content or parsed JSON into reviewer prompts. Any
commit after the implementer DONE report invalidates the snapshot for edit
anchors; re-read from disk instead.

Load [`references/snapshot-consumption.md`](references/snapshot-consumption.md)
when classifying snapshot state, assembling snapshot request prompt fields,
validating snapshot manifests, consuming snapshot data, or handling malformed or
stale snapshots.

## Skip-Dispatch Path

For the single-task subset of plans that are fully mechanical approved verbatim
artifact work or unambiguous identifier replacement, the controller may skip the
implementer dispatch and execute Write/Edit, verification, and commit inline.
This path sits on top of the single-task per-task-review skip.

All five guardrails must hold: the plan is single-task, the task is explicitly
mechanical, no clarifying questions could plausibly arise under the upstream
two-gate `play-planning` return, the structural task-contract gate is
satisfied, and no tests need to be authored. Direct, hand-written, copied, or
older plans without the upstream two-gate return fail the clarifying-question
guardrail and fall back to dispatched implementation. A task-contract failure
stops before implementation; other guardrail misses fall back to dispatched
implementation. There is no DONE report and no snapshot request on this path.

Load [`references/skip-dispatch-policy.md`](references/skip-dispatch-policy.md)
when evaluating guardrails, choosing fallback behavior, or checking examples.

## Handling Implementer Status

Before acting on any implementer status, record what that status actually
provides in the lifecycle ledger. `DONE` and `DONE_WITH_CONCERNS` require
report, snapshot state, changed files, base/head SHA, and test result capture
before reviewer dispatch. `NEEDS_CONTEXT` and `BLOCKED` capture the request
or blocker and available SHAs without waiting for artifacts that were not
produced.

For multi-task `spec-and-quality` routes, same-head quality results remain
pending or advisory until same-head spec compliance passes and the task head is
still current. Advisory, stale, and superseded quality results remain lifecycle
evidence but cannot complete a task.

Load
[`references/lifecycle-status-policy.md`](references/lifecycle-status-policy.md)
for the detailed status matrix, fixup route revalidation, repeated blocker
handling, and cleanup implications.

## Prompt Template Registry

Child-agent dispatch instructions live in these authoritative prompt
templates. The controller loads them when assembling the corresponding
subagent prompt; do not inline their full bodies into this skill source.

- `references/implementer-prompt.md` — default dispatch-time prompt for the
  `implementer` agent.
- `references/mechanical-implementer-prompt.md` — implementer dispatch prompt
  for tasks marked `**Mode:** mechanical`, subject to the existing mechanical
  hint and skip-dispatch fallback rules.
- `references/spec-reviewer-prompt.md` — per-task dispatch prompt for the
  `spec-compliance-reviewer` agent when the effective route includes spec
  review.
- `references/code-quality-reviewer-prompt.md` — dispatch-time prompt for the
  `code-quality-reviewer` agent for per-task code-quality review and for the
  final whole-implementation reviewer surface where this skill's final-review
  gate calls that reviewer.

## Branch Policy Reference Map

Load these branch-policy references lazily. Keep this source file as the eager
controller contract and trust-boundary summary; load the detailed references
only when the trigger applies.

| Reference                                                           | Load when                                                                                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| review routing - `references/review-routing-policy.md`              | Computing effective per-task routes, validating reduced-route auto-handoff, checking hard-risk triggers, or resolving same-head reviewer disposition.     |
| skip-dispatch behavior - `references/skip-dispatch-policy.md`       | Evaluating single-task inline execution, mechanical-task taxonomy, fallback behavior, or skip-dispatch examples.                                          |
| lifecycle/status handling - `references/lifecycle-status-policy.md` | Updating lifecycle ledger state, interpreting implementer statuses, handling fixups/blockers, or deciding cleanup timing.                                 |
| snapshot consumption - `references/snapshot-consumption.md`         | Classifying snapshot request state, assembling snapshot prompt fields, validating or consuming snapshot manifests, or handling malformed/stale snapshots. |
| diagrams - `references/process-diagrams.md`                         | Needing full DOT diagrams or diagram interpretation notes for the controller flow.                                                                        |
| examples - `references/example-workflow.md`                         | Needing an end-to-end illustrative execution trace.                                                                                                       |
| rationale - `references/advantages.md`                              | Needing rationale, quality gates, cost, or comparison context.                                                                                            |

## Prompt Support Assets

These files support prompt assembly and DONE-report snapshot handling. They
are not child-agent dispatch prompt templates.

- `references/snapshot-manifest-recipe.md` — canonical construction recipe for implementer `implementer/snapshot/v1` manifests
- `scripts/write-snapshot-manifest.sh` — helper script for writing implementer `implementer/snapshot/v1` manifests
- `scripts/validate-snapshot-manifest.sh` — helper script for validating requested implementer `implementer/snapshot/v1` manifests before controller consumption
- `scripts/write-risk-signals.sh` — helper script for writing validated terminal `branch-review/risk-signals/v1` artifacts

## Example Workflow

See [`references/example-workflow.md`](references/example-workflow.md) for an end-to-end illustration of the multi-task flow (controller plan extraction, per-task implementer dispatch, effective review route, completion).

## Advantages

See [`references/advantages.md`](references/advantages.md) for the rationale (vs. manual execution, vs. executing plans inline, efficiency gains, quality gates, cost).

## Hard Rules

1. **Never start implementation on `main` / `master` without explicit user consent.** Skills invoked outside an authorized worktree or feature branch must surface and stop.
2. **Never dispatch implementer subagents in parallel.** Implementations are serial — concurrent dispatch produces conflicts and race conditions.

## Red Flags

See [`references/red-flags.md`](references/red-flags.md) for the full list (start-on-main, skipping the executor-computed review route, parallel implementer dispatch, ignoring subagent questions, skipping re-review).

## Integration

**Related workflow skills:**

- **play-planning** - Creates the plan this skill executes
- **branch-review** - External branch-level review before finish when the active workflow requires it
- **play-branch-finish** - Complete development after review status is resolved

**Subagents should use:**

- **play-tdd** - Subagents follow TDD for each task
