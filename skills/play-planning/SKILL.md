---
name: play-planning
description: Writes a comprehensive implementation plan as bite-sized tasks for an engineer with no codebase context, saved to `.ephemeral/`. Use when working from a spec or design for a multi-step task, before touching code. Do not use to brainstorm requirements — start with play-brainstorm.
---

# Writing Plans

## Overview

Write comprehensive task-spec plans assuming the engineer has zero context for
our codebase. Plans are authoritative for intent, boundaries, invariants,
acceptance criteria, task order, dependencies, source-of-truth references,
authority surfaces, and verification expectations. Plans are not prewritten
implementations.

Assume the implementer is a skilled developer who must read the relevant source
files directly before choosing concrete code, tests, documentation edits, and
verification commands. The plan constrains the work; it does not substitute for
source inspection.

Do not include concrete implementation code, test code, plan-authored test
bodies, shell snippets, shell recipes, exact command sequences, helper-name
prescriptions, line-number edits, or commit recipes unless the content is an
already-approved verbatim artifact that the task must reproduce exactly. When
verbatim artifact content is required, label it as approved verbatim artifact
content and name its authority source.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Save plans to:** `.ephemeral/YYYY-MM-DD-<feature-name>-plan.md`.
Before the `Write` tool call, compute the path and apply the canonical
`.ephemeral` write guard:

```bash
PLAN_PATH=".ephemeral/$(date +%F)-<feature-name>-plan.md"
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
mkdir -p .ephemeral
[ -L "$PLAN_PATH" ] && rm "$PLAN_PATH"
[ ! -d "$PLAN_PATH" ] || { echo "plan path is a directory: $PLAN_PATH" >&2; exit 1; }
[ ! -e "$PLAN_PATH" ] || [ -f "$PLAN_PATH" ] || { echo "plan path exists but is not a regular file: $PLAN_PATH" >&2; exit 1; }
```

After writing, emit the literal line `Plan written to <repo-relative-path>.`
to the conversation. This is the contract surface `play-subagent-execution`
reads — do not reword it.

## Inputs

This skill accepts a design document in either of two shapes inside its
invocation prose. Both shapes are recognized; if both are present, the path
reference wins.

### Path reference (preferred for controllers)

A single literal line of the form:

```
Design: <repo-relative-path>
```

For example: `Design: .ephemeral/2026-05-06-167-design.md`.

When this line is present, validate the path before reading:

```bash
case "$DESIGN_PATH" in
  .ephemeral/*/*) echo "nested design path rejected: $DESIGN_PATH" >&2; exit 1 ;;
  .ephemeral/*-design.md) ;;
  *) echo "design path validation failed: $DESIGN_PATH" >&2; exit 1 ;;
esac
[ "${DESIGN_PATH#*..}" = "$DESIGN_PATH" ] || { echo "path traversal: $DESIGN_PATH" >&2; exit 1; }
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
[ ! -L "$DESIGN_PATH" ] || { echo "design must not be a symlink: $DESIGN_PATH" >&2; exit 1; }
[ -f "$DESIGN_PATH" ] || { echo "design missing or not a regular file: $DESIGN_PATH" >&2; exit 1; }
[ -r "$DESIGN_PATH" ] || { echo "design missing or unreadable: $DESIGN_PATH" >&2; exit 1; }
```

This bash follows the same suffix, traversal, symlink, regular-file, and
readability checks used by the repository's phase-artifact handoff guards,
narrowed to the design-document suffix.
`play-review` findings/nits envelopes add a direct-child `.ephemeral/`
restriction because those paths are echoed through review output and reused by
wrappers before read or overwrite; design documents keep the generic
phase-artifact shape.

### Inline content (preserved for direct invocations)

A `## Design` heading followed by content body, exactly as the existing
convention. No path validation is required — content is consumed verbatim
from the prose. Direct human invocations that have no upstream file use
this shape.

The path reference is consumed by the controller; the inline form is preserved for direct human invocations.

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what
each one is responsible for. This is where decomposition decisions get locked
in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce
self-contained changes that make sense independently.

## Contract-Heavy Work

For contract-heavy work, write a short contract table before task planning. Use
it when the plan depends on cross-skill handoffs, generated or derived paths,
helper scripts, source-owned policy, schema or interface authority, execution
cwd assumptions, or fail-closed behavior.

Cover the applicable surfaces:

- Inputs
- Execution cwd
- Script or helper locations
- Source-of-truth files
- Derived paths
- Allowed overrides
- Failure modes

Keep the table concise. It records invariants and authority surfaces; it does
not copy helper implementations or command recipes.

