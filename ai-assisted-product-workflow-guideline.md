docs/guidelines/ai-assisted-product-workflow-guideline.md

# AI-Assisted Product Workflow, Specification, and Skill Guideline

**Status:** Proposed  
**Applies to:** DevCanon-managed repositories and Shotloom-style product repositories  
**Primary focus:** Workflows, product requirements, specifications, and AI-agent skills  
**Goal:** Create a durable, agent-friendly operating model for turning product intent into specs, issues, PRs, reviewable changes, and maintained repository knowledge.

---

## 1. Executive Summary

This project should adopt a **spec-anchored, workflow-driven, skill-enabled** operating model.

The core doctrine is:

> **Specs define behavior. Workflows define repeatable procedures. Skills execute bounded procedures. Issues track live work. PRs ship changes. Agent-local plans are disposable unless they produce durable repository truth.**

This guideline adapts the following ideas:

- AFDS: repository documentation must be navigable, durable, low-rot, and organized by responsibility.
- Project-management model: specs, roadmap items, issues, PRs, and agent-local plans must have separate systems of record.
- Workflow model: contributors and agents should follow explicit procedures for issue pickup, implementation, PRs, review, and post-merge maintenance.
- Shape Up: raw ideas should be shaped into bounded work with appetite, solution outline, rabbit holes, and no-gos.
- Spec-driven development: specs should anchor implementation and maintenance, but code remains directly editable.
- AI-agent spec writing: specs should be structured, modular, scoped, testable, and designed for agent context limits.
- Claude Code skills: repeated procedures should become reusable project skills rather than bloated root instructions.

The intended result is not “more documentation.” The intended result is **better delegation to humans and AI agents with less ambiguity, less context waste, and fewer duplicate sources of truth**.

---

## 2. Why This Guideline Exists

AI agents make repository discipline more important, not less important.

When agents can produce large code changes quickly, the limiting factors become:

- whether the agent can find the right source of truth;
- whether requirements are behavior-oriented and unambiguous;
- whether scope boundaries are explicit;
- whether verification is clear;
- whether review can remain small and focused;
- whether durable project knowledge survives after the current session ends.

AFDS already defines the repository as a durable system of record: root docs should stay small, durable knowledge belongs in the repo, documentation should be structured by responsibility, and mechanically enforceable rules should be preferred where possible. :contentReference[oaicite:0]{index=0}

AFDS also defines non-negotiable principles that directly shape this guideline: one canonical agent entry point, one canonical navigation map, one source of truth per concern, contract-first interfaces, progressive disclosure, docs close to change, mechanical anti-rot, and no storage of ephemeral harness run-state in repo docs. :contentReference[oaicite:1]{index=1}

The project-management model adds the missing artifact boundary: repository docs own durable truth, the external issue tracker owns live work tracking, the PR system owns review and merge flow, and agent sessions own temporary execution detail. :contentReference[oaicite:2]{index=2}

Therefore, this guideline exists to connect those policies into a practical operating model for:

- product requirements;
- feature specifications;
- workflow documents;
- roadmap items;
- issue slicing;
- PR readiness;
- documentation review;
- AI-agent skills.

---

## 3. Core Principles

### 3.1 Durable truth belongs in the repository

Long-lived product behavior, architecture, contracts, decisions, roadmap direction, and reusable operating guidance belong in the repository.

Examples:

- product/domain specs;
- workflow guidelines;
- architecture docs;
- ADRs;
- contracts;
- roadmap items;
- tech-debt records;
- skill definitions;
- verification procedures.

### 3.2 Live state does not belong in durable docs

The repository must not become a duplicate issue tracker or agent run log.

Do not store the following in repo docs:

- live issue status;
- assignment state;
- temporary task decomposition already tracked in Linear;
- step-by-step single-PR execution plans;
- active harness progress;
- transient agent scratch notes.

The project-management model explicitly states that the repository should store durable specs, roadmap items, architecture, ADRs, contracts, operating guidance, code, and tests, but should not store live issue status or detailed single-PR execution plans. :contentReference[oaicite:3]{index=3}

### 3.3 Specs are behavior artifacts, not implementation diaries

A spec defines intended behavior, goals, constraints, non-goals, and success criteria. It belongs in `docs/specs/`. If a document describes current system shape or module boundaries, it belongs in `docs/arch/`. If it records a decision and rationale, it belongs in `docs/adr/`. :contentReference[oaicite:4]{index=4}

### 3.4 Skills are executable procedures, not knowledge dumps

A skill should encode a reusable procedure that agents perform repeatedly.

