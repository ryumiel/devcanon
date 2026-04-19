# Play Skills Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `play-subagent-execution` (recommended) or `play-planning` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt 10 methodology skills from Superpowers into the agents-manager skill library with `play-` prefix, moderate adaptations, and cross-reference updates.

**Architecture:** Copy each skill's SKILL.md and supporting files from `D:\workspace\superpowers\skills\` to `D:\workspace\agent-manager\skills\play-*\`. Apply common adaptations (rename, cross-ref updates, remove Superpowers-specific content) and per-skill adaptations (remove visual companion, wire to local skills, etc.). Update 3 existing skills that reference `superpowers:*`.

**Tech Stack:** Markdown (SKILL.md files), shell scripts, TypeScript examples

---

## File Structure

```
skills/
  play-brainstorm/
    SKILL.md                              # Adapted from brainstorming/SKILL.md
    spec-document-reviewer-prompt.md      # Copied verbatim

  play-planning/
    SKILL.md                              # Adapted from writing-plans/SKILL.md
    plan-document-reviewer-prompt.md      # Copied verbatim

  play-subagent-execution/
    SKILL.md                              # Adapted from subagent-driven-development/SKILL.md
    implementer-prompt.md                 # Copied verbatim
    spec-reviewer-prompt.md               # Copied verbatim
    code-quality-reviewer-prompt.md       # Adapted (update skill refs)

  play-verification/
    SKILL.md                              # Adapted from verification-before-completion/SKILL.md

  play-branch-finish/
    SKILL.md                              # Adapted from finishing-a-development-branch/SKILL.md

  play-debug/
    SKILL.md                              # Adapted from systematic-debugging/SKILL.md
    root-cause-tracing.md                 # Copied from systematic-debugging/
    defense-in-depth.md                   # Copied from systematic-debugging/
    condition-based-waiting.md            # Copied from systematic-debugging/
    condition-based-waiting-example.ts    # Copied from systematic-debugging/
    find-polluter.sh                      # Copied from systematic-debugging/

  play-skill-authoring/
    SKILL.md                              # Adapted from writing-skills/SKILL.md
    anthropic-best-practices.md           # Copied from writing-skills/
    persuasion-principles.md              # Copied from writing-skills/
    testing-skills-with-subagents.md      # Adapted (update skill refs)
    graphviz-conventions.dot              # Copied from writing-skills/
    render-graphs.js                      # Copied from writing-skills/
    examples/
      CLAUDE_MD_TESTING.md               # Copied from writing-skills/examples/
      test-academic.md                   # Copied from systematic-debugging/
      test-pressure-1.md                 # Copied from systematic-debugging/
      test-pressure-2.md                 # Copied from systematic-debugging/
      test-pressure-3.md                 # Copied from systematic-debugging/

  play-agent-dispatch/
    SKILL.md                              # Adapted from dispatching-parallel-agents/SKILL.md

  play-tdd/
    SKILL.md                              # Adapted from test-driven-development/SKILL.md
    testing-anti-patterns.md              # Copied from test-driven-development/

  play-review-response/
    SKILL.md                              # Adapted from receiving-code-review/SKILL.md
```

---

## Common Adaptations (Applied to Every SKILL.md)

These changes apply to ALL adopted SKILL.md files. Each task below assumes these are done:

1. **Frontmatter `name:`** -- change to `play-*` name
2. **Cross-references** -- replace `superpowers:*` with local `play-*` names:
   - `superpowers:test-driven-development` -> `play-tdd`
   - `superpowers:writing-plans` -> `play-planning`
   - `superpowers:brainstorming` -> `play-brainstorm`
   - `superpowers:subagent-driven-development` -> `play-subagent-execution`
   - `superpowers:finishing-a-development-branch` -> `play-branch-finish`
   - `superpowers:verification-before-completion` -> `play-verification`
   - `superpowers:systematic-debugging` -> `play-debug`
   - `superpowers:requesting-code-review` -> `branch-review`
   - `superpowers:receiving-code-review` -> `play-review-response`
   - `superpowers:executing-plans` -> `play-planning` (executing-plans not adopted; redirect to planning)
   - `superpowers:using-git-worktrees` -> remove or replace with generic git worktree guidance
   - `superpowers:writing-skills` -> `play-skill-authoring`
   - `superpowers:dispatching-parallel-agents` -> `play-agent-dispatch`
   - `superpowers:code-reviewer` -> `branch-review` (agent, not skill)
