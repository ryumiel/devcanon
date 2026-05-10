# Portable AFDS Toolkit Product Requirements

Scope: DevCanon Portable AFDS Toolkit

---

## Purpose

DevCanon should define and distribute a portable AFDS system for software
development: canonical documentation rules, workflow guidance, reusable skills,
thin agent roles, and generated target-native files that help maintainers move
work from unclear intent to reviewed implementation.

The Portable AFDS Toolkit is the product surface that makes that possible
across Claude Code and Codex without turning DevCanon into a repository-level
document manager. It supports projects that use GitHub Issues or Linear as
their external issue tracker while keeping adoption guided instead of automatic.

This document captures product requirements for that toolkit. It is the
discussion basis for later behavior spec and AFDS Workflow Capability Map
passes.

## Terminology

- **AFDS**: Agent-Friendly Documentation Standard, the repository document model
  that separates durable docs, issue trackers, PRs, and agent-local artifacts.
- **Portable AFDS Toolkit**: DevCanon's product surface for sharing AFDS
  workflows, skills, agent roles, target-native generated outputs, and adoption
  guidance across projects.
- **Target-native output**: a generated output that uses the target tool's
  supported file format, location, metadata, and configuration model.
- **Stable delegate identity**: an agent role identity that remains meaningful
  across tasks, such as reviewer, planner, or debugger.
- **Target-supported constraint**: a role constraint the target tool can enforce,
  such as model, effort, tool access, sandbox, or approval policy.
- **Source behavior**: behavior owned by source artifacts, including source code,
  source skills, source agent roles, and durable source docs.
- **Guided adoption**: DevCanon provides reusable workflows and guidance while
  consumer projects remain responsible for their own repository docs, tracker
  setup, migration choices, and local policy.
- **Source artifact**: an authored file under `skills/`, `agents/`, `docs/`, or
  `src/`.
- **Generated output**: a disposable render result under `generated/<target>/`.
- **Installed managed output**: a target-home file or directory installed by
  `devcanon sync` and tracked by the install manifest.
- **Issue-priming entrypoint**: provider-specific setup that fetches a GitHub or
  Linear issue, prepares the worktree, preserves normalized issue context, and
  hands off to the shared issue workflow.
- **Shared issue workflow**: provider-neutral work after issue-priming handoff,
  including readiness checks, shaping, planning, implementation, review, or PR
  preparation as requested.
- **Owning durable AFDS artifact**: a repository-owned doc or source artifact
  that outlives an issue, PR, or agent session and owns durable product intent,
  behavior, policy, architecture, contract authority, roadmap direction, or
  decision rationale.
- **Agent-local artifact**: temporary execution context produced or used by an
  agent session, including plans, scratch files, preserved issue context, and
  `.ephemeral/` files.
- **Shape path**: work that starts from unclear product or workflow intent and
  first creates or updates an owning durable AFDS artifact.
- **Execution path**: work that starts from an already-sliced issue, finding,
  test, or review comment and updates durable docs only when behavior or policy
  changes.
- **AFDS Workflow Capability Map**: a follow-up owning durable AFDS artifact
  that maps AFDS workflow needs to existing skills, agent roles, docs, source
  behavior, or explicit non-goals before new workflow assets are approved.

## Problem

DevCanon already has pieces of an AFDS-based development operating model:

- source skills under `skills/`;
- neutral agent roles under `agents/`;
- generated Claude Code and Codex outputs;
- guidance for document profiles, issue/behavior-spec relationships, PR
  workflow, and skill/agent authoring;
- GitHub and Linear issue-priming entrypoints.

Those pieces need one product requirements artifact that says how DevCanon
should organize AFDS documentation rules, workflow guidance, reusable skills,
and thin agent roles into a coherent product. Without that layer, future skill
and agent work risks duplicating existing behavior or turning requirements,
roadmap, guideline, issue, and implementation details into one mixed artifact.

## Users