Use a skill when the team keeps pasting the same instructions, checklist, review process, or multi-step procedure into chat. Claude Code skills are loaded only when used, unlike always-loaded project instructions, so they are appropriate for detailed procedures that would bloat root context. :contentReference[oaicite:5]{index=5}

### 3.5 Progressive disclosure is mandatory

Agents should not load the whole repository context by default.

The context-loading order should be:

1. `AGENTS.md`
2. `MAP.md`
3. the owning spec, architecture doc, contract, guideline, or module doc
4. the specific files under change
5. relevant tests
6. external references only when needed

This follows AFDS’s principle that agents should start from a small stable entry point and load deeper docs only when needed. :contentReference[oaicite:6]{index=6}

### 3.6 Prefer spec-anchored development, not spec-as-source

This project should use **spec-anchored development**:

- specs are written before or during shaping;
- specs remain after implementation;
- specs are updated when behavior changes;
- humans and agents still edit code directly.

Martin Fowler’s SDD survey distinguishes three levels: spec-first, spec-anchored, and spec-as-source. Spec-anchored means the spec is kept after the task is complete and used for feature evolution and maintenance; spec-as-source means humans edit only the spec and not the code. :contentReference[oaicite:7]{index=7}

Spec-anchored development fits this project because AFDS already treats specs as durable repository knowledge, while the project-management model still treats PRs as the vehicle that lands code, documentation, tests, and contracts.

---

## 4. Systems of Record

| Artifact | Meaning | System of record | Durable? |
|---|---|---:|---:|
| Product/domain spec | Intended behavior, goals, constraints, non-goals, success criteria | `docs/specs/` | Yes |
| Workflow guideline | Repeatable procedure for humans/agents | `WORKFLOW.md` or `docs/guidelines/` | Yes |
| Roadmap | Ordered set of major target outcomes | `docs/roadmap/` | Yes |
| Roadmap item | Multi-PR target outcome | `docs/roadmap/` | Yes |
| Architecture | Current system shape, boundaries, runtime topology | `docs/arch/` | Yes |
| ADR | Durable decision and rationale | `docs/adr/` | Yes |
| Contract | Machine-readable interface/schema | `contracts/` | Yes |
| Issue | Concrete unit of executable work | Linear | Live state |
| PR | Proposed repository change | GitHub Pull Requests | Merge state |
| Agent-local plan | Temporary execution sequence for current task | Active agent session/local context | No |
| Harness run state | Active orchestration/progress state | Harness / Linear workpad / comment | No |

This table follows the project-management model’s artifact ownership: specs, roadmap, and roadmap items are repository-owned; issues are external-tracker-owned; PRs are PR-system-owned; agent-local plans live only in session/local context. :contentReference[oaicite:8]{index=8}

---

## 5. Repository Structure to Adopt

### 5.1 Required or recommended documentation additions

```text
docs/guidelines/
  ai-assisted-product-workflow-guideline.md
  ai-spec-guideline.md
  workflow-authoring-guideline.md
  skill-authoring-guideline.md
  spec-readiness-review-guideline.md
  doc-impact-review-guideline.md

docs/specs/
  README.md
  product-spec-template.md
  workflow-spec-template.md
  acceptance-criteria-template.md

docs/roadmap/
  README.md
  roadmap-item-template.md

docs/harness/
  agent-skill-boundary.md

.claude/skills/
  shape-work/
    SKILL.md
  write-product-spec/
    SKILL.md
  write-workflow-spec/
    SKILL.md
  build-spec-context-map/
    SKILL.md
  slice-issues/
    SKILL.md
  spec-readiness-review/
    SKILL.md
  verify-against-spec/
    SKILL.md
  doc-impact-review/
    SKILL.md
  post-merge-gardener/
    SKILL.md
````

### 5.2 Why these locations

AFDS says:

* product/domain/feature specifications belong in `docs/specs/`;
* engineering, testing, logging, schema, and doc rules belong in `docs/guidelines/`;
* roadmap direction, target outcomes, and sequencing belong in `docs/roadmap/`;
* external harness boundary and assumptions belong in `docs/harness/`;
* contracts belong in `contracts/`. 

AFDS also defines `docs/guidelines/` as the place for reusable guidance too detailed for `AGENTS.md`, including coding conventions, testing guidance, documentation update rules, and review expectations. 

---

## 6. Artifact Taxonomy

### 6.1 Product brief

A product brief is a lightweight precursor to a spec.

Use when:

* an idea is not shaped yet;
* there is not enough confidence for a full spec;
* the goal is to clarify problem, appetite, and rough solution.

A product brief may be temporary. It does not need to become a permanent repo artifact unless it captures durable product intent.

Recommended structure:

```md
# Product Brief: <Title>

