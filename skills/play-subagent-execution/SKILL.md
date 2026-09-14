---
name: play-subagent-execution
description: Explicit-invocation workflow for executing an implementation plan with fresh subagents per independent task. Use only when the user explicitly invokes `play-subagent-execution` or an owning workflow explicitly requires plan execution.
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# Subagent-Driven Development

## Public helper mechanics

Use the adjacent [inspect-plan-projection usage](references/inspect-plan-projection-usage.md), [source-immutability usage](references/source-immutability-usage.md), [write-risk-signals usage](references/write-risk-signals-usage.md), [write-snapshot-manifest usage](references/write-snapshot-manifest-usage.md), and [validate-snapshot-manifest usage](references/validate-snapshot-manifest-usage.md). This skill retains D14-D16 lifecycle, blocking, and terminal-handoff policy.

## Reference Loading

### Eager

Every run reads these files; they count toward the eager footprint with `SKILL.md`.

- [`references/inspect-plan-projection-usage.md`](references/inspect-plan-projection-usage.md) — named without a gate by the public helper mechanics above; read in full before any `Plan: <path>` projection result is selected.
- [`references/source-immutability-usage.md`](references/source-immutability-usage.md) — named without a gate by the public helper mechanics above; its commands run only inside the lifecycle/status policy's D14-D16 guards.
- [`references/write-risk-signals-usage.md`](references/write-risk-signals-usage.md) — named without a gate by the public helper mechanics above; its commands run only in the terminal risk-signals action.
- [`references/write-snapshot-manifest-usage.md`](references/write-snapshot-manifest-usage.md) — named without a gate by the public helper mechanics above; the writer runs inside D12/D13 children.
- [`references/validate-snapshot-manifest-usage.md`](references/validate-snapshot-manifest-usage.md) — named without a gate by the public helper mechanics above; validation runs only against a requested snapshot.
- [`references/review-routing-policy.md`](references/review-routing-policy.md) — initial effective-route selection on every plan, multi-task or single-task.
- [`references/lifecycle-status-policy.md`](references/lifecycle-status-policy.md) — task completion, D16 timing or exact skip, and terminal disposition on every run, plus every returned worker or reviewer status.

This list covers the files the controller reads itself. Files that dispatched D12-D16 children read under their prompt templates, such as `references/snapshot-manifest-recipe.md`, and files that `subagent-lifecycle` reads during its procedure are part of a run's footprint but are declared by those owners, not restated here.

### Conditional

Load these only at the loading site that names the trigger.

- [`references/contract-example-discipline-consumer-rule.md`](references/contract-example-discipline-consumer-rule.md) — extracted plan/task execution context contains Contract Example Discipline or an equivalent clearly labeled section/obligation.
- [`references/process-diagrams.md`](references/process-diagrams.md) — full selection or process diagrams needed.
- [`../play-agent-dispatch/references/dispatch-ritual-usage.md`](../play-agent-dispatch/references/dispatch-ritual-usage.md) — before every fresh D12-D16 child capture; a guarded-inline run under the exact ADR-0016 D16 skip captures none.
- [`../subagent-lifecycle/SKILL.md`](../subagent-lifecycle/SKILL.md) — before the first D12-D16 child dispatch of the run.
- [`references/skip-dispatch-policy.md`](references/skip-dispatch-policy.md) — single-task plan marked `**Mode:** mechanical`: guardrail evaluation, fallback, taxonomy, or examples.
- [`references/executor-prompt.md`](references/executor-prompt.md) — D13 dispatch after all five guardrails pass and the controller does not take the inline path.
- [`references/implementer-prompt.md`](references/implementer-prompt.md) — D12 dispatch, including D13-to-D12 reclassification; a same-session D12 fixup sends incremental context instead, and the guarded-inline and D13 paths do not read it.
- [`references/snapshot-consumption.md`](references/snapshot-consumption.md) — snapshot request/skip classification and prompt fields before any D12/D13 child dispatch, then manifest validation or consumption after a requested snapshot.
- [`references/spec-reviewer-prompt.md`](references/spec-reviewer-prompt.md) — D14 dispatch when a multi-task effective route includes spec review.
- [`references/code-quality-reviewer-prompt.md`](references/code-quality-reviewer-prompt.md) — D15 dispatch on `spec-and-quality`, and D16 final whole-implementation dispatch on every route except the exact ADR-0016 single-task auto carve-out.
- [`references/terminal-risk-signals.md`](references/terminal-risk-signals.md) — terminal handoff state exists.
- [`references/direct-manual-terminal-handoff.md`](references/direct-manual-terminal-handoff.md) — direct or manual invocation with no verified owning caller final whole-diff gate.
- [`references/example-workflow.md`](references/example-workflow.md) — end-to-end illustrative trace needed.
- [`references/advantages.md`](references/advantages.md) — rationale, quality gates, cost, or comparison context needed.
- [`references/red-flags.md`](references/red-flags.md) — full red-flags list needed beyond the inline Red Flags summary.

