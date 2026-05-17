---
name: play-planning
description: Writes a comprehensive implementation plan as bite-sized tasks for an engineer with no codebase context, saved to `.ephemeral/`. Use when working from a spec or design for a multi-step task, before touching code. Do not use to brainstorm requirements — start with play-brainstorm.
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Save plans to:** `.ephemeral/YYYY-MM-DD-<feature-name>-plan.md`.
Before the `Write` tool call, compute the path and apply the canonical
`.ephemeral` write guard:

```bash
PLAN_PATH=".ephemeral/$(date +%F)-<feature-name>-plan.md"
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
mkdir -p .ephemeral
[ -L "$PLAN_PATH" ] && rm "$PLAN_PATH"
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
[ -r "$DESIGN_PATH" ] || { echo "design missing or unreadable: $DESIGN_PATH" >&2; exit 1; }
```

This bash follows the same suffix and traversal checks used by the repository's
phase-artifact handoff guards, narrowed to the design-document suffix.
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

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

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

Composition changes task boundaries, not step quality. A composed task still
uses exact executable checkbox steps with code, commands, and expected output.
Do not replace executable checkbox steps with vague high-level subtasks.

Do not compose unrelated work just to reduce dispatch count. Do not hide dependent implementation units merely to avoid multi-task review. If separate
units need independent review, rollback, or verification, keep them as separate tasks.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**

- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use play-subagent-execution (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

## Commit Messages

When writing commit steps in plans, glob for `**/commit-guideline*.md` in the repository. If found, follow its header format, allowed types, and scope rules in all commit message examples. If no guideline is found, default to Conventional Commits: `type(scope): subject`.

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**

- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

### Optional `**Mode:**` field

Tasks that fit the mechanical taxonomy may include `**Mode:** mechanical` between the heading and any review-routing hint fields. The taxonomy (positive and negative examples) lives in [`skills/play-subagent-execution/SKILL.md` § Mechanical Task Taxonomy](../play-subagent-execution/SKILL.md#mechanical-task-taxonomy) — consult it before setting the hint.

Example mechanical-task header:

```markdown
### Task N: Rename Example Token

**Mode:** mechanical

**Risk hint:** low
**Review hint:** none-final-only
**Review rationale:** Exact single-file identifier replacement with no hard-risk trigger; final whole-diff review remains required.

**Files:**

- Modify: `examples/demo-note.md`

**Replace:** `OldExampleToken`
**With:** `NewExampleToken`
```

Omit the field for any task with judgment (TDD step pairs, multi-file coordinated changes, new modules or public interfaces). Default plans without the field continue to dispatch with the full implementer template — the field is purely additive.

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

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Remember

- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

**4. Example verification:** For any worked example, code snippet annotation, or scenario reference _that purports to cite existing code, files, or history_ in the plan that names a specific file path, line number, function name, identifier, command, commit SHA, or PR number — open the file (or run `git log` / `git show` / `gh pr view <N>`) and confirm the cited artifact exists and contains the cited text. Forward-looking task definitions (new files in `Files: Create:` blocks, function names being introduced) are not subject to this check. A scenario explicitly labeled `(hypothetical)` is exempt. A scenario labeled "from PR #N" or citing a real file path is **not** exempt — verify it. Concrete-looking specifics that turn out to be fabricated are the most common silent defect class in worked examples. Note: this complements the existing Plan Review subagent, which independently checks that file paths in the plan reference real locations; this self-review item additionally verifies citations inside worked examples and prose.

**5. Documentation impact tasks:** Same-PR documentation impact is normal
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

**6. Mechanical-task hint check:** For each task that fits the mechanical taxonomy (single-file create from verbatim content; unambiguous identifier replacement — see [`skills/play-subagent-execution/SKILL.md` § Mechanical Task Taxonomy](../play-subagent-execution/SKILL.md#mechanical-task-taxonomy)), confirm `**Mode:** mechanical` is set. For any task with judgment (TDD step pairs, multi-file coordination, new modules/interfaces), confirm it is **not** set.

**7. Review-routing hint check:** If tasks include review-routing hints,
confirm hard-risk triggers are not under-classified, hints are described as
non-authoritative, unclear cases default to `spec-and-quality`, and
foundation-producing tasks are not marked below `spec-only`. The field order
must be heading, optional `**Mode:** mechanical`, optional review-routing hint
fields, then `**Files:**`.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

## Plan Review

After self-review, dispatch a dedicated `{{model:deep}}` agent to validate plan-vs-spec alignment before offering execution options. This catches spec coverage gaps and scope drift that self-review may miss.

**Subagent contract:**

- **Model:** `{{model:deep}}`
- **Input:** The full plan document + the original spec/design document
- **Role:** Independent validation of plan completeness and spec alignment

**The subagent checks:**

- Every spec requirement maps to at least one task
- No tasks that aren't justified by the spec (scope creep)
- Task ordering respects dependencies
- Verification commands exist and cover acceptance criteria
- File paths reference real locations (the agent can search, pattern-match, and read project files to verify)
- No placeholder violations (catches what self-review missed)
- Every "Documentation impact" item from the design (if the section exists) maps to at least one task in the plan
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
