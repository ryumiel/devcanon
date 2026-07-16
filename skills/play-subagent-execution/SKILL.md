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
use `spec-and-quality`: dispatch separate D14 specification and D15 quality
deep-review sessions concurrently when practical, against the same committed
task head, then join their results before final disposition.
Single-task plans skip per-task review.

**Why subagents:** You delegate tasks to specialized agents with isolated context. By precisely crafting their instructions and context, you ensure they stay focused and succeed at their task. They should never inherit your session's context or history — you construct exactly what they need. This also preserves your own context for coordination work.

**Core principle:** Fresh subagent per task + executor-owned risk-based
review routing for multi-task plans = high-assurance serial execution with
isolated implementer context and independent review. Hard-risk and unclear
multi-task tasks use `spec-and-quality`: D14 and D15 may run concurrently when
practical against the same committed task head, then join their results before
final disposition. The
[lifecycle/status policy](references/lifecycle-status-policy.md) owns their
post-selection disposition, freshness, invalidation, and incomplete or
terminal outcomes. Reduced
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

When a task includes a contract tier and its tier-appropriate contract
structure, treat its owner/authority,
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
task-contract gate against the extracted plan/task execution context. Before
implementer dispatch, reviewer dispatch, final whole-implementation review, or
skip-dispatch evaluation, assemble the extracted plan/task execution context
from plan-level Contract Example Discipline obligations or equivalent clearly
labeled sections/obligations when present, task-local checklist or no-trigger
status, and any task-local example or proof obligations that refine the
plan-level section. When Contract Example Discipline or an equivalent clearly
labeled section/obligation is present, inline the full shared
`references/contract-example-discipline-consumer-rule.md` content in that
context under the subsection heading `Contract Example Discipline Consumer
Rule`. This named context is the only contract context prompt consumers
receive; subagents receive curated inlined context and do not read the full plan
file or resolve controller-relative rule paths.

Do not infer trigger applicability inside `play-subagent-execution`;
`play-planning` owns the trigger taxonomy and tier classification. Do not
reclassify a declared tier. For every current task in a reviewed plan, the gate requires
exactly one declared `**Contract tier:** FULL`, `LIGHTWEIGHT`, or
`NO-TRIGGER` and validates only its declared tier structure. `FULL` requires a
structurally complete checklist; `LIGHTWEIGHT` requires owner, purpose, inputs
and outputs, material write or side-effect owner, failure and cleanup behavior,
focused proof, and an explicit reason every FULL trigger is absent;
`NO-TRIGGER` requires a task-specific reason. The executor must not promote,
demote, infer, or otherwise reclassify the tier from task prose, diff size,
path spelling, or runtime risk routing. Present Contract Example
Discipline obligations are part of the task contract; the executor only
verifies obligations already included in extracted plan/task execution context;
do not infer trigger applicability and do not decide whether Contract Example
Discipline should have been required. In the case when extracted plan/task
execution context includes Contract Example Discipline or an equivalent clearly
labeled section/obligation, apply the shared consumer rule in
[`references/contract-example-discipline-consumer-rule.md`](references/contract-example-discipline-consumer-rule.md).
Both `LIGHTWEIGHT` and `NO-TRIGGER` are trusted only when this controller can
identify the upstream two-gate `play-planning` return for the plan being
executed, meaning both Plan Review and Implementer Executability Review passed
before `Plan written to <path>.` was emitted. Direct, hand-written, copied,
older, or otherwise unreviewed plans without that upstream two-gate return must
use a structurally complete `FULL` contract. When a FULL checklist is present,
it must explicitly name trigger criteria, owner/authority, affected
consumers/generated outputs, must-preserve, required behavior, spec/procedure
work, risk surfaces, and proof obligations, with no blank field or unexplained
`N/A`. If this
structural gate or the extracted plan/task execution context is missing,
malformed, unsupported, internally inconsistent, or unverifiable, stop before
implementation and report BLOCKED/NEEDS_CONTEXT for plan repair; do not dispatch
an implementer, dispatch a reviewer, run the final whole-implementation review,
evaluate skip-dispatch as eligible, or execute inline against the invalid task
contract.

This structural task-contract gate is separate from DONE-report snapshot
classification. Snapshot request/skip classification is owned by
`play-subagent-execution`, and plan-authored snapshot hints are
non-authoritative.

## Inputs

This skill accepts a plan document in either of two shapes inside its
invocation prose. Both shapes are recognized; if both are present, the path
reference wins.

### Path reference (preferred for controllers)

