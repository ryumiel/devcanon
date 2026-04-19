# Play Skills Adoption Design

Adopt 10 methodology skills from the Superpowers plugin as user-global skills
managed by `agents-manager`. These replace the Superpowers plugin entirely once
synced via `agents-manager sync`.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Strategy | Replace | Skills install to user-global dirs; Superpowers plugin is uninstalled after migration |
| Naming | `play-` prefix | Avoids conflict with other skills; visually groups methodology skills |
| Naming style | Match existing convention (`[noun]-[action]`) | Cohesive library feel |
| Adaptation depth | Moderate | Keep battle-tested methodology; adapt paths, cross-refs, and opinionated sections |

## Naming Map

| Superpowers Original | Local Name |
|----------------------|------------|
| `brainstorming` | `play-brainstorm` |
| `writing-plans` | `play-planning` |
| `subagent-driven-development` | `play-subagent-execution` |
| `verification-before-completion` | `play-verification` |
| `finishing-a-development-branch` | `play-branch-finish` |
| `systematic-debugging` | `play-debug` |
| `writing-skills` | `play-skill-authoring` |
| `dispatching-parallel-agents` | `play-agent-dispatch` |
| `receiving-code-review` | `play-review-response` |
| `test-driven-development` | `play-tdd` |

## File Structure

```
skills/
  # Domain skills (existing, unchanged structure)
  branch-review/
  pr-review/
  pr-merge/
  github-issue-priming/
  delivery-orchestration/

  # Methodology plays (adopted from Superpowers)
  play-brainstorm/
    SKILL.md
    spec-document-reviewer-prompt.md

  play-planning/
    SKILL.md
    plan-document-reviewer-prompt.md

  play-subagent-execution/
    SKILL.md
    implementer-prompt.md
    spec-reviewer-prompt.md
    code-quality-reviewer-prompt.md

  play-verification/
    SKILL.md

  play-branch-finish/
    SKILL.md

  play-debug/
    SKILL.md
    root-cause-tracing.md
    defense-in-depth.md
    condition-based-waiting.md
    condition-based-waiting-example.ts
    find-polluter.sh

  play-skill-authoring/
    SKILL.md
    anthropic-best-practices.md
    persuasion-principles.md
    testing-skills-with-subagents.md
    graphviz-conventions.dot
    render-graphs.js
    examples/
      CLAUDE_MD_TESTING.md
      test-academic.md
      test-pressure-1.md
      test-pressure-2.md
      test-pressure-3.md

  play-agent-dispatch/
    SKILL.md

  play-tdd/
    SKILL.md
    testing-anti-patterns.md

  play-review-response/
    SKILL.md
```

## Common Adaptations (All Skills)

1. **Rename** `name:` field in SKILL.md frontmatter to `play-*` name
2. **Update cross-references** from `superpowers:*` to `play-*` local names
3. **Remove platform notes** (Cursor, Gemini, Copilot CLI references)
4. **Remove Superpowers-specific context** (plugin installation, upstream contribution guidance)
5. **Soften "iron law" phrasing** -- keep the rules, use pragmatic tone

## Per-Skill Adaptations

### play-brainstorm

Source: `superpowers/skills/brainstorming/`

- Remove the "visual companion" section and all `scripts/` (browser-based mockup infra)
- Remove `visual-companion.md`
- Keep the spec self-review checklist (placeholder scan, consistency, scope, ambiguity) -- valuable as quality gate in auto mode
- Keep `spec-document-reviewer-prompt.md`
- Keep one-question-at-a-time discipline, 2-3 approaches, design-before-implementation gate
- Change spec output path from `docs/superpowers/specs/` to project-local path
- Update terminal transition: invoke `play-planning` instead of `superpowers:writing-plans`

### play-planning

Source: `superpowers/skills/writing-plans/`

- Change plan output path from `docs/superpowers/plans/` to project-local path
- Keep bite-sized task granularity and DRY/YAGNI emphasis
- Keep `plan-document-reviewer-prompt.md`
- Update references to invoke `play-subagent-execution` or `play-tdd` instead of Superpowers equivalents

### play-subagent-execution

Source: `superpowers/skills/subagent-driven-development/`