Scripts under `scripts/` are executed, not read; their usage documents above are the prompt-side surface.

## Invocation Policy

Do not select this workflow from ordinary discussion, review-shaped text, possible behavior-change wording, or implementation-adjacent language; the explicit-invocation rule itself is owned by this skill's frontmatter (`description` and `codex_sidecar` policy).

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
direct/manual branch-level review status resolution, or parent-owned Candidate
Closure and Source Freeze followed by downstream `branch-review --fix` on the
`issue-priming-workflow --auto` path; bounded fast
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

When a task includes a contract tier and its tier-appropriate assembled context,
treat the selected projection's common relationship tuple, any independently
necessary producer or consumer direction that the tier-appropriate context
assigns to an applicable directly cited boundary row or task-local tier fields
when absent from that tuple, and the task-local mutation authority, affected
execution consumers/generated outputs, must-preserve and required behavior,
spec/procedure work, risk surfaces, and verification expectations as task
constraints. Consume each fact from its single carrier without restating it.
These fields constrain what the implementation must satisfy; they do not make
plan-authored implementation mechanics authoritative. If a checklist field is
blank, an `N/A` lacks a task-specific reason, or the task appears to invent an
owner, authority, source of truth, consumer, generated-output, or evidence
surface that source inspection cannot confirm, fail closed: report
BLOCKED/NEEDS_CONTEXT with the exact contract gap instead of silently treating
the missing contract as satisfied.

Before any implementer dispatch or inline execution, run a structural
projection gate before fallback or route selection. For a reviewed `Plan: <path>`
handoff, after the existing path guards and reviewed-digest comparison, invoke
`inspect-plan-projection.sh --path <repo-relative-plan-path>` with that exact
guarded path. Treat every zero-status result as untrusted. Before interpreting
or selecting a result, read the full success-envelope contract in that
[inspect-plan-projection usage](references/inspect-plan-projection-usage.md)
for the closed `planning-projection/v1` success contract and validate its
status and channels, exact guarded path, and every required schema, type,
cardinality, identifier, range, and reference constraint. Use only validated
projection entries to mechanically select entries whose explicit implementation
disposition or task-valued proof names each returned Task ID.

A nonzero helper/runtime status or any malformed, unknown, inconsistent, or
channel-violating success, including unavailable usage, returns
`BLOCKED/NEEDS_CONTEXT` before skip evaluation, inline execution,
implementer/reviewer dispatch, or final review. There is no repair, fallback,
or partial use; do not infer or fall back to a delimiter parser.

Direct-inline plan intake retains the existing controller-owned structural
procedure. Require one literal Markdown H2 `## Execution Projection` outside
fenced code, followed by peer H2 `## Tasks` before any `### Task` heading, and
one or more uniquely identified entries containing exactly `Entry ID`,
`Affected surface or equivalent set`, `Owner/source`, `Mode`,
`Implementation disposition`, and `Proof`; alternate headings, renamed,
duplicate, or unknown projection metadata do not substitute. Each Entry ID and
Task ID is a nonempty string matching the UPPER-ASCII-KEBAB grammar
`^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$`. Other values are nonblank: the
surface value is a JSON array containing one or more unique, nonempty strings,
where one member is a singleton and two or more members are an equivalent set,
array order is non-semantic, and uniqueness uses exact decoded-string equality;
Mode is `authority`, `reference`, `derived representation`,
`non-normative summary`, or `verification`; disposition is a nonempty
duplicate-free `Tasks [...]` ID set or `No code — <reason>`; and Proof is
exactly one `Task <TASK-ID>`, `Reviewer <responsibility>`, or
`Controller <responsibility>` owner paired with one nonblank boundary. Every
Task ID in disposition or Proof resolves to exactly one current task. These are
structural checks, not authority-truth or topology-completeness review. For
each current task, mechanically select entries whose explicit implementation
disposition or task-valued proof names that Task ID. Any missing, duplicate,
unknown, or ambiguous projection structure returns BLOCKED/NEEDS_CONTEXT to
planning. This selection does not decide whether membership or topology is
semantically truthful or complete. Legacy and pre-projection plans receive no
inference or bypass.