3. **Remove platform notes** -- delete references to Cursor, Gemini CLI, Copilot CLI, OpenCode
4. **Remove Superpowers plugin context** -- delete plugin installation, upstream contribution guidance
5. **Replace "your human partner"** with "the user" throughout
6. **Soften "Iron Law" phrasing** -- change `## The Iron Law` to `## The Rule`, keep the rule content

---

### Task 1: play-verification

**Files:**

- Create: `skills/play-verification/SKILL.md`
- Source: `D:\workspace\superpowers\skills\verification-before-completion\SKILL.md`

This skill is the simplest -- nearly verbatim adoption with only common adaptations.

- [ ] **Step 1: Copy source file**

```bash
mkdir -p skills/play-verification
cp D:/workspace/superpowers/skills/verification-before-completion/SKILL.md skills/play-verification/SKILL.md
```

- [ ] **Step 2: Apply common adaptations**

In `skills/play-verification/SKILL.md`:

1. Change frontmatter:

   ```yaml
   ---
   name: play-verification
   description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
   ---
   ```

2. Replace `## The Iron Law` with `## The Rule`

3. Replace all occurrences of `your human partner` with `the user`

4. In "Why This Matters" section, replace `your human partner said "I don't believe you"` with `the user said "I don't believe you"`

- [ ] **Step 3: Validate**

```bash
pnpm run dev -- validate
```

Expected: All skills valid (count increases by 1).

- [ ] **Step 4: Commit**

```bash
git add skills/play-verification/
git commit -m "feat(skills): add play-verification skill

Adopted from superpowers:verification-before-completion.
Quality gate: evidence before completion claims."
```

---

### Task 2: play-debug

**Files:**

- Create: `skills/play-debug/SKILL.md`
- Copy: `skills/play-debug/root-cause-tracing.md`
- Copy: `skills/play-debug/defense-in-depth.md`
- Copy: `skills/play-debug/condition-based-waiting.md`
- Copy: `skills/play-debug/condition-based-waiting-example.ts`
- Copy: `skills/play-debug/find-polluter.sh`
- Source: `D:\workspace\superpowers\skills\systematic-debugging\`

- [ ] **Step 1: Copy all files**

```bash
mkdir -p skills/play-debug
cp D:/workspace/superpowers/skills/systematic-debugging/SKILL.md skills/play-debug/SKILL.md
cp D:/workspace/superpowers/skills/systematic-debugging/root-cause-tracing.md skills/play-debug/
cp D:/workspace/superpowers/skills/systematic-debugging/defense-in-depth.md skills/play-debug/
cp D:/workspace/superpowers/skills/systematic-debugging/condition-based-waiting.md skills/play-debug/
cp D:/workspace/superpowers/skills/systematic-debugging/condition-based-waiting-example.ts skills/play-debug/
cp D:/workspace/superpowers/skills/systematic-debugging/find-polluter.sh skills/play-debug/
```

Do NOT copy: `CREATION-LOG.md`, `test-academic.md`, `test-pressure-*.md` (those go to play-skill-authoring).

- [ ] **Step 2: Apply common adaptations to SKILL.md**

1. Change frontmatter:

   ```yaml
   ---
   name: play-debug
   description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
   ---
   ```

2. Replace `## The Iron Law` with `## The Rule`

3. Replace all `your human partner` with `the user` (appears in sections: "Phase 4 Step 5", "your human partner's Signals", "Common Rationalizations")

4. In "Related skills" section at end, update:
   - `superpowers:test-driven-development` -> `play-tdd`
   - `superpowers:verification-before-completion` -> `play-verification`

5. In Phase 4 Step 1, update:
   - `Use the superpowers:test-driven-development skill` -> `Use the play-tdd skill`

- [ ] **Step 3: Validate**

```bash
pnpm run dev -- validate
```

- [ ] **Step 4: Commit**

