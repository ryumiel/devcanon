---
name: write-product-spec
description: Behavior-spec authoring workflow for durable product and workflow behavior under docs/specs. Use when writing, creating, updating, drafting, reviewing, or shaping acceptance-ready behavior requirements. Do not use for broad product intent or PRDs; use write-product-requirements for docs/product-requirements work.
---

# Write Product Spec

## Overview

Create or update durable behavior specs under `docs/specs/`. A behavior spec
owns intended behavior, requirements, boundaries, acceptance criteria,
verification expectations, and agent-facing context.

Broad product intent belongs to `write-product-requirements` and
`docs/product-requirements/` before it is clear enough for acceptance-ready
behavior specs.

This skill is a narrow authoring workflow. It is not a general planning,
architecture, roadmap, contract, issue-tracking, or documentation-gardening
workflow.

Load `references/behavior-spec-evidence-routing.md` as the portable runtime
authority for evidence pointers, readiness review, and downstream issue
slicing. Repo-local AFDS docs are optional project context when present. Do not
treat repo-local AFDS docs as required runtime inputs.

## When To Use

Use when the task is to create, update, shape, draft, or review a durable
product or behavior spec, especially a file under `docs/specs/`.

Use when implementation work reveals a durable behavior or policy gap that
belongs in `docs/specs/`, such as unclear intended behavior, missing
acceptance criteria, undefined boundaries, or reusable verification
expectations.

Do not use for routine bug fixes, dependency audits, review-feedback patches,
docs gardening, or behavior-preserving refactors unless the work reveals a
durable behavior or policy gap that belongs in `docs/specs/`.

Do not use for product intent that is not clear enough for acceptance-ready
behavior; use `write-product-requirements` for `docs/product-requirements/`
work instead.

## Inputs

Gather only durable inputs:

- Existing behavior specs under `docs/specs/`
- Owning documentation standards or profile rules
- Source-owned contract authority such as schemas, types, validators, or
  generated contract artifacts
- Issues, PRs, design notes, tests, and code investigation used as evidence

Treat issues, PRs, and agent-local notes as evidence, not as durable content
to copy into the spec. Record an evidence pointer instead: name the evidence
system, stable reference, checked requirement or owner, result state, and any
blocker or follow-up owner. For behavior specs, record incomplete, private,
inaccessible, or failing evidence follow-up as a durable team, system, role, or
artifact instead of person names, assignees, reviewer names, or live tracker
ownership.

## Procedure

1. Run the profile gate. Proceed only when the artifact should own durable
   intended behavior, requirements, boundaries, acceptance criteria,
   verification expectations, or agent context.
2. Identify the owning spec path. The output is
   `docs/specs/<topic>.md`; never create root `SPEC.md`.
3. Redirect wrong-profile content:
   - Broad product intent and PRD content belong in
     `docs/product-requirements/` via `write-product-requirements`.
   - Architecture shape, module boundaries, data flow, and dependency
     direction belong in `docs/arch/`.
   - Durable decisions, rationale, consequences, and major alternatives
     belong in `docs/adr/`.
   - Repeatable procedure, contributor policy, and workflow rules belong in
     `docs/guidelines/`, `{{file:workflow-guide}}`, or `CONTRIBUTING.md`.
   - Roadmap-scale target output belongs in `docs/roadmap/`.
   - Exact interface fields belong with their contract authority.
   - Live work state belongs in the issue tracker, PR system, or
     `.ephemeral/` agent-local artifacts.
4. Draft or update the behavior spec using the smallest complete shape that
   captures the durable behavior.
5. Record evidence pointers that support the requirements, acceptance
   criteria, verification expectations, and durable team, system, role, or
   artifact owner links without copying live issue, PR, CI, or agent-local state
   into the spec.
6. Optionally use `write-prose` as a local wording pass after this skill has
   established the spec path, behavior requirements, evidence pointers,
   acceptance criteria, verification expectations, and agent context. The
   prose pass must preserve behavior-spec authority and must not add, remove,
   or strengthen requirements, scenarios, acceptance criteria, evidence
   results, verification expectations, or slicing readiness.
7. Verify the final edited spec against the boundary checklist before
   finishing, readiness review, or issue slicing. If `write-prose` was used,
   this verification must cover the prose-polished spec, not only the earlier
   draft.
8. When the spec is ready to become executable work, route through
   `spec-readiness-review` for readiness review before handing the spec,
   readiness evidence, or evidence pointers to `issue-slicing` to draft
   executable issue content.

## Behavior Spec Shape

Use headings that fit the existing spec, but cover these concerns:

- Purpose and problem: why this behavior needs durable ownership.
- Scope and non-goals: what the spec owns and explicitly does not own.
- Requirements: durable behavior statements with stable IDs or named
  scenarios when useful.
- Behavior scenarios or examples: observable outcomes, not implementation
  logs or UI click scripts.
- Contract authority: links to source-owned schemas, types, validators, or
  artifact-owned contracts instead of duplicating exhaustive fields.
- Acceptance criteria: what must be true for implementation to satisfy the
  spec.
- Verification expectations: tests, commands, review checks, or inspection
  steps that prove the behavior.
- Evidence pointers: durable links to issues, PRs, source findings, tests, or
  review evidence that support readiness and later slicing without copying
  live state.
- Agent context: concise constraints future agents must preserve.

Optional sections can cover assumptions, open questions, migration,
compatibility, glossary terms, or rejected non-behavior content when they
materially improve the spec.

## Boundary Checklist

Before finalizing, confirm:

- The file is `docs/specs/<topic>.md`, not root `SPEC.md`.
- The spec excludes broad product intent and PRD content; those belong in
  `docs/product-requirements/`.
- The spec excludes live issue status, assignees, PR lists, schedules,
  sub-issue inventories, branch names, and single-PR execution plans.
- The spec links to contract authority rather than duplicating contract
  fields; source-owned schemas, types, and validators stay authoritative
  unless an artifact-owned contract exists.
- The spec distinguishes behavior from architecture docs, ADRs, contracts,
  roadmap items, reusable workflow guidelines, and issue plans.
- Stable requirement IDs, scenario IDs, headings, or named anchors are used
  when future work needs durable references.
- Evidence pointers identify the evidence system, stable reference, checked
  requirement or owner, result state, and any blocker or follow-up owner. For
  incomplete, private, inaccessible, or failing evidence, use a durable team,
  system, role, or artifact owner link without copying live tracker, PR, CI,
  agent-local state, person names, assignees, reviewer names, or live tracker
  ownership.
- Slice-ready behavior points to `spec-readiness-review` for readiness review
  before the approved `issue-slicing` handoff instead of inventing
  provider-specific issue mutation.
- The change does not implement or imply approval for unapproved follow-up
  surfaces such as `doc-impact-review`, `post-merge-gardener`, or new agent
  roles.

## Outputs

Return the created or updated `docs/specs/<topic>.md` path and summarize the
durable behavior captured. If the profile gate says no behavior spec is
needed, say that directly and name the owning artifact or system of record
instead.