Every current task must contain each canonical record-reference field exactly
once:

```markdown
**Boundary rows:** ["BR-A", "BR-B"]
**Supporting-owner supplements:** []
```

Each value is a JSON array of zero or more unique, non-empty string identifiers
without line breaks. `Boundary rows` contains stable boundary-row IDs, which do
not inherit Task ID grammar. `Supporting-owner supplements` contains the
governing projection Entry IDs that key those supplements and therefore uses
the existing Entry ID form. The controller resolves each field only against
its declared record kind. Every listed identifier must resolve exactly once in
that kind. Unknown, duplicate, stale, ambiguous, or cross-kind identifiers
return `BLOCKED/NEEDS_CONTEXT` to planning before dispatch.

Use only those resolved IDs to curate the uniquely identified plan-level
records through the controller's existing context-assembly responsibility. This
is controller interpretation of the reviewed plan contract, not a public helper
or general Markdown parsing API. Do not
discover records merely because they mention a selected Entry ID, send the full
plan for child resolution, recursively follow references, infer missing records
or semantic applicability, validate semantic coverage or topology
exhaustiveness, define a record-body grammar, or route from the projection.

Then run the structural task-contract gate against the extracted plan/task
execution context. Before
implementer dispatch, reviewer dispatch, final whole-implementation review, or
skip-dispatch evaluation, assemble the extracted plan/task execution context
from resolved projection entries, plan-level records curated from the task's
kind-scoped IDs,
plan-level Contract Example Discipline obligations or equivalent clearly
labeled sections/obligations when present, task-local checklist or no-trigger
status, and any task-local example or verification obligations that refine the
plan-level section. When Contract Example Discipline or an equivalent clearly
labeled section/obligation is present, inline the full shared
`references/contract-example-discipline-consumer-rule.md` content in that
context under the subsection heading `Contract Example Discipline Consumer
Rule`. The controller consumes this same named context directly for
guarded-inline D13; prompt-mediated consumers receive it through their curated
prompt. Subagents do not read the full plan file or resolve controller-relative
rule paths.