## Problem

## Users / Operators

## Desired Outcome

## Appetite

## Rough Solution

## Known Risks

## No-Gos

## Open Questions
```

### 6.2 Shaped pitch

A shaped pitch is a bounded proposal that is ready to become either:

* a spec;
* a roadmap item;
* a Linear issue;
* or a rejected/deferred idea.

Shape Up is useful here because it emphasizes shaping before execution: set boundaries, define appetite, identify risks/rabbit holes, and write a pitch with problem, appetite, solution, rabbit holes, and no-gos. ([Basecamp][1])

Recommended structure:

```md
# Pitch: <Title>

## Problem

## Appetite

## Solution Outline

## Rabbit Holes

## No-Gos

## Success Criteria

## Bet / Not-Bet Recommendation
```

### 6.3 Product/domain spec

A spec is durable repository truth.

Use when:

* intended behavior changes;
* goals or non-goals need to become explicit;
* success criteria need to become explicit;
* agents need a stable behavioral reference.

The project-management model says specs are durable statements of intended behavior, goals, constraints, non-goals, and success criteria, and that specs belong in `docs/specs/`. 

### 6.4 Workflow spec

A workflow spec defines how humans or agents should repeatedly perform a process.

Use when:

* the project repeats a procedure often;
* the procedure has decision gates;
* the procedure needs clear inputs and outputs;
* the procedure should be converted into a skill later.

Examples:

* PR review workflow;
* spec drafting workflow;
* issue slicing workflow;
* release workflow;
* documentation impact review workflow.

### 6.5 Skill

A skill is a reusable agent procedure.

Use when:

* a workflow is repeated often;
* it has clear trigger conditions;
* it needs structured inputs/outputs;
* it should be invocable as `/skill-name`;
* it would bloat `AGENTS.md` if placed there.

Claude Code skills are directories with a required `SKILL.md`, can have supporting files, and can live at project scope under `.claude/skills/<skill-name>/SKILL.md`. ([Claude API Docs][2])

---

## 7. Product Spec Standard

### 7.1 Required sections

Every durable product/domain spec should use this structure unless there is a strong reason not to.

```md
# <Feature or Domain> Spec

**Status:** Draft | Proposed | Accepted | Deprecated  
**Owner:** <person/team>  
**Last Updated:** <YYYY-MM-DD>  
**Related Roadmap Item:** <link or N/A>  
**Related Issues:** <links or N/A>  
**Related Architecture:** <links or N/A>  
**Related Contracts:** <links or N/A>  
**Related ADRs:** <links or N/A>

## 1. Summary

## 2. Problem

## 3. Users / Operators

## 4. Desired Outcome

## 5. Appetite and Scope Boundary

## 6. In-Scope Behavior

## 7. Out-of-Scope Behavior

## 8. User / Operator Flows

## 9. Functional Requirements

## 10. Non-Functional Requirements

## 11. Domain Rules and Terminology

## 12. Edge Cases and Failure Modes

## 13. Acceptance Criteria

## 14. Verification Plan

## 15. Agent Boundaries

## 16. Context Loading Guide

## 17. Open Questions

## 18. Change Log
```

### 7.2 Section guidance

#### 1. Summary

A short statement of what behavior this spec owns.

Do not include implementation detail unless it is required to understand the behavior.

#### 2. Problem

Explain the current pain, missing capability, or ambiguity.

Good problem statements answer:

* What is broken or missing?
* Who is affected?
* Why does it matter now?
* What happens if we do nothing?

#### 3. Users / Operators

Identify who uses or operates the feature.

Examples:

* end user;
* internal operator;
* developer;
* reviewer;
* agent;
* external system.

#### 4. Desired Outcome

Describe the target state in observable terms.

Good outcomes are:

* behavior-oriented;
* testable;
* user-visible or operator-visible;
* not just a list of implementation tasks.

#### 5. Appetite and Scope Boundary

Define the intended investment level and boundaries.

This is adapted from Shape Up’s appetite and boundary model. Shape Up emphasizes setting boundaries, fixed time with variable scope, and avoiding grab-bags before building. ([Basecamp][1])

Include:

* appetite;
* acceptable tradeoffs;
* must-haves;
* nice-to-haves;
* explicit scope cuts.

#### 6. In-Scope Behavior

List behavior the implementation must provide.

Use precise, testable statements.

#### 7. Out-of-Scope Behavior

List behavior the implementation must not attempt.

This prevents scope creep and gives agents permission to stop.

#### 8. User / Operator Flows

Describe normal flows and alternate flows.

Use numbered sequences.

Example:

```md
### Flow: Create a new project