Priority order for tradeoffs:

1. AFDS project maintainer adoption.
2. DevCanon source-authoring integrity.
3. Agent ergonomics and automation convenience.

### AFDS Project Maintainer

A maintainer wants to adopt a repeatable AI-assisted development workflow in a
project without rewriting the entire repository or binding the project to one
AI coding tool.

### DevCanon Contributor

A contributor wants to add or refine skills, agents, validation, docs, or
generated outputs while preserving DevCanon's source-first and skills-first
model.

### Agent Running DevCanon Workflows

An agent needs clear durable context for where behavior, workflow policy, live
issue state, review state, and temporary execution detail belong.

## Product Goals

### PR-001: Portable AFDS Adoption

DevCanon should make it practical for a project to adopt AFDS through reusable
workflows and guidance rather than repository automation that rewrites or owns
the consumer project.

### PR-002: One Source Library, Multiple Targets

DevCanon should let users define reusable skills and agent roles once, then
render usable target-native outputs for Claude Code and Codex.

### PR-003: Skills as the Primary Workflow Unit

DevCanon should keep reusable AFDS method, checklists, and operating procedures
in skills by default.

### PR-004: Thin Agent Roles

DevCanon should use agent roles only when stable delegate identity or
target-supported constraints add value beyond a skill.

### PR-005: Provider-Neutral Issue Workflow

DevCanon should support AFDS projects that use GitHub Issues or Linear while
keeping durable guidance provider-neutral unless behavior is specific to one
tracker.

### PR-006: Clear Systems of Record

DevCanon should help maintainers and agents keep durable repository knowledge,
live issue state, PR review state, and temporary agent execution detail in
separate systems of record.

### PR-007: Conservative Workflow Expansion

DevCanon should require proposed AFDS workflow skills and agent roles to be
classified against existing assets before they are created or changed.

## Target Outcomes

The Portable AFDS Toolkit should enable these outcomes:

- A new or existing project can understand the AFDS adoption path without
  making DevCanon manage its repository docs.
- A GitHub Issues-backed project can run issue-priming entrypoints and shared
  issue workflow while keeping live work state in GitHub Issues.
- A Linear-backed project can use the same source library and target outputs
  while keeping live work state in Linear.
- Contributors can tell when to create a skill, when to create an agent, and
  when to update a durable repository doc instead.
- Agents can route work through shape-path or execution-path workflows without
  treating issues, PRs, or `.ephemeral/` files as durable authority.
- Future AFDS workflow proposals can be evaluated against existing skills, agent
  roles, docs, and source behavior before new entrypoints are approved.

## Functional Requirements

### FR-001: Guided Adoption

The toolkit should provide guidance and reusable workflows for AFDS adoption,
but the consumer project should remain responsible for its own repository docs,
local policy, tracker setup, and migration choices.

### FR-002: Source-First Authoring

The toolkit should preserve source files as the authoring surface:

- `skills/` for reusable workflow source;
- `agents/` for neutral agent role source;
- `docs/product-requirements/` for product intent and requirements that are not
  yet behavior specs;
- `docs/specs/` for exact behavior specs and acceptance-ready requirements;
- source-owned schemas, validators, and types for exact interface contracts.

Generated outputs and installed managed outputs should not be treated as source
files.

### FR-003: Target Output Support

The toolkit should continue to produce Claude Code and Codex outputs from the
same source library.

Target details belong to behavior specs and renderer or installer source
modules. This product requirement only establishes that both targets remain in
scope for Portable AFDS Toolkit behavior.

### FR-004: GitHub and Linear Issue Support

The toolkit should support GitHub Issues-backed and Linear-backed AFDS projects.

Issue-tracker-specific behavior should live in the relevant source skills and
supporting integration surfaces. Durable guidance should use provider-neutral
language unless GitHub or Linear behavior is being described directly.

### FR-005: Shape Path Support