Do not infer trigger applicability inside `play-subagent-execution`;
`play-planning` owns the trigger taxonomy and tier classification. Do not
reclassify a declared tier. For every current task in a reviewed plan, the gate
requires exactly one declared `**Contract tier:** FULL`, `LIGHTWEIGHT`, or
`NO-TRIGGER` and validates only that declared tier's structure from the
assembled context. The
[task contract criteria](../play-planning/references/planning-criteria.md#task-contract-criteria)
own the per-tier field definitions and what the selected projection entries
already carry; the executor checks the selected entries, resolved IDs, curated
records, and task-local fields structurally against those criteria and does
not restate them. The executor must not promote, demote, infer, or otherwise
reclassify the tier from task prose, diff size, path spelling, or runtime risk
routing. D5 owns semantic coverage for reviewed plans, including whether the
selected entries cover every actual participant and independently necessary
execution relationship; the controller must not treat prompt-mediated
consumers as the only consumers or omit guarded-inline D13 as an actual
participant or direct consumer merely because no child prompt is dispatched.
Present Contract Example Discipline obligations are part of the task contract;
the executor only verifies obligations already included in extracted plan/task
execution context; do not infer trigger applicability and do not decide whether
Contract Example Discipline should have been required. In the case when
extracted plan/task execution context includes Contract Example Discipline or
an equivalent clearly labeled section/obligation, apply the shared consumer
rule in
[`references/contract-example-discipline-consumer-rule.md`](references/contract-example-discipline-consumer-rule.md).
Both `LIGHTWEIGHT` and `NO-TRIGGER` are trusted only when this controller can
identify the upstream two-gate `play-planning` return for the plan being
executed, meaning both Plan Review and Implementer Executability Review passed
before `Plan written to <path>.` was emitted. Direct, hand-written, copied,
older, or otherwise unreviewed plans without that upstream two-gate return must
use a structurally complete `FULL` contract. That direct `FULL` route is
caller-authorized and receives structural validation only; the executor does
not claim, infer, or synthesize D5-equivalent semantic completeness for it. A
caller that requires planning-review assurance must use the reviewed
`play-planning` route. If this structural gate or the extracted plan/task
execution context is missing, malformed, unsupported, internally inconsistent,
or unverifiable, stop before implementation and report BLOCKED/NEEDS_CONTEXT
for plan repair; do not dispatch an implementer, dispatch a reviewer, run the
final whole-implementation review, evaluate skip-dispatch as eligible, or
execute inline against the invalid task contract.

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
validates the path before reading. Resolve `ISSUE_PRIMING_WORKFLOW_DIR` to the
installed `issue-priming-workflow` skill bundle, not the repository under work,
invoke the helper from the repository root, and treat any nonzero exit as a
contract failure that stops before reading:

```bash
ISSUE_PRIMING_WORKFLOW_DIR="<installed-issue-priming-workflow-skill-bundle>"
node "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/phase-artifacts.mjs" validate-read plan "$PLAN_PATH"
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

Only after the digest comparison passes does the controller invoke
`inspect-plan-projection.sh --path <repo-relative-plan-path>` before reading or
extracting the saved plan. It validates and consumes the closed result as the
path-backed structural gate described above, then continues its separate
kind-scoped record resolution and curated execution-context path. Per-task
implementer subagents continue to receive curated, inlined task text — they do
NOT receive the path. See § Red Flags below.

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

### Verified auto-route attestation (issue-priming `--auto` only)

The active parent controller may also pass a `Verified auto-route attestation:`
field. Treat it as controller-provided context only when the active parent state
and the auto-handoff artifact both validate. Before every fresh D12 spawn or
route-authorized stable D12 continuation, require a freshly validated attestation to state that
current issue authority was validated and to name
the source provider and issue, owner thread, exact approved route identity,
reviewed plan digest, auto-handoff identity, and the current head when one
exists. Retain only that current validated value in controller-local state as
`ISSUE_PRIMING_AUTO_ROUTE_ATTESTATION`; it is not task prose, plan content, a
durable artifact, or a reduced-route authority. If a prior D12 task changed the
head or any other route fact, rebuild and validate the attestation from current
controller-held facts before the next prompt.

For every fresh D12 spawn, substitute only the current retained attestation into
the full implementer prompt's `Verified Auto-Route Attestation` marker. For a
route-authorized stable D12 continuation, freshly revalidate the attestation and
send it only in the incremental task-local `followup_task` message; do not
substitute or resend the full implementer prompt or full task context. If current
validation fails or the field is missing, malformed, or unavailable after parent
and auto-handoff validation, retain `unverified` and use the manual/default D12
behavior. Never reuse or infer an attestation from prior task text, a returned
status, or copied invocation prose.

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
   resolved projection entries, kind-scoped record-reference fields, declared
   contract tier, tier-appropriate contract fields, verification expectations,
   and any mode or route hints.
3. Assemble the extracted plan/task execution context before implementer
   dispatch, reviewer dispatch, final whole-implementation review, or
   skip-dispatch evaluation. Resolve the task's canonical identifier lists
   directly within their declared record kinds, then curate only the uniquely
   identified supporting-owner supplements and boundary records. Keep
   kind-scoped resolution separate from semantic applicability and fail closed
   before dispatch when identity or curation is ambiguous. Include plan-level
   Contract Example Discipline obligations or equivalent clearly labeled
   sections/obligations when present, task-local declared tier and
   tier-appropriate structure, and any task-local example or verification
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

The route owner supplies the capability and independent effort. Every fresh
Codex dispatch resolves its full model from its Codex-bound rendered route binding
and passes both model and effort explicitly. Semantic role TOML omits those
target-local dispatch values. D12
uses `implementer`, balanced/high; D13 uses `executor`, efficient/medium; and
D14-D16 use `deep-reviewer`, frontier/xhigh. These pairs do not grant external
mutation authority.

For Claude D13 executor dispatch, omit named effort for the efficient
capability. The `medium` effort above remains the Codex dispatch value; do not
translate it to a Claude thinking budget.

### D12-D16 fresh-Codex dispatch contract

Before every fresh D12-D16 capture, load the dispatch ritual in
[`dispatch-ritual-usage.md`](../play-agent-dispatch/references/dispatch-ritual-usage.md)
from the installed `play-agent-dispatch` bundle and run it with that route's
values below. A missing, blank, unreadable, or unavailable ritual reference is
a terminal pre-dispatch blocker: create no ledger row or baseline, do not
spawn, and do not invent inline fallback detail. That reference owns the
generic dispatch ritual; this workflow owns its route values, prompt and output
contracts, and termination below.

| Route | `agent_type`    | Capability  | Model marker                              | `reasoning_effort` | `source_authority` | Prompt                      |
| ----- | --------------- | ----------- | ----------------------------------------- | ------------------ | ------------------ | --------------------------- |
| D12   | `implementer`   | `balanced`  | `D12_MODEL` = `{{model-codex:balanced}}`  | `high`             | `source-mutable`   | `D12_SELF_CONTAINED_PROMPT` |
| D13   | `executor`      | `efficient` | `D13_MODEL` = `{{model-codex:efficient}}` | `medium`           | `source-mutable`   | `D13_SELF_CONTAINED_PROMPT` |
| D14   | `deep-reviewer` | `frontier`  | `D14_MODEL` = `{{model-codex:frontier}}`  | `xhigh`            | `source-immutable` | `D14_SELF_CONTAINED_PROMPT` |
| D15   | `deep-reviewer` | `frontier`  | `D15_MODEL` = `{{model-codex:frontier}}`  | `xhigh`            | `source-immutable` | `D15_SELF_CONTAINED_PROMPT` |
| D16   | `deep-reviewer` | `frontier`  | `D16_MODEL` = `{{model-codex:frontier}}`  | `xhigh`            | `source-immutable` | `D16_SELF_CONTAINED_PROMPT` |

| Route | Self-contained prompt and output                                              | Termination                                                      |
| ----- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| D12   | Full task/context, authorized paths, snapshot request, report/status          | Existing scoped commit, report, snapshot, and status disposition |
| D13   | Exact guarded task/context, authorized paths, snapshot request, report/status | Existing five-guardrail stop/reclassify disposition              |
| D14   | Independent D14 prompt, captured task head, response-only report              | Same-head D14 disposition/fix loop                               |
| D15   | Independent D15 prompt, captured task head, response-only report              | Provisional/final same-head disposition/fix loop                 |
| D16   | Fresh D16 whole-range prompt, base/head, response-only report                 | Exact ADR-0016 skip or final fix/fresh-review/terminal route     |

Every route has `external_authority: none`. A missing, blank, unresolved, or
mismatched marker blocks before capture or spawn. Do not search a source
checkout, use an alias, or fall back to a nearby or ambient model.

After validation and the existing route-local capture, create exactly one fresh
child with the actual Codex fields:

```text
# D12: D12_MODEL is the Codex-bound balanced model
Codex.spawn_agent({
  task_name: d12_<instance_ordinal>,
  agent_type: "implementer",
  model: D12_MODEL,
  reasoning_effort: "high",
  fork_turns: "none",
  message: D12_SELF_CONTAINED_PROMPT,
})
# D13: D13_MODEL is the Codex-bound efficient model
Codex.spawn_agent({
  task_name: d13_<instance_ordinal>,
  agent_type: "executor",
  model: D13_MODEL,
  reasoning_effort: "medium",
  fork_turns: "none",
  message: D13_SELF_CONTAINED_PROMPT,
})
# D14: D14_MODEL is the Codex-bound frontier model
Codex.spawn_agent({
  task_name: d14_<instance_ordinal>,
  agent_type: "deep-reviewer",
  model: D14_MODEL,
  reasoning_effort: "xhigh",
  fork_turns: "none",
  message: D14_SELF_CONTAINED_PROMPT,
})
# D15: D15_MODEL is the Codex-bound frontier model
Codex.spawn_agent({
  task_name: d15_<instance_ordinal>,
  agent_type: "deep-reviewer",
  model: D15_MODEL,
  reasoning_effort: "xhigh",
  fork_turns: "none",
  message: D15_SELF_CONTAINED_PROMPT,
})
# D16: D16_MODEL is the Codex-bound frontier model
Codex.spawn_agent({
  task_name: d16_<instance_ordinal>,
  agent_type: "deep-reviewer",
  model: D16_MODEL,
  reasoning_effort: "xhigh",
  fork_turns: "none",
  message: D16_SELF_CONTAINED_PROMPT,
})
```

The route prompt references below own task-local content. An explicitly
permitted same-session D12 fixup for the original stable task carries only
incremental findings/context. D13-to-D12 reclassification and a D16 final
whole-implementation fix use the lifecycle fresh-child path. D14/D15 are
always fresh one-shot reviewers after a head-changing fix. A target rejection
reports the exact requested `model=<Dn_MODEL> effort=<Dn_EFFORT>` and stops
through the existing route terminal without substitution.

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
That policy also owns proportionality disposition, review-loop limit, and
resumption before a D14/D15 finding can reach D12.

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
came from `issue-priming-workflow --auto` and identifies Candidate Closure and
Source Freeze followed by `branch-review --fix` as the mandatory downstream
route. Use the
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

At this terminal action, resolve the installed bundle and discover the writer
contract before preparing the artifact:

```bash
bash "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/write-risk-signals.sh" --help
```

Then, before setting any helper input, load
[`references/terminal-risk-signals.md`](references/terminal-risk-signals.md)
for the required inputs, the six signal categories, and the optional
`contract_example_discipline` context object. A missing, blank, unreadable, or
unavailable reference is a terminal blocker: do not invoke the helper, create a
risk-signals artifact, or emit the success notice, and do not improvise the
inputs inline; report the blocker. `play-subagent-execution` is the normative
owner of terminal-signal policy; the loaded reference is a subordinate,
terminal-handoff-scoped operating procedure, and the
[write-risk-signals usage](references/write-risk-signals-usage.md) keeps the
helper's invocation mechanics.

Use `scripts/write-risk-signals.sh` to write the artifact. The success notice
line is exactly:

```text
Risk signals written to <path>.
```

Notice is emitted only after the helper write and runtime validation succeed.
If the helper fails when terminal handoff was promised or expected, report a
blocker and do not emit the notice.

When the helper emits `Risk signals written to <path>.`, pass that emitted path
to the next branch review invocation in the form the loaded reference
specifies for the artifact's base. If any later source mutation, including a
branch-review-owned fix commit, changes `HEAD`, regenerate risk signals for the
new `HEAD` before the next branch review, or omit the stale risk-signals path
intentionally.

Direct/manual terminal handoff otherwise remains unchanged. This skill did not
run branch-level review; run `branch-review` before `play-branch-finish` when
the active workflow requires branch-level review.

### Direct/manual terminal handoff

When this is a direct or manual invocation and there is no verified owning
caller final whole-diff gate, the final whole-implementation review is this
skill's built-in terminal review gate. Once that review passes, and before
reporting status or handing off to `branch-review` or `play-branch-finish`,
load
[`references/direct-manual-terminal-handoff.md`](references/direct-manual-terminal-handoff.md)
for the pre-finish reporting and branch-level review status resolution
procedure. A missing, blank, unreadable, or unavailable reference is a terminal
blocker: do not invoke `branch-review` or `play-branch-finish`, do not report
the run as complete, and do not improvise the handoff inline; report the
blocker. `play-subagent-execution` is the normative owner of terminal-handoff
policy; the loaded reference is a subordinate, direct/manual-scoped operating
procedure.

Completion-boundary contract: implementation summaries, verification summaries,
and review pass reports are status reports only; they are not terminal workflow
states. After the final whole-implementation review passes, the next action is
to resolve the branch-level review status as this section directs and then
either hand off for required branch review, wait until that review status is
resolved, or invoke `play-branch-finish` when branch review is not required.
Treating a summary as completion and stopping there is invalid:
summary-only completion is a workflow violation.

Do not present or restate branch finish choices in this skill.
`play-branch-finish` presents its authoritative finish options and owns their
semantics. If a verified owning caller final whole-diff gate exists, preserve
the parent-owned path: return to the caller instead of invoking
`play-branch-finish`.

## Subagent Lifecycle

Use `subagent-lifecycle` before dispatching task implementer, executor, or deep-reviewer sessions. This skill owns execution-specific captured
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