## Contract Checklist Triggers

For non-trivial work, every task must include a contract checklist. Non-trivial
means the work matches at least one of these triggers:

- multi-step implementation;
- durable documentation, spec, Architecture Decision Record (ADR),
  architecture, Inter-Process Communication (IPC), contract, guideline,
  roadmap, or MAP navigation changes;
- cross-skill or cross-agent handoffs;
- source-owned policy, schema, interface, bridge, or protocol changes;
- generated or derived artifact behavior;
- state-machine, failure, retry, cleanup, recovery, or terminal-state behavior;
- fail-closed behavior, safety-sensitive behavior, or user-visible error
  handling;
- compatibility or versioning behavior.

For trivial work, the plan may omit the contract checklist only when the task
states why none of the trigger conditions apply. A bare `N/A` is not enough.

When the checklist is required, every field must either be filled in or marked
`N/A` with a task-specific reason. Blank fields, unreplaced placeholders, and
unexplained `N/A` entries are plan-review failures. If the owner, authority,
source of truth, or required evidence cannot be identified, name the blocker or
assumption instead of inventing a contract.

The checklist records executable contracts, not implementation mechanics. It
must not prescribe concrete code, test bodies, helper names, shell recipes,
line-number edits, or command sequences unless the content is explicitly
labeled as already-approved verbatim artifact content with an authority source.

Use the target repository's own authority vocabulary after reading its entry
documents, such as `AGENTS.md`, `MAP.md`, contract registries, and spec or
documentation guidelines. If the repository lacks an authority model, state that
assumption instead of silently inventing one.

Required checklist surfaces for qualifying work:

- **Trigger criteria:** the specific non-trivial checklist trigger(s) that make
  the checklist required for this task, or the task-specific reason no trigger
  applies.
- **Owner / authority:** behavior owner, contract owner, code owner,
  documentation owner, source of truth if artifacts conflict, and consumer repo
  authority vocabulary used.
- **Affected consumers / generated outputs:** downstream skills, agents,
  prompts, generated Claude/Codex outputs, installed outputs, docs, workflows,
  or external callers that must observe the contract; state task-specific `N/A`
  when no generated or downstream consumer surface is affected.
- **Must preserve:** boundary invariants, existing workflow or domain
  contracts, current/target/draft/deferred behavior labels when applicable, and
  compatibility constraints.
- **Required behavior:** preconditions, happy path, failure classes,
  retry/recovery behavior, cleanup ownership, terminal states, and re-entry or
  re-review behavior.
- **Spec / procedure work:** for specs, procedures, ADRs, architecture docs,
  contract docs, IPC docs, guidelines, or roadmap items, identify the owning
  artifact category, behavior status labels, fact ownership, conflict
  precedence, normative expectations, example or fixture validation
  expectations, cross-document drift risks, and review-blocking semantic risks.
- **Risk surfaces:** include only relevant risks, such as persistence or data
  loss, bridge/protocol drift, external input validation, path/file safety,
  secrets or credential disclosure, prompt/log disclosure, compatibility or
  versioning, and user-facing error surfaces.
- **Proof obligations:** tests or fixtures that must exist or be updated,
  generated-output or mirrored-reference evidence, documentation/spec/ADR/MAP
  updates required by trigger, manual verification required, and branch-review
  focus areas.

Documentation impact stays trigger-based. If the change alters durable workflow
policy, contract ownership, verification expectations, navigation, or
architectural decision state, update the owning AFDS artifact in the same PR or
name the follow-up blocker. Do not require ADR or MAP updates unless their AFDS
triggers are met. An ADR trigger means the plan must ask whether the change
crosses the durable-decision threshold; it does not mean every feature or spec
plan needs an ADR.

## Cohesive Task Composition

Compose related implementation steps into one authored task when they form a
self-contained implementation unit. Prefer one task when the work:

- shares the same subsystem or file family;
- uses the same verification route;
- does not need an intermediate reviewed state to be safe;
- can fit in one implementer's working context; and
- can land as one coherent changeset.

Related steps should share the same subsystem or file family before they are
composed into one authored task.

Composition changes task boundaries, not task-spec quality. A composed task
still names the purpose, goal, boundaries, acceptance criteria, risks,
dependencies, source-of-truth references, authority surfaces, and verification
expectations needed for independent implementation.

Do not compose unrelated work just to reduce dispatch count. Do not hide dependent implementation units merely to avoid multi-task review. If separate
units need independent review, rollback, or verification, keep them as separate tasks.

## Bite-Sized Task Granularity