A pair of literal lines of the form:

```
Plan: <repo-relative-path>
Expected digest: <sha256>
```

For example: `Plan: .ephemeral/2026-05-06-167-plan.md`.

When the path line is present, the controller (the agent running this skill)
requires the expected-digest line, validates it as lowercase 64-hex, and
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

Immediately after those guards and before reading, extracting, routing, or
dispatching any task, compute SHA-256 over the exact saved plan bytes with
`shasum -a 256` when available, otherwise `sha256sum`, and pipe either result
through `awk '{print $1}'`. Validate the extracted field as lowercase 64-hex
and compare it with `Expected digest: <sha256>`. A missing or malformed expected
digest, unavailable hasher, hashing failure, or mismatch stops before plan
extraction and must return to the owning planning workflow; never replace the
expected digest with the current file digest. Keep both values controller-local
and do not create a digest artifact, helper, parser, or registry.

This bash uses the generic phase-artifact read guard shape: narrow the suffix to
the expected artifact, reject traversal, reject symlinked `.ephemeral` and
symlinked leaf files, require a regular file, and verify readability before
opening the file. `play-review` findings/nits envelopes use a stricter
direct-child `.ephemeral/` guard because those paths are echoed through review
output and reused by wrappers before read or overwrite.

Only after the digest comparison passes does the controller read the plan from the path and proceed with task
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
   declared contract tier, tier-appropriate contract fields, verification expectations, and any mode or route
   hints.
3. Assemble the extracted plan/task execution context before implementer
   dispatch, reviewer dispatch, final whole-implementation review, or
   skip-dispatch evaluation. Include plan-level Contract Example Discipline
   obligations or equivalent clearly labeled sections/obligations when present,
   task-local declared tier and tier-appropriate structure, and any task-local example or proof
   obligations that refine the plan-level section. When Contract Example
   Discipline or an equivalent clearly labeled section/obligation is present,
   also inline the full shared consumer rule under
   `Contract Example Discipline Consumer Rule` so prompt consumers can enforce
   the rule without relying on local reference paths.
   Then run the structural task-contract gate. Stop with BLOCKED/NEEDS_CONTEXT
   when a required checklist or extracted context is missing, malformed, blank,
   unexplained, unsupported, internally inconsistent, or unverifiable by source
   inspection.
4. For single-task mechanical plans, evaluate the skip-dispatch guardrails.
   When all five guardrails hold, the controller either performs the Write/Edit,
   verification, and commit inline or dispatches the exact-task executor prompt.
   A contract-gate failure blocks; another missing guardrail reclassifies to D12
   and dispatches the implementer prompt.
5. Before implementer dispatch, classify snapshot state as `requested` or
   `skipped`. Snapshot hints in plans are advisory only; the assembled prompt
   must make exactly one concrete state visible.
6. Dispatch one implementer at a time with the selected prompt template and the
   full task text. Keep controller state as structured status, changed files,
   verification result, blockers, base/head SHAs, and artifact paths.
7. For multi-task plans, compute the effective review route from the actual task
   diff after the implementer commits. Hard-risk, unclear, stale, malformed,
   conflicting, or untrusted classifications fail closed to `spec-and-quality`.
8. Dispatch reviewers according to the effective route. D14 and D15 are
   separate response-only `deep-reviewer` sessions with independent GUARD-001
   lifecycles. Load the
   [lifecycle/status policy](references/lifecycle-status-policy.md) for guard
   ordering and every returned review disposition.
9. After any fixup commit, use the lifecycle/status policy for invalidation and
   completion state, then load the
   [review-routing policy](references/review-routing-policy.md) only to
   recompute the effective route.
10. After the lifecycle/status policy permits task completion, follow its D16
    and terminal disposition. This index does not restate those transitions.

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

When model selection is available, choose a capability that matches the role:

**Task complexity signals:**

- Bounded, straightforward work with a complete specification → `efficient`
- Integration work or ordinary implementation → `balanced`
- Architecture, design, or adversarial review → `frontier`

Capability selects only the model. It never implies effort, authority, tools,
sandbox, approvals, or `**Mode:** mechanical`. Mechanical mode does not select a
capability.

Preserve the capability and effort configured by a shipped role instead of
overriding either at dispatch time. D12 uses `implementer`, balanced/high; D13
uses `executor`, efficient/medium; and D14-D16 use `deep-reviewer`,
frontier/xhigh. These pairs do not grant external mutation authority.

## Execution Route Classification