1. User opens the project dashboard.
2. User selects "New Project".
3. System prompts for name and template.
4. User confirms.
5. System creates the project and opens the editor.
```

#### 9. Functional Requirements

Use requirement IDs.

```md
| ID | Requirement | Priority | Verification |
|---|---|---|---|
| FR-001 | User can create a project with a unique name. | Must | Unit + e2e |
| FR-002 | System rejects duplicate project names. | Must | Unit |
```

#### 10. Non-Functional Requirements

Include:

* performance;
* reliability;
* accessibility;
* security;
* compatibility;
* observability;
* migration constraints.

#### 11. Domain Rules and Terminology

Define project-specific terms.

Agents should not infer terminology.

#### 12. Edge Cases and Failure Modes

List expected failure states.

Example:

```md
| Case | Expected Behavior | Verification |
|---|---|---|
| Network disconnect during save | User sees retryable failure state. | Integration test |
```

#### 13. Acceptance Criteria

Use checklist form.

```md
- [ ] User can complete the primary flow.
- [ ] Validation errors are visible and actionable.
- [ ] All documented edge cases have tests or explicit manual verification.
- [ ] Related docs, contracts, and examples are updated.
```

#### 14. Verification Plan

List exact validation commands and manual checks.

The uploaded AI-agent spec guidance emphasizes that effective specs should include commands, testing, project structure, code style, git workflow, and boundaries. 

Example:

```md
## Verification Plan

### Automated

- `pnpm test`
- `pnpm lint`
- `cargo test`
- `pnpm e2e`

### Manual

- Open editor.
- Create project.
- Save project.
- Reload project.
- Confirm state persists.

### Review

- Product behavior reviewed against FR-001 through FR-008.
- Architecture impact reviewed.
- Contract compatibility reviewed.
```

#### 15. Agent Boundaries

Use the three-tier model:

```md
## Agent Boundaries

### Always

- Read this spec before changing related behavior.
- Keep implementation inside the accepted scope.
- Run the listed verification commands before proposing completion.
- Update this spec if behavior changes.

### Ask First

- Adding dependencies.
- Changing public contracts.
- Changing data model or persistence format.
- Changing CI, deployment, or security-sensitive configuration.
- Expanding scope beyond this spec.

### Never

- Commit secrets.
- Delete or weaken failing tests to pass validation.
- Duplicate contract field definitions in prose.
- Store live issue or harness state in this spec.
```

#### 16. Context Loading Guide

Tell agents what to load for different task types.

Example:

```md
## Context Loading Guide

### For UI behavior changes

Load:
- this spec
- `docs/arch/editor-runtime.md`
- relevant UI component files
- relevant UI tests

### For contract changes

Load:
- this spec
- `contracts/editor-events.schema.json`
- `docs/ipc/editor-events.md`
- contract tests

### Do not load by default

- unrelated roadmap items
- historical planning notes
- old rejected alternatives
```

This implements the uploaded spec article’s recommendation to avoid one giant prompt and instead load only the relevant context for the current task. 

#### 17. Open Questions

Use this only for unresolved product/spec questions.

Open questions must not become an implementation task list.

#### 18. Change Log

Keep short.

```md
| Date | Change | Reason |
|---|---|---|
| 2026-05-08 | Initial draft | Establish behavior contract |
```

---

## 8. Workflow Authoring Standard

A workflow document defines how to perform a repeatable process.

### 8.1 Required workflow sections

```md
# <Workflow Name>

**Status:** Draft | Accepted | Deprecated  
**Owner:** <person/team>  
**Applies to:** <scope>

## 1. Purpose

## 2. When to Use This Workflow

## 3. Inputs

## 4. Preconditions

## 5. Procedure

## 6. Decision Points

## 7. Outputs

## 8. Verification

## 9. Ownership Boundaries

## 10. Failure / Escalation Paths