Each task should be small enough for one implementer to complete with a clear
working context and one coherent verification route. Split tasks when they have
different source-of-truth authorities, different risk profiles, different
verification routes, or dependency boundaries that later tasks need reviewed
before starting.

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use play-subagent-execution (recommended) to implement this plan task-by-task. Tasks are execution contracts; implementers read source files directly and choose concrete code, tests, and docs within each task's constraints.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

## Task Structure

```markdown
### Task N: [Component Name]

<!-- Optional review-routing hints, when present, go here:
**Risk hint:** low | medium | high
**Review hint:** none-final-only | spec-only | spec-and-quality
**Review rationale:** <one sentence naming why this route is safe or why full review is required>
-->

**Files:**

- Create: `exact/path/to/file`
- Modify: `exact/path/to/existing`
- Test: `tests/exact/path/to/test`

**Purpose:** <why this task exists>

**Goal:** <the completed state this task must produce>

**Non-goals:** <scope boundaries and forbidden expansions>

**Source-of-truth references:** <issue, design, ADR, spec, guideline, source file, or existing behavior authority>

**Authority surfaces:** <which source files, contracts, schemas, helpers, renderers, install/sync flows, or policies own the behavior; generated outputs are derived evidence, not authority>

**Contract checklist:** <required for non-trivial work; otherwise state why no trigger applies. Include trigger criteria, owner/authority, affected consumers/generated outputs, must-preserve, required behavior, spec/procedure work, risk surfaces, and proof obligations, with task-specific `N/A` reasons for irrelevant fields>

**Acceptance criteria:** <observable requirements for completion>

**Risks:** <behavioral, compatibility, migration, or review risks>

**Dependencies:** <prior tasks or external prerequisites, or "None">

**Verification expectations:** <what evidence must prove the task is complete, without prescribing exact command sequences>
```

Task specs should prefer references to existing behavior, source files,
contracts, tests, ADRs, and guidelines over copied logic. If a task needs
TDD, say which behavior must be covered and where similar tests already live;
the implementer writes the concrete test after reading source. Use a clear
`**TDD expectation:**` field for this so `play-subagent-execution` can treat the
task as one where tests need to be authored.

### Optional `**Mode:**` field