D12 uses the source-mutable `implementer`, balanced/high, for judgment-bearing
scoped implementation. Preserve the existing status, snapshot, scoped commit,
self-review, TDD, and verification contracts in
[`references/implementer-prompt.md`](references/implementer-prompt.md).
Implementer dispatch remains serial: never run two source-mutable task workers
concurrently.

D13 uses guarded inline execution or the source-mutable `executor`,
efficient/medium, only when all five exact guardrails pass. The
[skip-dispatch policy](references/skip-dispatch-policy.md) owns pre-dispatch
selection and fallback, the [executor prompt](references/executor-prompt.md)
owns child action and report shape, and the
[lifecycle/status policy](references/lifecycle-status-policy.md) owns returned
D13 dispositions. None of these surfaces permits the executor to guess or
widen scope.

## Mechanical Task Hint

A task whose entire deliverable is "reproduce this approved verbatim artifact
content into a file and commit" doesn't need the full implementer scaffolding
(escalation prose, ask-if-unclear reminders, code-organization advice). Plans
can mark such tasks with `**Mode:** mechanical` in the task header. The hint is
an input to the five D13 guardrails, not dispatch authority by itself. When all
five guardrails pass and the controller does not take the inline path, dispatch
with [`references/executor-prompt.md`](references/executor-prompt.md). If a
non-contract guardrail fails, reclassify to D12 and use the default
[`references/implementer-prompt.md`](references/implementer-prompt.md). A task
contract failure stops before mutation.

There is no runtime auto-detection of plan structure — the plan author marks
mechanical tasks explicitly, and the controller validates the five guardrails.
`**Mode:** mechanical` does not select a role or capability.

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

Hard-risk and unclear multi-task tasks select `spec-and-quality`, which assigns
D14 and D15 to the task. Post-selection result disposition, freshness,
invalidation, and failure transitions belong to the lifecycle/status policy.

Load [`references/review-routing-policy.md`](references/review-routing-policy.md)
when computing the initial effective route, validating auto-handoff
eligibility, or checking hard-risk triggers.

### D14-D15 guarded per-task reviews

D14 is a separate response-only `deep-reviewer`, frontier/xhigh and
source-immutable, with zero handoffs. D15 is a separate response-only
`deep-reviewer`, frontier/xhigh and source-immutable, with zero handoffs. Use
the configured role and effort; do not substitute an ordinary reviewer,
ambient role, model, or effort. The
[lifecycle/status policy](references/lifecycle-status-policy.md) is the
normative owner of their independent guard lifecycles, same-head disposition,
fix invalidation, cleanup, and incomplete or terminal outcomes. That policy
applies the bundle's `scripts/source-immutability.sh`; this index does not copy
its command sequence.

### D16 guarded final whole-implementation review

D16 is a fresh response-only `deep-reviewer`, frontier/xhigh and
source-immutable, with zero handoffs. Supply the whole implementation base/head
range and the D16-specific question from
`references/code-quality-reviewer-prompt.md`.

The [lifecycle/status policy](references/lifecycle-status-policy.md) is the
normative owner of D16 dispatch timing, the exact skip, guard ordering, cleanup,
fix-loop freshness, and final incomplete or terminal outcomes.

## Single-Task Plans

Single-task per-task review selection is part of the initial route contract.
Use the [review-routing policy](references/review-routing-policy.md) for route
selection and verified auto-handoff eligibility, including proof that the run
came from `issue-priming-workflow --auto` and identifies
`branch-review --fix` as the mandatory next step. Use the
[lifecycle/status policy](references/lifecycle-status-policy.md) for task
completion, exact D16 skip eligibility, final-review timing, and returned
terminal disposition. This index does not restate those transitions.