## 11. Related Docs
```

### 8.2 Workflow rules

A workflow must:

* start with trigger conditions;
* define required inputs;
* define preconditions;
* use ordered steps;
* identify decision points;
* define outputs;
* include verification;
* state where durable results belong;
* avoid live status duplication.

The existing `WORKFLOW.md` already follows this direction by separating picking work, creating issues, implementing, agent-orchestrated work, opening PRs, post-merge work, and deployment. 

### 8.3 Workflow-to-skill conversion rule

Convert a workflow into a skill when:

* it is repeated often;
* it has stable steps;
* it benefits from structured agent execution;
* it can produce a clear output;
* it does not require broad, always-loaded context.

Do not convert a workflow into a skill when:

* it is rare;
* it is mostly policy;
* it requires human judgment at every step;
* it would hide important governance from reviewers.

---

## 9. Skill Authoring Standard

### 9.1 Skill structure

Each project skill should live at:

```text
.claude/skills/<skill-name>/SKILL.md
```

Claude Code project skills are available only to that project, and every skill uses a `SKILL.md` entrypoint. ([Claude API Docs][2])

### 9.2 Required skill format

```md
---
name: <skill-name>
description: <when to use this skill and what it produces>
---

# <Skill Name>

## Purpose

## Use When

## Do Not Use When

## Inputs

## Required Context

## Procedure

## Output Format

## Verification

## Boundaries
```

### 9.3 Skill writing rules

A skill must:

* be procedural;
* be narrow;
* state when to use it;
* state when not to use it;
* define inputs and outputs;
* load only the context needed;
* avoid duplicating durable policy already owned by repo docs;
* link to canonical docs instead of restating them.

A skill must not:

* become a replacement for `AGENTS.md`;
* become a second `WORKFLOW.md`;
* embed long architecture descriptions;
* duplicate contract definitions;
* store live task state;
* silently expand scope.

### 9.4 Why skills should stay concise

Claude Code documentation notes that skill content enters the conversation when invoked and stays in context, so the body should remain concise and supporting files should be used for complex skills. ([Claude API Docs][2])

Therefore:

* `SKILL.md` should contain procedure and routing logic;
* templates should live beside the skill as supporting files;
* examples should live under `examples/`;
* scripts should live under `scripts/`.

Recommended structure:

```text
.claude/skills/write-product-spec/
  SKILL.md
  templates/
    product-spec-template.md
  examples/
    minimal-spec.md
    complex-spec.md
  scripts/
    validate-spec-links.sh
```

---

## 10. Required Skill Set

### 10.1 `shape-work`

Purpose: Convert raw ideas into bounded shaped work.

Use when:

* the user has a vague product idea;
* the issue is too broad;
* the agent needs to clarify appetite and boundaries before writing a spec.

Output:

```md
# Shaped Work

## Problem

## Appetite

## Solution Outline

## Rabbit Holes

## No-Gos

## Recommendation
```

Reason:

Shape Up’s pitch ingredients are problem, appetite, solution, rabbit holes, and no-gos. ([Basecamp][1])

### 10.2 `write-product-spec`

Purpose: Convert shaped work, a roadmap item, or a rough issue into a durable product/domain spec.

Use when:

* intended behavior needs to be documented;
* a feature needs acceptance criteria;
* an implementation requires stable agent context.

Output:

* new or updated `docs/specs/<topic>.md`.

Hard boundaries:

* do not create `SPEC.md` at repo root;
* do not store live issue status;
* do not write single-PR execution plans;
* do not duplicate contracts.

### 10.3 `write-workflow-spec`

Purpose: Create or revise a repeatable workflow.

Use when:

* humans or agents repeatedly perform a process;
* the process needs explicit gates;
* the workflow may later become a skill.

Output:

* `WORKFLOW.md` patch, or
* `docs/guidelines/<workflow-name>.md`.

### 10.4 `build-spec-context-map`

Purpose: Create a compact load map for a large spec.

Use when:

* a spec is long;
* different agents need different sections;
* context loading needs to be efficient.

Output:

```md
# Spec Context Map

## Global Constraints

## Section Index

## Load Rules by Task Type

## Do Not Load by Default
```

Reason:

The uploaded AI-agent spec guide recommends extended TOCs or summaries for large specs so agents can keep a compact mental map and load details only when needed. 

### 10.5 `slice-issues`

Purpose: Convert an accepted spec or roadmap item into proposed Linear issue drafts.

Use when:

* work must be split into reviewable execution units;
* a roadmap item spans multiple PRs;
* an issue is too broad.

Output:

```md
# Proposed Issue Slices

## Slice 1

- Title:
- Problem:
- Scope:
- Acceptance Criteria:
- Links:
- Suggested PR Boundary:

