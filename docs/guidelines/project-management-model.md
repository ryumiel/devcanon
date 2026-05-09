# Project Management Model

## 1. Core Principles

1. **Repository owns durable truth**: product requirements, behavior specs,
   architecture, contracts, guidelines, roadmap direction, and decisions belong
   in repo docs and code. Example: `docs/specs/configuration.md` defines config
   format, not an issue comment.
2. **External issue tracker owns live work**: assignments, status, blocking
   relationships, prioritization, and scheduling belong in GitHub Issues,
   Linear, or another external tracker. Example: "fix broken symlink handling"
   is an issue, not a durable doc.
3. **PR system owns review and merge flow**: review state, approval, and merge
   status belong in pull requests. Example: review feedback lives in PR
   comments, not in docs.
4. **Agent sessions own temporary detail**: step-by-step implementation plans
   stay in the active session unless their result is durable. Example: an
   agent's plan for implementing an issue is session-local; the resulting code
   and docs are repo artifacts.
5. **One system of record per artifact**: do not duplicate the same information
   across repo docs, issues, PR comments, and agent sessions.

Companion guideline docs may expand an owning document, but they should link
back to that owner instead of becoming a second source of truth.

## 2. Planning Vocabulary

| Artifact                          | Meaning                                                                | System of record               | Example                                                  |
| --------------------------------- | ---------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| **Product requirements document** | Durable statement of product intent, users, goals, outcomes, and risks | `docs/product-requirements/`   | "Portable AFDS Toolkit should support GitHub and Linear" |
| **Behavior spec**                 | Durable statement of exact intended behavior and constraints           | `docs/specs/`                  | "Config file must be named `devcanon.config.yaml`"       |
| **Issue**                         | One concrete problem or task to solve                                  | External issue tracker         | "#5 -- diff command crashes on broken symlinks"          |
| **Pull Request**                  | Proposed repository change that ships a solution                       | PR system                      | "fix(diff): handle broken symlinks at install paths"     |
| **Agent-local plan**              | Temporary execution steps for the current task                         | Active session (not persisted) | "1. Read diff.ts, 2. Add symlink check, 3. Add test"     |

## 3. Ownership Table

| What                                                    | Belongs in                                  | Does NOT belong in               |
| ------------------------------------------------------- | ------------------------------------------- | -------------------------------- |
| Product intent, users, goals, broad requirements, risks | `docs/product-requirements/`                | Issue comments or behavior specs |
| Intended behavior, constraints, format specs            | `docs/specs/`                               | Issue comments                   |
| Repository structure and path discovery                 | `AGENTS.md`, `MAP.md`                       | Agent session notes              |
| Module responsibilities and architecture                | `docs/arch/overview.md`                     | Agent session notes              |
| Commit/PR/branch policy                                 | `CONTRIBUTING.md` and companion guidelines  | Scattered across docs            |
| Bug reports, feature requests, task tracking            | External issue tracker                      | Repository docs                  |
| Review feedback, approval status                        | PR system                                   | Repository docs                  |
| Implementation plans for a single PR                    | Agent session                               | Repository docs                  |
| Durable document-profile policy                         | `docs/guidelines/documentation-standard.md` | Issue templates or one-off plans |

Detailed companion guides may elaborate on commit, PR, or branch policy, but
`CONTRIBUTING.md` remains the canonical summary and owner for those rules.

## 4. Work-Origin Routing

Start from the artifact that owns the current uncertainty.

For the end-to-end operating guide that applies this model to AI-assisted
workflow, issue slicing, implementation, PRs, and post-merge gardening, see
[ai-assisted-product-workflow-guideline.md](ai-assisted-product-workflow-guideline.md).

### 4.1 Shape path

Use shaping when the uncertainty is product intent, product/domain behavior,
workflow policy, reusable procedure, contract ownership, or roadmap-scale
intent.

The shape path is:

```text
raw idea -> product requirements or owning durable AFDS artifact -> behavior spec or issue slicing
```