The toolkit should support work that starts from product or workflow
uncertainty and needs an owning durable AFDS artifact before implementation is
sliced.

That path may produce or update a product requirements document, behavior spec,
guideline, roadmap item, ADR, or another owning durable AFDS artifact. The
exact procedure belongs in workflow guidance and skills, not in this
requirements document.

### FR-006: Execution Path Support

The toolkit should support work that starts from an already-sliced issue,
failing test, review comment, audit finding, or other concrete execution
contract.

Execution-path work should update durable docs only when the implementation
changes behavior, policy, product intent, contract ownership, architecture, or
verification expectations.

### FR-007: Workflow Coverage

The toolkit should cover the core AFDS work journeys needed to move from
unclear intent to reviewed implementation:

- shape unclear product or workflow intent into the correct owning durable AFDS
  artifact;
- derive behavior, guideline, roadmap, ADR, or issue work from stable product
  requirements;
- prime GitHub Issues-backed and Linear-backed execution work;
- plan, execute, verify, and review implementation work;
- identify when documentation impact requires an owning durable AFDS artifact
  update.

Coverage may be delivered through existing skills, updated skills, agent roles,
documentation, or source behavior. This requirement does not approve a separate
entrypoint for each journey.

### FR-008: Workflow Capability Classification

The toolkit should require proposed AFDS workflow additions to be classified
against existing skills, agent roles, documentation, and source behavior before
new entrypoints are created.

A workflow proposal should identify whether the need is best handled by:

- updating an existing skill;
- updating documentation or behavior specs;
- updating source behavior;
- creating a new skill;
- creating or changing an agent role;
- deferring or rejecting the proposal.

This requirement does not approve any named new skill, agent role, or command.

## Non-Functional Requirements

### NFR-001: Low-Rot Documentation

Product requirements should state product intent and requirements without
copying detailed workflow procedure, behavior-spec content, exact interface
contracts, or implementation details.

### NFR-002: Agent Legibility

Product requirements should use stable headings and requirement IDs so agents
can reference durable product intent without depending on line numbers.

### NFR-003: Provider Portability

Product requirements should keep GitHub- and Linear-specific behavior isolated
to the places where provider differences matter.

## Boundaries and Non-Goals

The Portable AFDS Toolkit should not:

- become a repository-level document manager;
- automatically rewrite or migrate consumer repositories;
- force existing projects into one mandatory document template;
- make generated outputs authoritative source files;
- duplicate live issue state, PR state, schedules, assignees, branch plans, or
  agent-local execution logs in durable docs;
- approve future workflow skill or agent-role additions outside the
  product-requirements authoring split without AFDS Workflow Capability Map
  classification;
- duplicate exact source-owned contract fields already owned by schemas, types,
  validators, renderers, installers, or focused behavior specs.

## Assumptions, Risks, and Open Questions

### Assumptions

- AFDS projects benefit from separating product requirements, behavior specs,
  roadmap direction, guidelines, issues, PRs, and agent-local plans.
- GitHub Issues and Linear remain the first supported external issue trackers.
- Claude Code and Codex remain the first supported output targets.
- Existing skills and agents cover part of the desired workflow surface.
- Consumer projects are willing to adopt AFDS conventions deliberately rather
  than receive automatic repository rewrites.
- Users can provide the tracker and target-tool access required by the relevant
  workflows.

### Risks

- If product requirements and behavior specs share one profile, contributors may
  treat broad product intent as acceptance-ready behavior.
- If DevCanon creates new workflow skills before reviewing existing assets, it
  may duplicate `play-*`, issue-priming, review, or documentation-gardening
  behavior.
- If provider-specific issue behavior leaks into provider-neutral guidance, the
  toolkit may become harder to adopt across GitHub Issues and Linear.
- If Claude Code, Codex, GitHub Issues, or Linear change their supported
  surfaces, target parity may drift.

### Resolved Workflow Decisions