## Slice 2
...
```

Hard boundary:

* output issue drafts only;
* do not store final issue state in repo docs;
* Linear remains the system of record for live issues.

The project-management model says an issue is one concrete problem or task, usually small enough to reason about as one execution unit, and one issue should usually map to one PR. 

### 10.6 `spec-readiness-review`

Purpose: Check whether a spec is ready for implementation.

Use when:

* a spec is about to drive agent work;
* a roadmap item is about to be sliced into issues;
* an ambiguous issue needs clarification.

Output:

```md
# Spec Readiness Review

## Verdict

Ready | Needs Revision | Blocked

## Missing Product Clarity

## Missing Scope Boundaries

## Missing Acceptance Criteria

## Missing Verification

## Missing Ownership Links

## Agent Risk Areas

## Required Revisions
```

### 10.7 `verify-against-spec`

Purpose: Compare implementation against the owning spec.

Use when:

* a PR claims to implement a spec;
* an agent completes a task;
* review needs requirement coverage.

Output:

```md
# Spec Verification Report

## Covered Requirements

## Missing or Partial Requirements

## Behavior Changes Not Reflected in Spec

## Tests Run

## Manual Checks

## Follow-Up Required
```

Reason:

The uploaded AI-agent spec guide recommends self-verification: after implementation, compare the result against requirements and list missing items. 

### 10.8 `doc-impact-review`

Purpose: Review a change for required documentation updates.

Use when:

* a PR changes behavior, contracts, module boundaries, commands, tests, or tricky logic.

Output:

```md
# Documentation Impact Review

## Docs That Must Change

## Docs That Should Change

## Contracts / Examples / Tests Alignment

## MAP.md Impact

## AGENTS.md Impact

## No-Doc-Change Justification
```

Reason:

AFDS requires same-PR doc updates when PRs change interfaces, major paths, module boundaries, externally visible behavior, run/test/debug procedures, or tricky logic requiring new local context. 

### 10.9 `post-merge-gardener`

Purpose: Clean up durable docs after merge.

Use when:

* a feature lands;
* a roadmap item status changes;
* tech debt is resolved;
* follow-up issues are discovered.

Output:

```md
# Post-Merge Gardening Report

## Roadmap Updates

## Tech-Debt Updates

## Spec Updates

## Follow-Up Issues

## No Action Needed
```

The existing workflow already requires verifying the issue, updating roadmap status if needed, deleting resolved tech-debt entries, and creating follow-up issues rather than expanding merged PR scope. 

---

## 11. End-to-End Lifecycle

### 11.1 Standard lifecycle

```text
Raw idea
  ↓
shape-work
  ↓
Product brief / shaped pitch
  ↓
write-product-spec
  ↓
docs/specs/<feature-or-domain>.md
  ↓
spec-readiness-review
  ↓
roadmap item or Linear issue slicing
  ↓
implementation
  ↓
verify-against-spec
  ↓
doc-impact-review
  ↓
PR review
  ↓
merge
  ↓
post-merge-gardener
```

### 11.2 Artifact ownership during lifecycle

| Stage               | Artifact                      | Owner                      |
| ------------------- | ----------------------------- | -------------------------- |
| Raw idea            | Conversation / notes          | Temporary                  |
| Shaped pitch        | Temporary or repo if durable  | Product owner / maintainer |
| Spec                | `docs/specs/`                 | Repository                 |
| Roadmap item        | `docs/roadmap/`               | Repository                 |
| Issue slices        | Linear                        | Issue tracker              |
| Implementation plan | Agent-local                   | Agent session              |
| PR                  | GitHub Pull Request           | PR system                  |
| Verification report | PR comment or review artifact | PR system                  |
| Durable updates     | Owning repo docs              | Repository                 |

### 11.3 Important boundary

The “Tasks” phase from many SDD workflows maps to **Linear issues**, not repository task files.

The uploaded AI-agent spec guide describes a Specify → Plan → Tasks → Implement workflow where agents break work into small reviewable chunks. 

For this project, that idea should be adapted as:

```text
Specify  → docs/specs/
Plan     → docs/arch/, docs/adr/, or agent-local depending on durability
Tasks    → Linear issues
Implement → GitHub PRs
```

Reason:

The project-management model says roadmap items are outcome groupings, issues are execution units, and PRs are merge vehicles. 

---

## 12. Context Loading Policy for Agents

### 12.1 Default load order

Agents should load context in this order:

```text
1. AGENTS.md
2. MAP.md
3. WORKFLOW.md if doing contribution workflow
4. owning spec / guideline / architecture / contract
5. module README or module architecture doc
6. relevant source files
7. relevant tests
8. related issues or PRs
9. external references only if needed
```

### 12.2 Do not load by default

Agents should not load the following unless directly relevant:

* all roadmap items;
* all specs;
* historical conversations;
* old planning notes;
* unrelated module docs;
* external articles;
* generated files;
* vendor docs;
* archived decisions.

### 12.3 Why this matters

The uploaded AI-agent spec guide warns against one large prompt and recommends focused, modular context because overlong context and too many instructions degrade adherence. 

AFDS independently supports the same model through progressive disclosure and root-doc restraint. 

---

## 13. Review and Governance

### 13.1 Same-PR update rule

A PR must update durable docs in the same PR when it changes:

* interfaces or contracts;
* externally visible behavior;
* product/domain behavior;
* module boundaries;
* major file paths;
* run/test/debug procedures;
* tricky logic requiring new context;
* architecture decisions;
* roadmap item status;
* tech-debt state.

This follows AFDS’s same-PR documentation update policy. 

### 13.2 PR readiness checklist

Every PR should answer:

```md
## PR Readiness

