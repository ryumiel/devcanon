---
name: write-product-spec
description: Behavior-spec authoring workflow for durable product and workflow behavior. Use when writing, creating, updating, drafting, reviewing, or shaping docs/specs content or behavior requirements. Do not use for routine execution work unless it reveals a durable behavior or policy gap.
---

# Write Product Spec

## Overview

Create or update durable behavior specs under `docs/specs/`. A behavior spec
owns intended behavior, requirements, boundaries, acceptance criteria,
verification expectations, and agent-facing context.

This skill is a narrow authoring workflow. It is not a general planning,
architecture, roadmap, contract, issue-tracking, or documentation-gardening
workflow.

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

## Inputs

Gather only durable inputs:

- Existing behavior specs under `docs/specs/`
- Owning documentation standards or profile rules
- Source-owned contract authority such as schemas, types, validators, or
  generated contract artifacts
- Issues, PRs, design notes, tests, and code investigation used as evidence

Treat issues, PRs, and agent-local notes as evidence, not as durable content
to copy into the spec.

## Procedure

1. Run the profile gate. Proceed only when the artifact should own durable
   intended behavior, requirements, boundaries, acceptance criteria,
   verification expectations, or agent context.
2. Identify the owning spec path. The output is
   `docs/specs/<topic>.md`; never create root `SPEC.md`.
3. Redirect wrong-profile content:
   - Architecture shape, module boundaries, data flow, and dependency
     direction belong in `docs/arch/`.
   - Durable decisions, rationale, consequences, and major alternatives
     belong in `docs/adr/`.
   - Repeatable procedure, contributor policy, and workflow rules belong in
     `docs/guidelines/`, `WORKFLOW.md`, or `CONTRIBUTING.md`.
   - Roadmap-scale target output belongs in `docs/roadmap/`.
   - Exact interface fields belong with their contract authority.
   - Live work state belongs in the issue tracker, PR system, or
     `.ephemeral/` agent-local artifacts.
4. Draft or update the behavior spec using the smallest complete shape that
   captures the durable behavior.
5. Verify the spec against the boundary checklist before finishing.

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
- Agent context: concise constraints future agents must preserve.

Optional sections can cover assumptions, open questions, migration,
compatibility, glossary terms, or rejected non-behavior content when they
materially improve the spec.

## Boundary Checklist

Before finalizing, confirm:

- The file is `docs/specs/<topic>.md`, not root `SPEC.md`.
- The spec excludes live issue status, assignees, PR lists, schedules,
  sub-issue inventories, branch names, and single-PR execution plans.
- The spec links to contract authority rather than duplicating contract
  fields; source-owned schemas, types, and validators stay authoritative
  unless an artifact-owned contract exists.
- The spec distinguishes behavior from architecture docs, ADRs, contracts,
  roadmap items, reusable workflow guidelines, and issue plans.
- Stable requirement IDs, scenario IDs, headings, or named anchors are used
  when future work needs durable references.
- The change does not implement or imply approval for
  `spec-readiness-review`, `slice-issues`, `doc-impact-review`, or new agent wrappers.

## Outputs

Return the created or updated `docs/specs/<topic>.md` path and summarize the
durable behavior captured. If the profile gate says no behavior spec is
needed, say that directly and name the owning artifact or system of record
instead.