For direct/manual runs, continue to the
[Direct/manual terminal handoff](#directmanual-terminal-handoff); that section
owns branch-level review status resolution and pre-finish reporting.

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

Set these required inputs before invoking the helper:
`RISK_SIGNALS_REVIEWED_BASE_REF`, `RISK_SIGNALS_REVIEWED_BASE_SHA`,
`RISK_SIGNALS_REVIEWED_HEAD_SHA`, `RISK_SIGNALS_REVIEWED_RANGE`,
`RISK_SIGNALS_CHANGED_FILES_JSON`, `RISK_SIGNALS_VALUES_JSON`,
`RISK_SIGNALS_CANONICAL_DOCS_MAY_BE_AFFECTED`, and
`RISK_SIGNALS_END_USER_DIAGNOSTICS_MAY_BE_AFFECTED`.
`RISK_SIGNALS_REVIEWED_RANGE` and `RISK_SIGNALS_CHANGED_FILES_JSON` must
describe the same full branch range that the next branch-review invocation will
validate, such as `$BASE...HEAD`; `RISK_SIGNALS_REVIEWED_BASE_REF` must match
that range's base side. For detached issue-base reviews, use the full base SHA
as both `RISK_SIGNALS_REVIEWED_BASE_REF` and the left side of
`RISK_SIGNALS_REVIEWED_RANGE`. The values JSON must contain exactly these six
signal categories: `user_facing_behavior`,
`documentation_examples`, `diagnostics`, `contract`, `generated_output`, and
`governance_path`. Each value is `none`, `present`, or `unknown`;
ambiguous/unclear classifications must be encoded as `unknown`, not omitted.

Optionally set
`RISK_SIGNALS_CONTRACT_EXAMPLE_DISCIPLINE_CONTEXT_JSON` only when the extracted
context contains present Contract Example Discipline obligations or an
equivalent clearly labeled section/obligation and the next branch review must
preserve that source-owned contract context after an `issue-priming-workflow
--auto` single-task run skips this skill's final whole-implementation reviewer.
When set, the helper writes the validated object as the risk-signals artifact's
`contract_example_discipline` field. The JSON must contain exactly:

```json
{
  "present": true,
  "source": "extracted-plan-task-execution-context",
  "obligations": "<non-empty string, max 4000 chars, no NUL>",
  "consumer_rule": "<non-empty string, max 4000 chars, no NUL>",
  "proof_obligations": {
    "valid_examples_pass": true,
    "invalid_families_fail": true
  }
}
```

`proof_obligations` values must be exactly `true` and reflect only obligations
explicitly present in the extracted context. Copy `obligations` only from
present Contract Example Discipline, an equivalent clearly labeled
section/obligation, task-local example, or proof-obligation lines, and copy
`consumer_rule` from the shared rule content inlined under `Contract Example
Discipline Consumer Rule`; do not include the whole plan. If present
obligations cannot be represented in that bounded object because the data is
empty, too large, contains NUL, or lacks an explicit proof-obligation signal,
report BLOCKED and do not invoke the helper or emit the success notice.

Notice is emitted only after the helper write and runtime validation succeed.
If the helper fails when terminal handoff was promised or expected, report a
blocker and do not emit the notice.

When the helper emits `Risk signals written to <path>.`, pass that emitted path
to the next branch review invocation. Default-base artifacts use the normal
no-positional-base form: `branch-review --risk-signals <path>` or, in an
auto-fix loop, `branch-review --fix --risk-signals <path>`. Detached issue-base
artifacts whose reviewed range is `<full-base-sha>...HEAD` must pass that same
full base SHA as branch-review's positional base:
`branch-review --risk-signals <path> <full-base-sha>` or, in an auto-fix loop,
`branch-review --fix --risk-signals <path> <full-base-sha>`. If a branch-review
run or branch-review-owned fix commit changes `HEAD`, regenerate risk signals
for the new `HEAD` before rerunning branch review, or omit the stale
risk-signals path intentionally.

Direct/manual terminal handoff otherwise remains unchanged. This skill did not
run branch-level review; run `branch-review` before `play-branch-finish` when
the active workflow requires branch-level review.

### Direct/manual terminal handoff

When this is a direct or manual invocation and there is no verified owning
caller final whole-diff gate, the final whole-implementation review is this
skill's built-in terminal review gate. If that final whole-implementation
review passes, report implementation status and final review status before any
branch-review or finish handoff. Before invoking `play-branch-finish`, also
report these observable claims: built-in final whole-implementation review
passed; this skill did not run branch-level review; run `branch-review` before
`play-branch-finish` when the active workflow requires branch-level review
before PR creation; proceeding to `play-branch-finish` is acceptable only when
that workflow does not require branch-level review. When the active workflow
requires branch-level review before PR creation, hand off to `branch-review`
before any `play-branch-finish` handoff. Use `branch-review --fix` as the
branch-level gate before finish only when the owning workflow already grants
auto-fix authority or the operator explicitly confirms that branch-review may
auto-commit fixes; otherwise hand off to branch-review without auto-fix
authority and wait for review approval evidence. Do not invoke
`play-branch-finish` until `branch-review` returns review approval evidence or
the active workflow explicitly waives branch-level review. If that workflow does
not require branch-level review, then invoke `play-branch-finish`.

Completion-boundary contract: implementation summaries, verification summaries,
and review pass reports are status reports only; they are not terminal workflow
states. After the final whole-implementation review passes, the next action is
to resolve the branch-level review status above and then either hand off for
required branch review, wait until that review status is resolved, or invoke
`play-branch-finish` when branch review is not required. Treating a summary as
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
artifact work or unambiguous identifier replacement, the controller may execute
Write/Edit, verification, and commit inline or dispatch D13's `executor`. This
path sits on top of the single-task per-task-review skip.

All five guardrails must hold: the plan is single-task, the task is explicitly
mechanical, no clarifying questions could plausibly arise under the upstream
two-gate `play-planning` return, the structural task-contract gate is
satisfied, and no tests need to be authored. Direct, hand-written, copied, or
older plans without the upstream two-gate return fail the clarifying-question
guardrail and fall back to dispatched implementation. A task-contract failure
stops before implementation; other guardrail misses fall back to dispatched
implementation. After all five guardrails pass, keep the chosen branch
explicit. The guarded inline branch produces no child DONE report and no child
snapshot request; the controller verifies and records its own inline commit.
The dispatched-executor branch preserves the unchanged DONE-report and snapshot
request/skip contract from `references/executor-prompt.md` and the status rules
below.

Load [`references/skip-dispatch-policy.md`](references/skip-dispatch-policy.md)
when evaluating guardrails, choosing fallback behavior, or checking examples.

## Handling Implementer Status

Returned D12/D13 status interpretation and all post-selection D14-D16 state
transitions are owned by the lifecycle/status policy; this index does not
restate them.

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
- `references/executor-prompt.md` — D13 exact-task dispatch prompt for the
  `executor` agent, used only after all five guardrails pass and subject to the
  existing inline-choice and abstention rules.
- `references/spec-reviewer-prompt.md` — per-task dispatch prompt for the
  D14 `deep-reviewer` when the effective route includes spec review.
- `references/code-quality-reviewer-prompt.md` — dispatch-time prompt for the
  D15 per-task `deep-reviewer` and the separate D16 final whole-implementation
  `deep-reviewer`; the template carries distinct questions and scopes.
- `references/contract-example-discipline-consumer-rule.md` — shared
  consumer-side Contract Example Discipline rule used by the executor, prompt
  templates, final whole-implementation review surface, and skip-dispatch
  policy. The controller loads this file and inlines its content under
  `Contract Example Discipline Consumer Rule` when the extracted plan/task
  execution context contains present obligations.

## Branch Policy Reference Map

Load these branch-policy references lazily. Keep this source file as the eager
controller contract and trust-boundary summary; load the detailed references
only when the trigger applies.

| Reference                                                           | Load when                                                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| review routing - `references/review-routing-policy.md`              | Computing initial effective per-task routes, validating reduced-route auto-handoff, or checking hard-risk triggers.                                                            |
| skip-dispatch behavior - `references/skip-dispatch-policy.md`       | Evaluating single-task inline execution, mechanical-task taxonomy, fallback behavior, or skip-dispatch examples.                                                               |
| lifecycle/status handling - `references/lifecycle-status-policy.md` | Updating lifecycle ledger state, interpreting returned worker statuses, resolving same-head reviewer disposition, handling fixups/blockers, guard failures, or cleanup timing. |
| snapshot consumption - `references/snapshot-consumption.md`         | Classifying snapshot request state, assembling snapshot prompt fields, validating or consuming snapshot manifests, or handling malformed/stale snapshots.                      |
| diagrams - `references/process-diagrams.md`                         | Needing full DOT diagrams or diagram interpretation notes for the controller flow.                                                                                             |
| examples - `references/example-workflow.md`                         | Needing an end-to-end illustrative execution trace.                                                                                                                            |
| rationale - `references/advantages.md`                              | Needing rationale, quality gates, cost, or comparison context.                                                                                                                 |

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
2. **Never dispatch source-mutable task workers in parallel.** D12 implementers
   and D13 executors are serial — concurrent dispatch produces conflicts and
   race conditions.

## Red Flags

See [`references/red-flags.md`](references/red-flags.md) for the full list (start-on-main, skipping the executor-computed review route, parallel implementer dispatch, ignoring subagent questions, skipping re-review).

## Integration

**Related workflow skills:**

- **play-planning** - Creates the plan this skill executes
- **branch-review** - External branch-level review before finish when the active workflow requires it
- **play-branch-finish** - Complete development after review status is resolved

**Subagents should use:**

- **play-tdd** - Subagents follow TDD for each task
