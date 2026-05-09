---
name: write-product-requirements
description: Product requirements authoring workflow for durable product intent before behavior specs or issue slicing. Use when creating, updating, drafting, reviewing, or shaping docs/product-requirements content. Do not use for acceptance-ready behavior specs, roadmap sequencing, architecture decisions, implementation plans, or live issue tracking.
---

# Write Product Requirements

## Overview

Create or update durable product requirements documents under
`docs/product-requirements/`. A PRD owns product intent before behavior specs,
issue slicing, implementation planning, or execution work can derive from it.
It must include readiness criteria, product validation criteria, and
expected follow-up artifact references when those concerns apply.

This skill is a narrow authoring workflow. It is not a behavior-spec,
roadmap, architecture, contract, issue-tracking, PR state, or agent-local
planning workflow.

## When To Use

Use when product intent is not clear enough to write acceptance-ready behavior
specs or slice implementation issues.

Use when the task is to create, update, shape, draft, or review product
requirements content, especially a file under `docs/product-requirements/`.

Do not use for exact behavior specs under `docs/specs/`, roadmap sequencing,
ADRs, architecture docs, reusable workflow guidelines, implementation plans,
live issue tracking, PR state, or routine execution work.

## Inputs

Gather durable inputs:

- Existing product requirements under `docs/product-requirements/`
- Owning documentation standards or profile rules
- Existing behavior specs, roadmap docs, ADRs, architecture docs, guidelines,
  or contract artifacts that constrain product intent
- Research, tests, and code investigation used as evidence
- Issues, PRs, design notes, and agent-local notes used as evidence

Treat issues, PRs, design notes, research, tests, and code investigation as
evidence, not durable authority. Do not copy live state into the PRD.

## Procedure

1. Run the profile gate. Proceed only when product intent belongs in a PRD.
2. Identify the owning PRD path. The output is
   `docs/product-requirements/<topic>.md`; never create root `PRD.md` or
   other repository-root PRD files.
3. Redirect wrong-profile content:
   - Exact behavior, acceptance-ready scenarios, and verification
     expectations belong in `docs/specs/<topic>.md` via `write-product-spec`.
   - Repeatable procedure, contributor policy, and workflow rules belong in
     `docs/guidelines/`, `WORKFLOW.md`, or `CONTRIBUTING.md`.
   - Roadmap-scale direction and sequencing belong in `docs/roadmap/`.
   - Durable decisions, rationale, consequences, and major alternatives
     belong in `docs/adr/`.
   - Architecture shape, module boundaries, data flow, and dependency
     direction belong in `docs/arch/`.
   - Exact interface fields and durable contracts belong with their source
     code or contract authority.
   - Live issue state belongs in the issue tracker.
   - PR state belongs in the PR system.
   - Branch plans, execution notes, and agent-local execution detail belong in
     `.ephemeral/` artifacts.
4. Draft or update the smallest complete PRD that captures the product intent.
5. Dogfood against the Portable AFDS Toolkit PRD at
   `docs/product-requirements/portable-afds-toolkit.md` when this workflow
   itself changes.
6. Verify the PRD against the boundary checklist before finishing.

## Product Requirements Shape

Use headings that fit the existing PRD, but cover these concerns:

- Problem: what product problem needs durable ownership.
- Users: who is affected or served by the requirement.
- Goals and outcomes: what success should make true for users or maintainers.
- Broad requirements: product-level requirements that are not yet exact
  behavior scenarios.
- Assumptions, risks, and dependencies: durable context that affects product
  choices.
- Open questions: product decisions still blocking derivation.
- Readiness criteria: what must be true before the next artifact can own the
  work.
- Product validation criteria: how to tell the product intent has been
  satisfied.
- Expected follow-up artifact references: behavior specs, issues, ADRs,
  roadmap docs, architecture docs, guidelines, or contracts expected to derive
  from the PRD.
- Stable requirement IDs, named sections, and headings when useful for future
  references.

Prefer stable requirement IDs, named sections, and headings over
line-number references.

## Boundary Checklist

Before finalizing, confirm:

- The file is `docs/product-requirements/<topic>.md`, not root `PRD.md`.
- The PRD captures product intent, not exact behavior scenarios,
  acceptance-ready behavior, interface field lists, architecture, roadmap
  sequencing, workflow procedure, implementation plans, live issue state, PR
  state, branch plans, schedules, assignees, or agent-local execution detail.
- The PRD links to contract authority rather than duplicating contract fields.
- The PRD links source-owned schemas, types, validators, renderers,
  installers, or explicit artifact-owned contracts when exact contracts
  constrain product intent.
- Stable requirement IDs, named sections, and headings are used when future
  work needs durable references.
- Readiness criteria name the immediate next owning artifact or the unresolved
  product decision blocking derivation.

## Contract Authority

Always link contract authority such as source-owned schemas, types, validators,
renderers, installers, or explicit artifact-owned contracts. Do not duplicate
exact fields in the PRD.

## Readiness

Readiness criteria must name the immediate next owning artifact or the
unresolved product decision blocking derivation.

## Outputs

Return the created or updated `docs/product-requirements/<topic>.md` path and
summarize the product intent captured. If the profile gate says no PRD is
needed, say that directly and name the owning artifact instead.