- Keep fresh-subagent-per-task model and two-stage review
- Keep all three prompt files (`implementer-prompt.md`, `spec-reviewer-prompt.md`, `code-quality-reviewer-prompt.md`)
- Update review dispatch to reference `branch-review` instead of `superpowers:requesting-code-review`
- Update internal references to `play-tdd`, `play-verification`

### play-verification

Source: `superpowers/skills/verification-before-completion/`

- Adopt nearly verbatim -- universal quality gate
- Rename cross-references only

### play-branch-finish

Source: `superpowers/skills/finishing-a-development-branch/`

- Wire "push and create PR" option to reference `pr-merge` as the next step
- Keep worktree cleanup logic
- Update references from `superpowers:verification-before-completion` to `play-verification`

### play-debug

Source: `superpowers/skills/systematic-debugging/`

- Adopt core methodology verbatim (4-phase root cause investigation)
- Keep all reference files: `root-cause-tracing.md`, `defense-in-depth.md`, `condition-based-waiting.md`, `condition-based-waiting-example.ts`, `find-polluter.sh`
- Exclude `CREATION-LOG.md` (upstream development artifact)
- Exclude `test-*.md` (pressure test files move to `play-skill-authoring/examples/`)

### play-skill-authoring

Source: `superpowers/skills/writing-skills/`

- Keep all supporting files: `anthropic-best-practices.md`, `persuasion-principles.md`, `testing-skills-with-subagents.md`, `graphviz-conventions.dot`, `render-graphs.js`
- Keep `examples/CLAUDE_MD_TESTING.md` from upstream
- Add pressure test examples from `systematic-debugging/`: `test-academic.md`, `test-pressure-1.md`, `test-pressure-2.md`, `test-pressure-3.md`
- Update references from `superpowers:test-driven-development` to `play-tdd`
- Adapt validation step to reference `agents-manager validate`

### play-agent-dispatch

Source: `superpowers/skills/dispatching-parallel-agents/`

- Adopt nearly verbatim -- standalone parallelization skill
- Rename cross-references only

### play-tdd

Source: `superpowers/skills/test-driven-development/`

- Keep the red-green-refactor cycle
- Keep `testing-anti-patterns.md`
- Soften "delete code written before tests" to a strong recommendation
- Rename cross-references only

### play-review-response

Source: `superpowers/skills/receiving-code-review/`

- Keep the READ -> UNDERSTAND -> VERIFY -> EVALUATE -> RESPOND -> IMPLEMENT flow
- Adopt nearly verbatim
- Rename cross-references only

## Cross-Reference Updates in Existing Skills

### github-issue-priming/SKILL.md

| Old Reference | New Reference |
|---------------|---------------|
| `superpowers:brainstorming` | `play-brainstorm` |
| `superpowers:writing-plans` | `play-planning` |
| `superpowers:subagent-driven-development` | `play-subagent-execution` |
| `superpowers:finishing-a-development-branch` | `play-branch-finish` |

### pr-merge/SKILL.md

| Old Reference | New Reference |
|---------------|---------------|
| `superpowers:systematic-debugging` | `play-debug` |
| `superpowers:verification-before-completion` | `play-verification` |

### branch-review/SKILL.md

| Old Reference | New Reference |
|---------------|---------------|
| `superpowers:requesting-code-review` | _(remove line -- `branch-review` itself is the replacement)_ |

## Resulting Skill Library (15 Total)

| Skill | Category | Description |
|-------|----------|-------------|
| `branch-review` | Domain | Multi-agent local code review |
| `pr-review` | Domain | Multi-agent GitHub PR review |
| `pr-merge` | Domain | CI-gated PR merge |
| `github-issue-priming` | Domain | Issue-to-PR orchestration |
| `delivery-orchestration` | Domain | Phased delivery with quality gates |
| `play-brainstorm` | Methodology | Idea to design via collaborative dialogue |
| `play-planning` | Methodology | Spec to implementation plan |
| `play-subagent-execution` | Methodology | Execute plan via fresh subagents |
| `play-verification` | Methodology | Evidence before completion claims |
| `play-branch-finish` | Methodology | Branch to PR/merge with cleanup |
| `play-debug` | Methodology | Systematic root-cause investigation |
| `play-skill-authoring` | Methodology | TDD for skill creation |
| `play-agent-dispatch` | Methodology | Parallel agent delegation |
| `play-review-response` | Methodology | Respond to code review with rigor |
| `play-tdd` | Methodology | Red-green-refactor cycle |