- `write-product-spec` is supplemented by `write-product-requirements` so
  product requirements and behavior specs have distinct source authoring
  workflows. `write-product-spec` remains the behavior-spec workflow unless a
  later migration decision renames it. This is the bounded decision for the
  product-requirements authoring gap identified by this PRD; broader AFDS
  workflow skill or agent-role additions still require AFDS Workflow Capability
  Map classification.

### Open Questions

- Should the AFDS Workflow Capability Map be maintained as reusable workflow
  guidance or as one or more ADRs for bounded skill and agent-role decisions?

## Expected Follow-Up Artifacts

Stable requirements from this document can derive narrower owning artifacts.

Immediate next artifact: a behavior spec for Portable AFDS Toolkit source
artifacts, generated outputs, installed managed outputs, and systems-of-record
boundaries.

Later follow-up artifacts may include:

- an AFDS Workflow Capability Map under `docs/guidelines/` if the follow-up
  defines reusable workflow policy;
- ADRs if the follow-up records bounded decisions about adding, rejecting, or
  restructuring skills or agent roles;
- implementation issues after the owning durable AFDS artifact is stable enough
  to execute.

## PRD Readiness Criteria

These requirements are ready to drive one immediate next artifact when:

- the Portable AFDS Toolkit purpose, target users, and priority order are clear;
- key terms are defined or linked to owning definitions;
- GitHub Issues and Linear support are stated as issue-tracker options;
- target outputs for Claude Code and Codex are in scope;
- source-owned authoring surfaces, generated-output boundaries, installed-output
  boundaries, contract authority, and systems of record are stated without
  duplicating exact contracts;
- product validation criteria name the pilot signals required;
- assumptions, risks, and open questions are explicit;
- follow-up workflow surfaces are identified without approving them;
- the immediate next owning artifact is named;
- the new requirements path is discoverable from `MAP.md`.

Not included in the first derivation: AFDS Workflow Capability Map decisions,
additional new skill approval beyond `write-product-requirements`, new
agent-role approval, and provider-specific issue workflow behavior.

## Product Validation Criteria

The Portable AFDS Toolkit is product-valid when pilot use demonstrates that:

- one GitHub Issues-backed project and one Linear-backed project can identify
  the AFDS adoption path from DevCanon documentation without DevCanon rewriting
  repository docs;
- each pilot can route issue-priming entrypoints, shared issue workflow,
  implementation planning, and completion verification while live work state
  remains in the external tracker;
- Claude Code and Codex outputs are generated from the same source library and
  are usable by their target tools without manual rewriting;
- contributors can identify whether a change belongs in product requirements,
  a behavior spec, a roadmap, a guideline, source-owned implementation, an
  issue, a PR, or an agent-local artifact;
- pilot notes identify missing behavior specs, guidelines, or skills as
  follow-up artifacts rather than embedding those procedures in this PRD.

Pilot outcomes should be recorded in a follow-up issue, PR notes, or a durable
validation summary linked from the derived artifact.

## PRD Maintenance Checks

Changes to this PRD should verify that:

- markdown formatting and linting pass;
- links point to existing owning artifacts;
- requirement IDs and headings remain stable unless intentionally renamed;
- no live issue status, PR state, branch plan, assignee, schedule, or
  agent-local execution log is introduced;
- no behavior-spec scenarios, exact contract field lists, renderer details, or
  workflow procedures are copied into the PRD;
- any newly implied next artifact is named or captured as an open readiness
  blocker;
- `MAP.md` remains updated when this path is introduced or renamed.

## Future Change Constraints

Future changes should preserve these product constraints:

- this document owns product intent and broad requirements, not workflow
  procedure or implementation plans;
- external issue trackers own live work state;
- PRs own review and merge state;
- `.ephemeral/` artifacts own temporary agent execution detail;
- generated outputs and installed managed outputs remain non-source artifacts;
- new workflow skills or agent roles require classification against existing
  DevCanon assets before approval.