- [ ] Related issue is linked.
- [ ] Owning spec is linked or no spec is needed.
- [ ] Behavior changes are reflected in `docs/specs/`.
- [ ] Contract changes are reflected in `contracts/` and examples/tests.
- [ ] Architecture changes are reflected in `docs/arch/` or ADRs.
- [ ] Workflow changes are reflected in `WORKFLOW.md` or `docs/guidelines/`.
- [ ] `MAP.md` is updated if paths moved.
- [ ] Validation commands were run.
- [ ] Follow-up issues are created instead of expanding scope.
```

### 13.3 Human review focus

AI can help with first-pass review, but humans remain responsible for:

* architectural alignment;
* product judgment;
* business context;
* security implications;
* maintainability;
* whether the spec itself is correct.

The engineering-culture reference argues that AI increases review pressure and that high-performing teams use structured context, architectural guardrails, specs, tests, and review discipline rather than unconstrained “vibe coding.” ([cjroth.com][3])

---

## 14. Mechanical Validation

Add CI or local checks for:

```text
Required structure:
- AGENTS.md exists
- MAP.md exists
- docs/specs/ exists
- docs/guidelines/ exists
- docs/arch/ exists
- docs/adr/ exists
- contracts/ exists

Markdown hygiene:
- markdownlint
- broken internal links
- broken anchor links
- no ambiguous filenames: final.md, misc.md, notes-v2.md, temp.md

Doc ownership:
- specs do not contain live issue status
- roadmap items do not contain single-PR task plans
- contracts are linked instead of duplicated
- MAP.md references valid paths