```bash
git add skills/play-debug/
git commit -m "feat(skills): add play-debug skill

Adopted from superpowers:systematic-debugging.
Four-phase root-cause investigation with supporting techniques."
```

---

### Task 3: play-agent-dispatch

**Files:**

- Create: `skills/play-agent-dispatch/SKILL.md`
- Source: `D:\workspace\superpowers\skills\dispatching-parallel-agents\SKILL.md`

- [ ] **Step 1: Copy source file**

```bash
mkdir -p skills/play-agent-dispatch
cp D:/workspace/superpowers/skills/dispatching-parallel-agents/SKILL.md skills/play-agent-dispatch/SKILL.md
```

- [ ] **Step 2: Apply common adaptations**

1. Change frontmatter:

   ```yaml
   ---
   name: play-agent-dispatch
   description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
   ---
   ```

2. No `superpowers:*` references to update in this file.

3. No `your human partner` references in this file.

- [ ] **Step 3: Validate**

```bash
pnpm run dev -- validate
```

- [ ] **Step 4: Commit**

```bash
git add skills/play-agent-dispatch/
git commit -m "feat(skills): add play-agent-dispatch skill

Adopted from superpowers:dispatching-parallel-agents.
Parallel agent delegation for independent problem domains."
```

---

### Task 4: play-review-response

**Files:**

- Create: `skills/play-review-response/SKILL.md`
- Source: `D:\workspace\superpowers\skills\receiving-code-review\SKILL.md`

- [ ] **Step 1: Copy source file**

```bash
mkdir -p skills/play-review-response
cp D:/workspace/superpowers/skills/receiving-code-review/SKILL.md skills/play-review-response/SKILL.md
```

- [ ] **Step 2: Apply common adaptations**

1. Change frontmatter:

   ```yaml
   ---
   name: play-review-response
   description: Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable - requires technical rigor and verification, not performative agreement or blind implementation
   ---
   ```

2. Replace all `your human partner` with `the user` (appears in multiple sections: "Source-Specific Handling", "YAGNI Check", examples, etc.)

3. Replace `your human partner's rule:` with `Rule:` in two places