Tasks that fit the mechanical taxonomy may include `**Mode:** mechanical` between the heading and any review-routing hint fields. This is a non-authoritative hint; `play-subagent-execution` owns route validation and may reject or override it. The taxonomy (positive and negative examples) lives in [`skills/play-subagent-execution/SKILL.md` § Mechanical Task Taxonomy](../play-subagent-execution/SKILL.md#mechanical-task-taxonomy) — consult it before setting the hint.

Example mechanical-task header:

```markdown
### Task N: Rename Example Token

**Mode:** mechanical

**Risk hint:** low
**Review hint:** none-final-only
**Review rationale:** Exact single-file identifier replacement with no hard-risk trigger; final whole-diff review remains required.

**Files:**

- Modify: `examples/demo-note.md`

**Purpose:** Rename an example token without changing example behavior.

**Goal:** Every occurrence of the old token in the named file uses the new token.

**Non-goals:** Do not change surrounding prose, example behavior, or additional files.

**Source-of-truth references:** The approved issue requirement for this exact rename.

**Authority surfaces:** `examples/demo-note.md`

**Contract checklist:** N/A — this exact token replacement is a single-file
mechanical example that changes no behavior, authority, generated output,
failure route, review rule, documentation navigation, or compatibility surface.

**Acceptance criteria:** `OldExampleToken` is absent from the file and `NewExampleToken` appears in the same locations.

**Risks:** Accidental replacement outside the approved file or context.

**Dependencies:** None.

**Verification expectations:** Confirm the approved before/after token replacement in the named file.

**Replace:** `OldExampleToken`
**With:** `NewExampleToken`
```

Omit `**Mode:** mechanical` for any task with judgment (TDD step pairs, multi-file coordinated changes, new modules or public interfaces). Default plans without that field continue to dispatch with the full implementer template — the field is purely additive.

### Optional Review-Routing Hint Fields

Tasks may include these fields after optional `**Mode:** mechanical` and
before `**Files:**`:

```markdown
**Risk hint:** low | medium | high
**Review hint:** none-final-only | spec-only | spec-and-quality
**Review rationale:** <one sentence naming why this route is safe or why full review is required>
```

These fields are non-authoritative hints only. `play-subagent-execution`
owns reviewer dispatch, may override any hint, and defaults unclear cases to
`spec-and-quality`.

Use `**Risk hint:** high` and `**Review hint:** spec-and-quality` whenever
any hard-risk trigger may apply. Do not mark foundation-producing tasks below
`spec-only`, because dependent tasks need at least per-task spec review before
they start.

## No Placeholders

Every task spec must contain the actual contract an engineer needs. These are
**plan failures** — never write them:

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" without naming the behavior and verification expectation
- "Similar to Task N" without restating the task-specific contract
- Tasks that describe desired change without purpose, boundaries, acceptance criteria, authority surfaces, or verification expectations
- References to source-of-truth files, functions, methods, ADRs, specs, or helpers that do not exist unless the task is explicitly responsible for creating them
- Required contract checklist fields left blank, marked only `N/A`, or filled
  with generic text that does not explain the task-specific reason

## Remember

- Exact file paths always
- Complete task contracts, not implementation sketches
- Contract checklists for triggered work, or a task-specific reason the
  checklist does not apply
- Source-of-truth references over copied logic
- Authority surfaces and dependencies made explicit
- Verification expectations without command recipes

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Task-spec contract:** Does every task include purpose, goal, non-goals,
acceptance criteria, risks, dependencies, source-of-truth references, authority
surfaces, and verification expectations? Fix any missing field.

**4. Contract-heavy table check:** If the work depends on cross-skill
handoffs, generated or derived paths, helper scripts, source-owned policy,
schema or interface authority, execution cwd assumptions, or fail-closed
behavior, does the plan include a short contract table covering the applicable
surfaces? Fix missing contract surfaces before task planning.

**5. Contract checklist trigger check:** For every task, determine whether any
non-trivial trigger applies. Triggered tasks must name the trigger criteria and
include owner/authority, affected consumers/generated outputs, must-preserve,
required behavior, spec/procedure work, risk surfaces, and proof obligations.
Trivial tasks may omit the checklist only when they state why no trigger applies.

**6. Contract checklist completeness:** For every required checklist, confirm
each field is populated or marked `N/A` with a task-specific reason. Blank
fields, unreplaced placeholders, and unexplained `N/A` entries are failures.
If owner, authority, source of truth, or evidence cannot be identified, the plan
must name the blocker or assumption instead of inventing a contract.

**7. Prohibited detail scan:** Confirm the plan does not include concrete
implementation code, test code, plan-authored test bodies, shell snippets,
shell recipes, exact command sequences, helper-name prescriptions, line-number
edits, or commit recipes unless the content is explicitly labeled as
already-approved verbatim artifact content with an authority source.

**8. Citation verification:** For any task reference that purports to cite
existing code, files, behavior, docs, history, issue or PR numbers, ADRs,
helpers, or generated paths, verify the cited artifact exists and supports the
claim. Forward-looking files in `Files: Create:` blocks are not subject to this
check. Concrete-looking specifics that turn out to be fabricated are the most
common silent defect class in plans.

**9. Documentation impact tasks:** Same-PR documentation impact is normal
implementation work when the design changes durable truth. AFDS repositories
should provide the canonical trigger list at
`docs/guidelines/documentation-standard.md` §5.2; common examples include
interfaces or schemas, major paths or layout, behavior, workflow, commands,
ownership, verification, architecture, and policy. If the target repository has
not adopted that path, use its discovered equivalent documentation standard
before applying same-PR triggers. If the input design has a "Documentation
impact" section, every listed file must have a corresponding task in the plan.
New ADRs use `docs/adr/adr-template.md` as the source. For routing boundaries,
follow
`docs/guidelines/portable-afds-user-procedure-map.md`.

Do not turn issue comments, PR review history, validation logs, or agent-local plans into repository documentation. Those artifacts can be evidence for the owning durable update, but the plan must write durable truth in the owning source, spec, guideline, ADR, architecture doc, or agent entry point instead of copying live work history.

**10. Mechanical-task hint check:** For each task that fits the mechanical taxonomy (single-file create from verbatim content; unambiguous identifier replacement — see [`skills/play-subagent-execution/SKILL.md` § Mechanical Task Taxonomy](../play-subagent-execution/SKILL.md#mechanical-task-taxonomy)), confirm `**Mode:** mechanical` is set. For any task with judgment (TDD expectations, multi-file coordination, new modules/interfaces), confirm it is **not** set.

**11. Review-routing hint check:** If tasks include review-routing hints,
confirm hard-risk triggers are not under-classified, hints are described as
non-authoritative, unclear cases default to `spec-and-quality`, and
foundation-producing tasks are not marked below `spec-only`. The field order
must be heading, optional `**Mode:** mechanical`, optional review-routing hint
fields, then `**Files:**`.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

## Plan Review

After self-review, dispatch a dedicated `{{model:deep}}` agent to validate plan-vs-spec alignment before offering execution options. This catches spec coverage gaps and scope drift that self-review may miss.

Before dispatching the plan-review agent, use `subagent-lifecycle` for the
controller-local lifecycle ledger, target lifecycle capability classification,
cleanup gate before spawns, target-honest cleanup outcomes, and slot-limit
recovery. Capture the plan-review session's role-specific state before
closing or superseding it: plan path or inline plan scope, source spec/design
scope, PASS/FAIL result, confidence notes, and specific gaps when present.

**Subagent contract:**

- **Model:** `{{model:deep}}`
- **Input:** The full plan document + the original spec/design document
- **Role:** Independent validation of plan completeness and spec alignment

**The subagent checks:**

- Every spec requirement maps to at least one task
- No tasks that aren't justified by the spec (scope creep)
- Task ordering respects dependencies
- Verification expectations exist and cover acceptance criteria
- File paths reference real locations (the agent can search, pattern-match, and read project files to verify)
- No placeholder violations (catches what self-review missed)
- Contract-heavy work includes the applicable contract table surfaces before
  task planning
- The contract checklist is present for every triggered task, or the task gives
  a specific reason no trigger applies
- Required checklist fields cover trigger criteria, owner/authority,
  must-preserve boundaries, affected consumers/generated outputs, required
  behavior including state and failure behavior, spec/procedure work, risk
  surfaces, and proof obligations
- Every checklist field is populated or marked `N/A` with a task-specific
  reason; blank fields, unreplaced placeholders, and unexplained `N/A` entries
  are failures
- Unknown owner, authority, source-of-truth, or evidence surfaces are named as
  blockers or assumptions rather than invented
- Tasks include purpose, goal, non-goals, acceptance criteria, risks,
  dependencies, source-of-truth references, authority surfaces, and
  verification expectations
- The plan does not include concrete implementation code, test code,
  plan-authored test bodies, shell snippets, shell recipes, exact command
  sequences, helper-name prescriptions, line-number edits, or commit recipes
  unless explicitly labeled as already-approved verbatim artifact content with
  an authority source
- Task specs prefer references to existing behavior and source-of-truth files
  over copied logic
- Every "Documentation impact" item from the issue, design, or owning source
  artifact maps to at least one task in the plan
- Review-routing hints, when present, are non-authoritative inputs to
  `play-subagent-execution`
- Hard-risk triggers from `skills/play-subagent-execution/SKILL.md` §
  Risk-Based Per-Task Review Routing are not under-classified
- Unclear review classification defaults to `spec-and-quality`
- Foundation-producing tasks are not marked below `spec-only`
- Hint field ordering is heading, optional `**Mode:** mechanical`, optional
  review-routing hint fields, then `**Files:**`

**Output:** PASS with confidence notes, or FAIL with specific gaps listed.

**On FAIL:** Fix the identified gaps inline in the plan and re-run the review subagent. Maximum 2 review rounds. If the plan still fails after 2 rounds, present remaining concerns to the user and let them decide whether to proceed.

**In `--auto` flows** (e.g., `github-issue-priming --auto`): A PASS hands off to the parent skill (which invokes `play-subagent-execution` per the Execution Handoff section below); `play-planning` itself does not start execution. A FAIL after 2 rounds stops and reports to the user.

## Execution Handoff

**In `--auto` flows** (e.g., `github-issue-priming --auto`): do NOT prompt for an execution mode. Return after saving the plan so the parent skill can invoke `play-subagent-execution`. The parent skill receives the plan path from the `Plan written to <path>.` notice line emitted after the save and passes it to `play-subagent-execution` as `Plan: <path>`.

Otherwise, offer execution choice:

**"Plan complete and saved to `.ephemeral/<filename>.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I invoke play-subagent-execution for fresh subagents per task and executor-owned risk-based review routing

**2. Inline Execution** - Execute tasks in this session, batch execution with checkpoints

**Which approach?"**

**If Subagent-Driven chosen:**

- **REQUIRED SUB-SKILL:** Use play-subagent-execution
- Fresh subagent per task + executor-owned risk-based per-task review routing. Reduced routes require the verified shared `issue-priming-workflow --auto` Phase 6 path with controller-local parent state and a valid `issue-priming/auto-handoff/v1` artifact for the final whole-diff gate; otherwise execution fails closed to `spec-and-quality`.

**If Inline Execution chosen:**

- Execute tasks sequentially in this session with review checkpoints