Skill hygiene:
- every skill has SKILL.md
- every skill has description frontmatter
- every skill has Use When / Do Not Use When / Inputs / Procedure / Output Format / Boundaries
```

AFDS recommends mechanical validation through broken-link checks, markdown linting, path validation, schema/doc cross-reference validation, generated index freshness checks, structure linting, and architecture boundary validation. 

---

## 15. Naming Conventions

### 15.1 Docs

Use:

```text
docs/specs/<feature-or-domain>.md
docs/guidelines/<topic>-guideline.md
docs/roadmap/<roadmap-item>.md
docs/adr/adr-0001-short-title.md
docs/harness/<harness-name>.md
```

Rules:

* use lowercase `kebab-case`;
* avoid `final.md`, `new-plan.md`, `notes-v2.md`, `misc.md`, `temp.md`;
* avoid dates for active canonical docs;
* avoid `v2`, `v3`, or `final` suffixes;
* use Git history and ADRs instead of filename churn.

AFDS recommends lowercase kebab-case for normal docs, stable semantic names, and avoiding ambiguous or churn-heavy filenames. 

### 15.2 Skills

Use verb-object names:

```text
shape-work
write-product-spec
write-workflow-spec
build-spec-context-map
slice-issues
spec-readiness-review
verify-against-spec
doc-impact-review
post-merge-gardener
```

Rules:

* skill name should describe the procedure;
* avoid broad names like `prd`, `agent`, `review`, `docs`;
* prefer narrow invocable actions.

---

## 16. What Not to Adopt

### 16.1 Do not adopt a generic root `SPEC.md`

Some AI-spec guides use `SPEC.md` as the persistent reference file.

Do not use that convention here.

Use:

```text
docs/specs/<feature-or-domain>.md
```

Reason:

AFDS already assigns product/domain behavior to `docs/specs/`, and the project-management model makes specs repository-owned durable artifacts.  

### 16.2 Do not create a monolithic PRD skill

A marketplace PRD skill advertises a comprehensive 15-section PRD framework, including user personas, functional requirements, edge cases, non-functional constraints, KPIs, event tracking, API design, and data models. ([MCP Market][4])

That is useful as inspiration, but this project should not use one broad “PRD skill” because it would blur separate sources of truth:

* product behavior belongs in `docs/specs/`;
* architecture belongs in `docs/arch/`;
* decisions belong in `docs/adr/`;
* contracts belong in `contracts/`;
* issue slicing belongs in Linear;
* implementation planning is agent-local.

Prefer multiple narrow skills.

### 16.3 Do not put detailed procedures into `AGENTS.md`

`AGENTS.md` should remain a short navigator.

AFDS says `AGENTS.md` must not include exhaustive subsystem detail, long troubleshooting sections, deep implementation notes, duplicated contract descriptions, or historical planning logs. 

Move reusable procedures into:

* `WORKFLOW.md`;
* `docs/guidelines/`;
* `.claude/skills/`.

### 16.4 Do not duplicate contract definitions in prose

Contracts own field definitions.

Docs may explain intent, sequencing, examples, invariants, and compatibility, but should link to machine-readable contracts rather than restating every field.

AFDS explicitly says contracts must be machine-readable, cross-module interfaces belong in `contracts/`, and prose documents must link to contracts instead of duplicating them. 

### 16.5 Do not store harness state in repo docs

Harness boundary assumptions may live in `docs/harness/`.

Live harness progress does not.

AFDS states that if execution plans or task state are managed by an external harness, the repo should document boundary and assumptions rather than duplicate live plan state. 

---

## 17. Adoption Plan

### Phase 1: Establish policy and templates

Create:

```text
docs/guidelines/ai-assisted-product-workflow-guideline.md
docs/guidelines/ai-spec-guideline.md
docs/guidelines/workflow-authoring-guideline.md
docs/guidelines/skill-authoring-guideline.md
docs/specs/product-spec-template.md
docs/specs/workflow-spec-template.md
```

Update:

```text
MAP.md
AGENTS.md
WORKFLOW.md
```

Only add short links from `AGENTS.md`; do not inline the full policy.

### Phase 2: Add core skills

Create:

```text
.claude/skills/shape-work/SKILL.md
.claude/skills/write-product-spec/SKILL.md
.claude/skills/spec-readiness-review/SKILL.md
.claude/skills/doc-impact-review/SKILL.md
```

### Phase 3: Add advanced skills

Create:

```text
.claude/skills/write-workflow-spec/SKILL.md
.claude/skills/build-spec-context-map/SKILL.md
.claude/skills/slice-issues/SKILL.md
.claude/skills/verify-against-spec/SKILL.md
.claude/skills/post-merge-gardener/SKILL.md
```

### Phase 4: Add validation

Add checks for:

* broken links;
* required files/folders;
* invalid doc filenames;
* stale `MAP.md` references;
* missing skill frontmatter;
* missing required skill sections;
* docs that contain forbidden live-state markers.

### Phase 5: Use on one real feature

Pilot the model on one upcoming feature:

1. shape the idea;
2. write the product spec;
3. run spec-readiness review;
4. slice issues in Linear;
5. implement one issue;
6. verify against spec;
7. run doc-impact review;
8. merge;
9. run post-merge gardening.

Do not attempt to migrate all existing docs immediately. AFDS recommends ongoing gardening through normal feature and refactor PRs rather than repeated large cleanup projects. 

---

## 18. Final Operating Doctrine

Use the following as the canonical rule:

> **The repository is the durable product, architecture, contract, and workflow memory. Linear is the live execution tracker. GitHub PRs are the merge vehicle. Agent sessions are temporary execution contexts. Skills are reusable procedures that help agents operate inside those boundaries.**

This guideline should be adopted because it gives AI agents enough structure to be useful without allowing them to create uncontrolled documentation sprawl, duplicate state, oversized prompts, or unreviewable implementation batches.

[1]: https://basecamp.com/shapeup "Shape Up: Stop Running in Circles and Ship Work that Matters"
[2]: https://docs.anthropic.com/en/docs/claude-code/skills "Extend Claude with skills - Claude Code Docs"
[3]: https://cjroth.com/blog/2026-02-18-building-an-elite-engineering-culture "Building An Elite AI Engineering Culture In 2026 | Chris Roth"
[4]: https://mcpmarket.com/tools/skills/prd-documentation-product-specs "PRD Documentation & Product Specs - Claude Code Skill"