4. In "Signal if uncomfortable" line, keep the Circle K reference as-is (it's a cultural reference, harmless)

- [ ] **Step 3: Validate**

```bash
pnpm run dev -- validate
```

- [ ] **Step 4: Commit**

```bash
git add skills/play-review-response/
git commit -m "feat(skills): add play-review-response skill

Adopted from superpowers:receiving-code-review.
Technical rigor for responding to code review feedback."
```

---

### Task 5: play-tdd

**Files:**

- Create: `skills/play-tdd/SKILL.md`
- Copy: `skills/play-tdd/testing-anti-patterns.md`
- Source: `D:\workspace\superpowers\skills\test-driven-development\`

- [ ] **Step 1: Copy files**

```bash
mkdir -p skills/play-tdd
cp D:/workspace/superpowers/skills/test-driven-development/SKILL.md skills/play-tdd/SKILL.md
cp D:/workspace/superpowers/skills/test-driven-development/testing-anti-patterns.md skills/play-tdd/
```

- [ ] **Step 2: Apply common adaptations to SKILL.md**

1. Change frontmatter:

   ```yaml
   ---
   name: play-tdd
   description: Use when implementing any feature or bugfix, before writing implementation code
   ---
   ```

2. Replace `## The Iron Law` with `## The Rule`

3. Replace all `your human partner` with `the user` (appears in: "Exceptions", "When Stuck", "Final Rule")

4. Soften the "delete" rule in "The Rule" section. Change:

   ```
   Write code before the test? Delete it. Start over.
   ```

   to:

   ```
   Write code before the test? Strongly consider deleting it and starting over.
   ```

5. Similarly soften the "No exceptions" block. Change:
   ```
   **No exceptions:**
   - Don't keep it as "reference"
   - Don't "adapt" it while writing tests
   - Don't look at it
   - Delete means delete
   ```
   to:
   ```
   **Strong defaults:**
   - Don't keep it as "reference"
   - Don't "adapt" it while writing tests
   - Implement fresh from tests when possible
   ```

- [ ] **Step 3: Validate**

```bash
pnpm run dev -- validate
```

- [ ] **Step 4: Commit**

```bash
git add skills/play-tdd/
git commit -m "feat(skills): add play-tdd skill

Adopted from superpowers:test-driven-development.
Red-green-refactor cycle with testing anti-patterns reference."
```

---

### Task 6: play-brainstorm

**Files:**

- Create: `skills/play-brainstorm/SKILL.md`
- Copy: `skills/play-brainstorm/spec-document-reviewer-prompt.md`
- Source: `D:\workspace\superpowers\skills\brainstorming\`

- [ ] **Step 1: Copy files**

```bash
mkdir -p skills/play-brainstorm
cp D:/workspace/superpowers/skills/brainstorming/SKILL.md skills/play-brainstorm/SKILL.md
cp D:/workspace/superpowers/skills/brainstorming/spec-document-reviewer-prompt.md skills/play-brainstorm/
```

Do NOT copy: `visual-companion.md`, `scripts/` directory.

- [ ] **Step 2: Apply adaptations to SKILL.md**

1. Change frontmatter:

   ```yaml
   ---
   name: play-brainstorm
   description: Use before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation.
   ---
   ```

2. In the **Checklist** section, remove item 2 (visual companion offer). Renumber remaining items 1-8:

   ```
   1. Explore project context
   2. Ask clarifying questions
   3. Propose 2-3 approaches
   4. Present design
   5. Write design doc
   6. Spec self-review
   7. User reviews written spec
   8. Transition to implementation
   ```

3. In the **Process Flow** graphviz, remove the `"Visual questions ahead?"` diamond node and the `"Offer Visual Companion..."` box node. Connect `"Explore project context"` directly to `"Ask clarifying questions"`.

4. Update the graphviz terminal node label:
   - `"Invoke writing-plans skill"` -> `"Invoke play-planning skill"`

5. Replace the line:

   ```
   **The terminal state is invoking writing-plans.** Do NOT invoke frontend-design, mcp-builder, or any other implementation skill. The ONLY skill you invoke after brainstorming is writing-plans.
   ```

   with:

   ```
   **The terminal state is invoking play-planning.** Do NOT invoke any other implementation skill. The ONLY skill you invoke after brainstorming is play-planning.
   ```

6. In **Documentation** section, change spec path:

   ```
   Write the validated design (spec) to `docs/specs/YYYY-MM-DD-<topic>-design.md`
   ```

7. Remove the line about `elements-of-style:writing-clearly-and-concisely` skill.

8. In **Implementation** section:
   - `Invoke the writing-plans skill` -> `Invoke the play-planning skill`

9. Delete the entire **Visual Companion** section (lines 147-164 in source).

10. In `spec-document-reviewer-prompt.md`, update:
    - `docs/superpowers/specs/` -> `docs/specs/`

- [ ] **Step 3: Validate**

```bash
pnpm run dev -- validate
```

- [ ] **Step 4: Commit**

```bash
git add skills/play-brainstorm/
git commit -m "feat(skills): add play-brainstorm skill

Adopted from superpowers:brainstorming.
Idea-to-design via collaborative dialogue with spec self-review."
```

---

### Task 7: play-planning

**Files:**

- Create: `skills/play-planning/SKILL.md`
- Copy: `skills/play-planning/plan-document-reviewer-prompt.md`
- Source: `D:\workspace\superpowers\skills\writing-plans\`

- [ ] **Step 1: Copy files**

```bash
mkdir -p skills/play-planning
cp D:/workspace/superpowers/skills/writing-plans/SKILL.md skills/play-planning/SKILL.md
cp D:/workspace/superpowers/skills/writing-plans/plan-document-reviewer-prompt.md skills/play-planning/
```

- [ ] **Step 2: Apply adaptations to SKILL.md**

1. Change frontmatter:

   ```yaml
   ---
   name: play-planning
   description: Use when you have a spec or requirements for a multi-step task, before touching code
   ---
   ```

2. Change plan output path:

   ```
   **Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md`
   ```

3. In **Plan Document Header**, update the agentic worker note:

   ```
   > **For agentic workers:** REQUIRED SUB-SKILL: Use play-subagent-execution (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
   ```

4. In **Execution Handoff**, update:
   - Option 1 text: `play-subagent-execution` instead of `superpowers:subagent-driven-development`
   - Option 2 text: remove the executing-plans reference (not adopted), keep as "Inline Execution - Execute tasks in this session"
   - `**REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development` -> `**REQUIRED SUB-SKILL:** Use play-subagent-execution`
   - `**REQUIRED SUB-SKILL:** Use superpowers:executing-plans` -> remove (inline execution needs no sub-skill)

5. Remove the `**Context:** This should be run in a dedicated worktree` line.

- [ ] **Step 3: Validate**

```bash
pnpm run dev -- validate
```

- [ ] **Step 4: Commit**

```bash
git add skills/play-planning/
git commit -m "feat(skills): add play-planning skill

Adopted from superpowers:writing-plans.
Spec-to-implementation plan with bite-sized task decomposition."
```

---

### Task 8: play-subagent-execution

**Files:**

- Create: `skills/play-subagent-execution/SKILL.md`
- Copy: `skills/play-subagent-execution/implementer-prompt.md`
- Copy: `skills/play-subagent-execution/spec-reviewer-prompt.md`
- Create: `skills/play-subagent-execution/code-quality-reviewer-prompt.md` (adapted)
- Source: `D:\workspace\superpowers\skills\subagent-driven-development\`

- [ ] **Step 1: Copy files**

```bash
mkdir -p skills/play-subagent-execution
cp D:/workspace/superpowers/skills/subagent-driven-development/SKILL.md skills/play-subagent-execution/SKILL.md
cp D:/workspace/superpowers/skills/subagent-driven-development/implementer-prompt.md skills/play-subagent-execution/
cp D:/workspace/superpowers/skills/subagent-driven-development/spec-reviewer-prompt.md skills/play-subagent-execution/
cp D:/workspace/superpowers/skills/subagent-driven-development/code-quality-reviewer-prompt.md skills/play-subagent-execution/
```

- [ ] **Step 2: Apply adaptations to SKILL.md**

1. Change frontmatter:

   ```yaml
   ---
   name: play-subagent-execution
   description: Use when executing implementation plans with independent tasks in the current session
   ---
   ```

2. In process flow graphviz, update:
   - `"Use superpowers:finishing-a-development-branch"` -> `"Use play-branch-finish"`

3. In example workflow, update:
   - `docs/superpowers/plans/feature-plan.md` -> `docs/plans/feature-plan.md`

4. In **Integration** section, update all references:

   ```
   **Required workflow skills:**
   - **play-planning** - Creates the plan this skill executes
   - **branch-review** - Code review for reviewer subagents
   - **play-branch-finish** - Complete development after all tasks

   **Subagents should use:**
   - **play-tdd** - Subagents follow TDD for each task
   ```

5. Remove the `superpowers:using-git-worktrees` reference and the `superpowers:executing-plans` alternative reference.

6. Replace `your human partner` with `the user` in "Handling Implementer Status" BLOCKED section.

- [ ] **Step 3: Apply adaptations to code-quality-reviewer-prompt.md**

Update the dispatch template:

- `Task tool (superpowers:code-reviewer):` -> `Task tool (general-purpose):`
- `Use template at requesting-code-review/code-reviewer.md` -> remove this line
- Keep the WHAT_WAS_IMPLEMENTED, PLAN_OR_REQUIREMENTS, BASE_SHA, HEAD_SHA, DESCRIPTION fields

- [ ] **Step 4: Validate**

```bash
pnpm run dev -- validate
```

- [ ] **Step 5: Commit**

```bash
git add skills/play-subagent-execution/
git commit -m "feat(skills): add play-subagent-execution skill

Adopted from superpowers:subagent-driven-development.
Execute plans via fresh subagents with two-stage review."
```

---

### Task 9: play-branch-finish

**Files:**

- Create: `skills/play-branch-finish/SKILL.md`
- Source: `D:\workspace\superpowers\skills\finishing-a-development-branch\SKILL.md`

- [ ] **Step 1: Copy source file**

```bash
mkdir -p skills/play-branch-finish
cp D:/workspace/superpowers/skills/finishing-a-development-branch/SKILL.md skills/play-branch-finish/SKILL.md
```

- [ ] **Step 2: Apply adaptations**

1. Change frontmatter:

   ```yaml
   ---
   name: play-branch-finish
   description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides completion of development work by presenting structured options for merge, PR, or cleanup
   ---
   ```

2. Update announce text:
   - `"I'm using the finishing-a-development-branch skill"` -> `"I'm using the play-branch-finish skill"`

3. In **Integration** section, update:

   ```
   **Called by:**
   - **play-subagent-execution** - After all tasks complete

   **Pairs with:**
   - **pr-merge** - For CI-gated merge after PR creation (Option 2)
   ```

- [ ] **Step 3: Validate**

```bash
pnpm run dev -- validate
```

- [ ] **Step 4: Commit**

```bash
git add skills/play-branch-finish/
git commit -m "feat(skills): add play-branch-finish skill

Adopted from superpowers:finishing-a-development-branch.
Branch completion with structured merge/PR/cleanup options."
```

---

### Task 10: play-skill-authoring

**Files:**

- Create: `skills/play-skill-authoring/SKILL.md`
- Copy: `skills/play-skill-authoring/anthropic-best-practices.md`
- Copy: `skills/play-skill-authoring/persuasion-principles.md`
- Create: `skills/play-skill-authoring/testing-skills-with-subagents.md` (adapted)
- Copy: `skills/play-skill-authoring/graphviz-conventions.dot`
- Copy: `skills/play-skill-authoring/render-graphs.js`
- Copy: `skills/play-skill-authoring/examples/CLAUDE_MD_TESTING.md`
- Copy: `skills/play-skill-authoring/examples/test-academic.md`
- Copy: `skills/play-skill-authoring/examples/test-pressure-1.md`
- Copy: `skills/play-skill-authoring/examples/test-pressure-2.md`
- Copy: `skills/play-skill-authoring/examples/test-pressure-3.md`
- Source: `D:\workspace\superpowers\skills\writing-skills\` and `D:\workspace\superpowers\skills\systematic-debugging\`

- [ ] **Step 1: Copy files**

```bash
mkdir -p skills/play-skill-authoring/examples
cp D:/workspace/superpowers/skills/writing-skills/SKILL.md skills/play-skill-authoring/SKILL.md
cp D:/workspace/superpowers/skills/writing-skills/anthropic-best-practices.md skills/play-skill-authoring/
cp D:/workspace/superpowers/skills/writing-skills/persuasion-principles.md skills/play-skill-authoring/
cp D:/workspace/superpowers/skills/writing-skills/testing-skills-with-subagents.md skills/play-skill-authoring/
cp D:/workspace/superpowers/skills/writing-skills/graphviz-conventions.dot skills/play-skill-authoring/
cp D:/workspace/superpowers/skills/writing-skills/render-graphs.js skills/play-skill-authoring/
cp D:/workspace/superpowers/skills/writing-skills/examples/CLAUDE_MD_TESTING.md skills/play-skill-authoring/examples/
cp D:/workspace/superpowers/skills/systematic-debugging/test-academic.md skills/play-skill-authoring/examples/
cp D:/workspace/superpowers/skills/systematic-debugging/test-pressure-1.md skills/play-skill-authoring/examples/
cp D:/workspace/superpowers/skills/systematic-debugging/test-pressure-2.md skills/play-skill-authoring/examples/
cp D:/workspace/superpowers/skills/systematic-debugging/test-pressure-3.md skills/play-skill-authoring/examples/
```

- [ ] **Step 2: Apply adaptations to SKILL.md**

1. Change frontmatter:

   ```yaml
   ---
   name: play-skill-authoring
   description: Use when creating new skills, editing existing skills, or verifying skills work before deployment
   ---
   ```

2. Replace `## The Iron Law (Same as TDD)` with `## The Rule (Same as TDD)`

3. Update all `superpowers:*` references:
   - `superpowers:test-driven-development` -> `play-tdd`
   - `superpowers:systematic-debugging` -> `play-debug`

4. In "Personal skills" line, keep as-is (already correct: `~/.claude/skills`, `~/.agents/skills/`)

5. In "Deployment" checklist, add:

   ```
   - [ ] Run `agents-manager validate` to verify skill structure
   ```

6. Replace `your human partner` with `the user` if it appears.

7. In "Cross-Referencing Other Skills" section, update examples:
   - `superpowers:test-driven-development` -> `play-tdd`
   - `superpowers:systematic-debugging` -> `play-debug`

- [ ] **Step 3: Apply adaptations to testing-skills-with-subagents.md**

Update all `superpowers:*` references:

- `superpowers:test-driven-development` -> `play-tdd`

- [ ] **Step 4: Validate**

```bash
pnpm run dev -- validate
```

- [ ] **Step 5: Commit**

```bash
git add skills/play-skill-authoring/
git commit -m "feat(skills): add play-skill-authoring skill

Adopted from superpowers:writing-skills with pressure test examples
from systematic-debugging. TDD-based skill creation methodology."
```

---

### Task 11: Update existing skill cross-references

**Files:**

- Modify: `skills/github-issue-priming/SKILL.md`
- Modify: `skills/pr-merge/SKILL.md`
- Modify: `skills/branch-review/SKILL.md`

- [ ] **Step 1: Update github-issue-priming/SKILL.md**

Replace all `superpowers:*` references (6 occurrences):

| Line | Old                                          | New                       |
| ---- | -------------------------------------------- | ------------------------- |
| 161  | `superpowers:brainstorming`                  | `play-brainstorm`         |
| 164  | `superpowers:brainstorming`                  | `play-brainstorm`         |
| 206  | `superpowers:writing-plans`                  | `play-planning`           |
| 210  | `superpowers:subagent-driven-development`    | `play-subagent-execution` |
| 226  | `superpowers:finishing-a-development-branch` | `play-branch-finish`      |
| 248  | `superpowers:brainstorming`                  | `play-brainstorm`         |
| 249  | `superpowers:writing-plans`                  | `play-planning`           |
| 250  | `superpowers:subagent-driven-development`    | `play-subagent-execution` |

- [ ] **Step 2: Update pr-merge/SKILL.md**

Replace 3 occurrences:

| Line | Old                                          | New                 |
| ---- | -------------------------------------------- | ------------------- |
| 212  | `superpowers:systematic-debugging`           | `play-debug`        |
| 214  | `superpowers:verification-before-completion` | `play-verification` |
| 241  | `superpowers:verification-before-completion` | `play-verification` |

- [ ] **Step 3: Update branch-review/SKILL.md**

At line 177, change:

```
- `superpowers:requesting-code-review` — lighter-weight single-reviewer check
```

to:

```
- `play-review-response` — guidance for responding to review feedback with technical rigor
```

- [ ] **Step 4: Validate all skills**

```bash
pnpm run dev -- validate
```

Expected: 15 skills valid.

- [ ] **Step 5: Run markdown lint on modified files**

```bash
npx markdownlint-cli2 "skills/**/*.md"
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add skills/github-issue-priming/SKILL.md skills/pr-merge/SKILL.md skills/branch-review/SKILL.md
git commit -m "refactor(skills): update cross-references from superpowers to local play-* skills

Replace all superpowers:* references in github-issue-priming,
pr-merge, and branch-review with local play-* skill names."
```

---

### Task 12: Final validation and cleanup

- [ ] **Step 1: Run full validation**

```bash
pnpm run dev -- validate
```

Expected: `Skills: 15 valid`

- [ ] **Step 2: Verify no remaining superpowers references in skills/**

```bash
grep -r "superpowers:" skills/ || echo "No superpowers references found"
```

Expected: No matches.

- [ ] **Step 3: Run markdown lint**

```bash
npx markdownlint-cli2 "skills/**/*.md"
```

Expected: 0 errors.

- [ ] **Step 4: Verify file count**

```bash
find skills/play-* -type f | wc -l
```

Expected: 30 files across 10 skill directories.

- [ ] **Step 5: List final skill directory**

```bash
ls -la skills/
```

Expected: 15 skill directories (5 existing + 10 new play-\* skills).