Shape-path work produces or updates the owning durable AFDS artifact first. When
the uncertainty is product intent, start with product requirements. When product
intent is stable enough, derive the next owner: behavior spec, guideline,
roadmap update, ADR, or implementation issues.

### 4.2 Execution path

Use issue implementation when work is already sliced or starts from a concrete
finding. The execution path is:

```text
implement issue -> update owning durable docs only when the solution changes them
```

Execution-path variants include:

- bug report or failing repro;
- operational chore;
- dependency, security, or audit finding;
- review feedback or PR comment;
- documentation gap or documentation gardening request;
- behavior-preserving refactor;
- behavior-changing refactor or tech-debt item that is already scoped;
- reusable workflow, skill, or agent change.

These variants do not require new product requirements or a new behavior spec
unless the current uncertainty is product intent, product/domain behavior,
workflow policy, reusable procedure, contract ownership, or roadmap-scale
intent.

## 5. Issue Types

### 5.1 Product-requirements issue

A product-requirements issue exists to shape product intent before behavior is
stable enough for a behavior spec or implementation slicing. It should identify
the problem, users, product goals, target outcomes, assumptions, risks, open
questions, and expected follow-up artifact.

### 5.2 Behavior-spec writing issue

A behavior spec writing issue exists to shape exact durable behavior or policy
after product intent is clear enough for acceptance-ready requirements. It
should identify the owning artifact, the uncertainty to resolve, and any
implementation issues expected after the owning durable AFDS artifact lands.

### 5.3 Implementation issue

An implementation issue is already sliced enough to execute. It may reference an
owning behavior spec, but it can also use repro steps, tests, audit output, PR
comments, existing code investigation, stable requirement IDs, scenario IDs,
headings, or explicit acceptance criteria as the immediate execution contract.

Prefer stable requirement IDs, scenario IDs, headings, or named anchors over
line-number references. Line numbers drift too easily to be durable contracts.

### 5.4 Hybrid issue

Hybrid work is allowed only for narrow changes with no new architectural
decision, contract boundary, schema migration, security policy, or broad
workflow change.

If any of those blockers appear, split the work: shape the owning durable AFDS
artifact first, then slice implementation issues.

### 5.5 Gardening issue

A gardening issue improves existing docs without changing product behavior or
workflow policy. It should name the stale, missing, or misprofiled docs and link
to the owning standard or checklist.

Gardening can opportunistically align existing docs with
[documentation-standard.md](documentation-standard.md), but it should not force a
big-bang migration.

### 5.6 Skill/agent issue

A skill/agent issue changes reusable workflow behavior, agent roles, prompt
templates, or generated target files. If the issue changes durable policy, the
owning repo guideline should change too. If it only changes implementation of an
already accepted workflow, the issue can execute directly.

## 6. Tech Debt Handling

- Small tech debt: create an issue with the `tech-debt` label when it is
  actionable.
- Durable structural debt: create or update `docs/tech-debt/` when issue labels
  are insufficient to preserve the debt record.
- If resolution creates durable decisions or constraints not obvious from code,
  capture them in the owning doc (`docs/product-requirements/`, `docs/specs/`,
  `docs/adr/`, `docs/guidelines/`, etc.) in the same PR.
- Do not use repo docs as a live task board. External issue trackers own live
  status.

## 7. When to Update Repo Docs After Implementation

When a merged PR changes any of these, update the owning doc in the same PR:

- Config format or schema -> `docs/specs/configuration.md`
- CLI commands -> `AGENTS.md` command table and `docs/specs/cli-commands.md`
- Product intent, users, goals, outcomes, or risks ->
  `docs/product-requirements/`
- Module boundaries or file structure -> `MAP.md`, `AGENTS.md`, or
  `docs/arch/overview.md`
- Commit/PR/branch policy -> `CONTRIBUTING.md` and companion guideline docs
- Review or workflow procedures -> respective guideline doc or `WORKFLOW.md`
- Durable decision or rejected alternative -> `docs/adr/`
- Roadmap-scale target output -> `docs/roadmap/`
- Contract ownership or deployed contract artifact -> source owner or
  `contracts/`, depending on the ownership/deployment boundary
