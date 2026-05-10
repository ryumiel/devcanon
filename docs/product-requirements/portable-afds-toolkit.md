# Portable AFDS Toolkit Product Requirements

Scope: DevCanon Portable AFDS Toolkit

---

## Purpose

DevCanon should provide a portable system for software development where AI
agents and human developers can work from shared understanding, durable
knowledge, and aligned workflows.

The Portable AFDS Toolkit is the product surface that makes that possible by
helping projects put the right knowledge in the right place: product intent in
product requirements, exact behavior in behavior specs, reusable procedure in
guidelines and skills, live work state in issue trackers, review state in PRs,
and temporary execution detail in agent-local artifacts.

The toolkit supports iterative development rather than a one-way waterfall.
Product requirements, behavior specs, guidelines, issues, PRs, and source code
may change as discovery and implementation reveal better information, but each
change should update the owning artifact instead of copying stale summaries
across multiple systems of record.

The toolkit works across Claude Code and Codex without turning DevCanon into a
repository-level document manager. It supports projects that use GitHub Issues
or Linear as their external issue tracker while keeping adoption guided instead
of automatic.

This document captures product requirements for that toolkit. It is the
discussion basis for later behavior spec and AFDS Workflow Capability Map
passes.

## Terminology

- **AFDS**: Agent-Friendly Documentation Standard, the repository document model
  that separates durable docs, issue trackers, PRs, and agent-local artifacts.
- **Portable AFDS Toolkit**: DevCanon's product surface for sharing AFDS
  workflows, reusable guidance, and target-tool support across projects.
- **Guided adoption**: DevCanon provides reusable workflows and guidance while
  consumer projects remain responsible for their own repository docs, tracker
  setup, migration choices, and local policy.
- **Owning durable AFDS artifact**: a repository-owned source of truth that
  outlives an issue, PR, or agent session and owns durable product intent,
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

AI-assisted software development depends on humans and agents finding the right
knowledge at the right moment during investigation, design, implementation, and
review. In practice, that knowledge is often scattered across durable docs,
issues, PRs, source code, chat history, tool-specific instructions, and
agent-local notes. Teams lose time rediscovering context, agents act from
incomplete or outdated assumptions, and important product or workflow intent is
easy to miss.

When sources of truth are unclear, durable decisions, live work state,
implementation notes, review conclusions, and temporary agent context drift
into competing places. Product intent can be repeated in behavior specs, exact
behavior can be summarized in issues, reusable policy can drift into PRs, and
agent-local execution detail can be mistaken for durable documentation. This
creates stale information, contradictory requirements, and confusion about
which artifact is authoritative.

This becomes most costly during iterative development. Discovery and
implementation legitimately change what the team knows, but without a shared
rule for which artifact owns each kind of truth, updates land in whichever
surface is active at the moment. The result is weak traceability from product
intent to behavior, work items, implementation, review, and follow-up
documentation.

Teams also need common agent skills and workflow policies to apply consistently
across repositories and tasks. Those practices are hard to enforce when they
live as informal prompts, one-off instructions, or target-tool-specific setup.
The problem is compounded because users may use different agentic coding tools
or switch tools over time, and should not have to redesign their development
workflow each time their toolchain changes.

The Portable AFDS Toolkit needs to make the ownership model portable and usable
across projects. It should help teams decide where knowledge belongs, how
changes propagate when understanding evolves, and how to trace work across
durable requirements, behavior specs, reusable policy, live issue state, PR
review state, source changes, and temporary agent-local artifacts without
turning any one artifact into an everything document.

## Users

Priority user personas for tradeoffs:

1. Product Leader.
2. Human Developer with Agent.
3. DevCanon Contributor.

### Product Leader

A product leader shapes product intent into durable requirements, behavior
specs, and executable issues. They need product decisions, open questions,
readiness criteria, and follow-up artifacts to stay clear and traceable as the
work changes over time.

### Human Developer with Agent

A human developer works with AI agents to investigate, implement, review, and
maintain product work. They need both human and agent participants to find the
right knowledge, follow aligned workflows, and update the owning artifact when
implementation changes understanding.

### DevCanon Contributor

A DevCanon contributor evolves the reusable toolkit itself. They need source
skills, agent roles, docs, validation, and generated outputs to remain
source-first, portable across target tools, and clear about when to update an
existing asset instead of creating another workflow surface.

## Product Goals

### PR-001: Guided AFDS Adoption

DevCanon should make it practical for a project to adopt AFDS deliberately,
understand where knowledge belongs, and improve its docs and workflows without
DevCanon rewriting or owning the consumer repository.

### PR-002: Traceable Product-to-Implementation Lifecycle

DevCanon should help Product Leaders keep product intent, behavior specs,
workflow guidance, executable issues, source changes, review outcomes, and
follow-up artifacts connected as understanding changes.

### PR-003: Shared Human-Agent Operating Context

DevCanon should help Human Developers with Agent ensure that human and agent
participants can find the same authoritative context, follow compatible
workflows, and update the owning artifact when implementation changes
understanding.

### PR-004: Portable Workflow Across Tools

DevCanon should let teams use the same AFDS workflow model across Claude Code,
Codex, GitHub Issues, and Linear while keeping target- or provider-specific
behavior isolated where it belongs.

### PR-005: Clear Systems of Record

DevCanon should help maintainers, developers, and agents distinguish durable
knowledge, live issue state, PR review state, generated outputs, installed
outputs, and temporary agent-local execution detail.

### PR-006: Low-Rot Artifact Lifecycle

DevCanon should help teams detect, evaluate, and resolve stale, duplicated,
misplaced, or conflicting knowledge over time without turning DevCanon into a
repository-level document manager.

### PR-007: Coherent Toolkit Evolution

DevCanon should help contributors evolve reusable AFDS support without
duplicating workflow surfaces, creating unnecessary tool-specific assets, or
making generated outputs authoritative.

## Product Surface

The Portable AFDS Toolkit should be visible to users through a small set of
coherent surfaces:

- documentation entry points that route users to AFDS adoption, artifact
  ownership, and lifecycle-routing guidance;
- reusable workflow assets that guide shaping, execution, review, verification,
  gardening, and capability evaluation without naming repository-local history
  documents as outputs;
- neutral role definitions only when stable delegate identity or
  target-supported constraints justify a role beyond reusable workflow
  guidance;
- generated Claude Code and Codex outputs produced from the same source
  library;
- GitHub Issues and Linear guidance that keeps live work state in the external
  tracker;
- validation and checking guidance that links to evidence in the owning system
  instead of copying execution history into durable docs;
- examples that show how Product Leaders and Human Developers with Agent move
  from intent to execution without collapsing systems of record.

## Target Outcomes

The Portable AFDS Toolkit should enable these outcomes:

- A Product Leader can see where product intent belongs, which behavior specs
  or issues derive from it, and what follow-up artifact should change when new
  information appears.
- A Human Developer with Agent can start investigation, design, implementation,
  or review work and quickly find the authoritative context needed for that
  task.
- Humans and agents can tell which artifact owns each kind of truth, so they do
  not treat issues, PRs, generated outputs, installed outputs, or
  agent-local notes as durable authority.
- A GitHub Issues-backed or Linear-backed project can keep live work state in
  its tracker while using the same AFDS knowledge model and reusable workflow
  guidance.
- A team can switch between Claude Code and Codex without rewriting its AFDS
  source library or redesigning its development workflow.
- A team can revise product requirements, behavior specs, workflow guidance,
  issues, PRs, and source code as it learns while preserving one owning system
  of record per concern.
- A team can identify stale, duplicated, misplaced, or conflicting knowledge and
  route the correction to the artifact that owns that truth.
- A DevCanon Contributor can evaluate whether a workflow need belongs in an
  existing asset, a changed asset, a new asset, or no asset before expanding the
  toolkit surface.

## Functional Requirements

### FR-001: Artifact Ownership Model

The toolkit should help users identify the authoritative owner for product
intent, intended behavior, reusable policy, architecture, decisions, roadmap
direction, live work state, PR review state, source contracts, validation
evidence, generated outputs, installed outputs, and agent-local execution
detail.

When no owner is clear, the toolkit should surface the ambiguity instead of
letting humans or agents silently choose a convenient artifact.

### FR-002: Authoritative Context Discovery

The toolkit should provide a predictable discovery path so humans and agents can
answer what to read first, what is authoritative, and what can be treated as
evidence or temporary context.

Discovery guidance should prefer stable headings, requirement IDs, named
anchors, and links to owning artifacts over duplicated summaries.

For a fresh Human Developer with Agent, the default start path should route from
the project navigation entry point to the relevant durable AFDS artifact or
source contract, then to the active issue, PR, or evidence system. If the owner
or evidence location is unclear, the workflow should produce a named blocker
instead of inventing a repository-local summary.

### FR-003: Lifecycle Routing

The toolkit should route work based on how it starts:

- unclear product or workflow intent;
- acceptance-ready behavior;
- executable issue work;
- failing tests;
- review comments;
- audit findings;
- implementation discoveries;
- stale, duplicated, misplaced, or conflicting knowledge.

Routing should identify whether the next step is shaping an owning durable AFDS
artifact, executing against an existing contract, updating source behavior,
opening follow-up work, or recording that no durable artifact update is needed.

Ordinary execution work should have a lightweight path. If work starts from an
executable issue, review comment, failing test, or audit finding and does not
change durable product intent, behavior, policy, architecture, contract
ownership, or verification expectations, the toolkit should let humans and
agents proceed without capability classification or new durable artifact
creation.

### FR-004: Readiness Gates

The toolkit should define product-level readiness gates for moving work between
durable intent, exact behavior, and execution.

Product requirements should be ready to derive downstream work only when the
problem, users, goals, outcomes, broad requirements, assumptions, risks, open
questions, validation criteria, and expected follow-up artifact are explicit or
the blocking decision is named.

Behavior specs should be ready to drive implementation only when exact intended
behavior, boundaries, acceptance criteria, verification expectations, and
agent-facing context are explicit or the blocking decision is named.

### FR-005: Executable Work Contracts

Issues, review comments, failing tests, audit findings, or other execution
inputs should contain or link to enough stable context to act.

Executable work should identify the owning artifact or source contract,
acceptance criteria or reproduction evidence, validation expectation, known
blockers, and the trigger that would require a durable documentation update.

### FR-006: Iterative Change Propagation

The toolkit should support iterative development in which product requirements,
behavior specs, workflow guidance, issues, PRs, source code, and validation
evidence can change as new information emerges.

When discovery, implementation, review, or validation changes product intent,
behavior, policy, architecture, contract ownership, or verification
expectations, the owning artifact should be updated or the unresolved blocking
decision should be made visible.

### FR-007: Bidirectional Traceability

The toolkit should help users preserve durable trace links from product intent
to derived behavior specs, guidelines, roadmap items, ADRs, executable issues,
source changes, review outcomes, validation evidence, and follow-up artifacts.

Traceability should also support the reverse path from an issue, PR, failing
test, review comment, or audit finding back to the owning durable artifact or
source contract that governs the change.

Trace links should connect related artifacts without copying the same
authoritative claim into multiple systems of record.

### FR-008: Review and Validation Evidence Traceability

PRs should own review state, but durable conclusions from review should route to
the owning artifact, source contract, external issue, or explicit follow-up.

Validation evidence should identify what was checked, which requirement or
execution contract it supports, where the evidence lives, and what follow-up is
required when validation is incomplete or fails.

Minimum evidence pointers should identify the evidence system, a stable
reference such as a PR note, issue comment, CI/check URL, source test reference,
or test command, the checked requirement or execution contract, the result
state, and any named blocker when evidence is incomplete or inaccessible.

### FR-009: Follow-Up Artifact Lifecycle

Follow-up artifacts created from shaping, implementation, review, validation,
or gardening should have an owning AFDS profile, a trigger, a decision state,
and a resolution path.

Resolution may be an owning artifact update, source change, implementation
issue, linked validation evidence, deferral, rejection, or explicit non-goal.

### FR-010: Drift, Conflict, and Gardening

The toolkit should help users detect stale, duplicated, misplaced,
profile-mismatched, derived, or conflicting claims across durable docs, issues,
PRs, source files, generated outputs, installed outputs, and agent-local
artifacts.

When conflict is found, the expected outcome is to identify the authoritative
owner, classify the non-owner content, and route correction to the owner without
creating competing systems of record.

Gardening should maintain existing owning AFDS artifacts through profile
alignment, stale-content removal or consolidation, navigation updates, and
preservation of useful claims in the owning artifact.

### FR-011: Issue Tracker Portability

The toolkit should support GitHub Issues-backed and Linear-backed AFDS projects
through the same AFDS work concepts: work origin, live tracker state, blockers,
acceptance criteria, owning durable artifacts, review handoff, validation
expectations, and follow-up routing.

Provider-specific fields, APIs, and behavior should remain isolated to the
places where provider differences matter.

### FR-012: Target Tool Portability

The toolkit should make reusable AFDS workflows available to Claude Code and
Codex from the same source library with equivalent intent, discoverability,
triggerability, and source references.

Target-specific differences should be explicit, minimal, and owned by
target-specific source fields, renderers, installers, integrations, or focused
behavior specs.

### FR-013: Source Authority and Generated Outputs

The toolkit should preserve source-owned authoring surfaces as authoritative
for reusable workflow guidance, role definitions, durable docs, source
contracts, validation rules, and target-output generation.

Generated outputs and installed managed outputs should be treated as derived
artifacts, not as durable product, behavior, policy, or contract authority.

### FR-014: Toolkit Capability Governance

The toolkit should require proposed workflow additions to be evaluated against
existing guidance, source behavior, target entrypoints, known non-goals, and
follow-up artifact options before expanding the toolkit surface.

A proposal should identify whether the need is best handled by updating an
existing asset, creating a new asset, changing source behavior, creating
follow-up work, deferring, or rejecting the proposal.

## Non-Functional Requirements

### NFR-001: Low Cognitive Overhead

A Human Developer with Agent should be able to enter investigation,
implementation, review, or maintenance work and identify the relevant owning
artifact, current task context, and next routing decision without reading
unrelated workflow history or reconciling competing summaries.

Toolkit guidance should favor short, scannable decision points over prose that
requires humans or agents to infer hidden workflow state.

### NFR-002: Human-Agent Legibility

Durable toolkit artifacts should be readable, scannable, and citable by both
humans and agents through stable headings, requirement IDs, named anchors,
concise terms, explicit ownership cues, and links to owning artifacts.

References should remain useful across edits without relying on line numbers,
private chat history, or agent-local memory.

### NFR-003: Deterministic Routing

Given the same work origin and available evidence, different humans or agents
should reach the same expected owner, route, or blocker unless the ambiguity is
explicitly recorded.

When routing cannot be determined, the toolkit should make the uncertainty
visible instead of encouraging ad hoc placement in the most convenient
artifact.

### NFR-004: Portable Comprehension

Provider-neutral and target-neutral guidance should remain understandable
without requiring GitHub, Linear, Claude Code, or Codex-specific knowledge
first.

Provider-specific or target-specific details may exist, but they should not be
required to understand the AFDS ownership model or decide where work belongs.

### NFR-005: Freshness and Low Rot

Durable artifacts should make stale, duplicated, misplaced, or derived claims
easy to notice and correct during normal work.

Maintainers, humans, and agents should be able to tell which artifact must be
updated when understanding changes without copying the same authoritative claim
across multiple systems of record.

### NFR-006: Traceable Auditability

A later human or agent should be able to reconstruct why work was routed,
changed, validated, deferred, accepted, or rejected from durable links and
recorded evidence.

The toolkit should not depend on private chat history, transient agent notes, or
unlinked PR discussion as the only explanation for durable decisions.

### NFR-007: Governed Evolvability

The toolkit should absorb new AFDS workflow needs, issue-provider surfaces,
target-tool surfaces, and reusable assets without uncontrolled surface growth
or loss of source-first authority.

New or changed workflow assets should preserve generated-output disposability
and explicit classification against existing assets, non-goals, and follow-up
artifact options.

## Boundaries and Non-Goals

The Portable AFDS Toolkit should not:

- become a repository-level document manager;
- automatically rewrite or migrate consumer repositories;
- force existing projects into one mandatory document template;
- make generated outputs authoritative source files;
- duplicate live issue state, PR state, schedules, assignees, branch plans, or
  agent-local execution logs in durable docs;
- create repository-local logbooks, work journals, execution ledgers,
  postmortems, or validation summary narratives for issue, PR, CI, review, or
  incident history that is already owned by external trackers, PR systems,
  CI/check systems, Git history, or linked evidence;
- approve future workflow additions without capability classification against
  existing assets, source behavior, target entrypoints, and known non-goals;
- duplicate exact source-owned contract fields already owned by schemas, types,
  validators, renderers, installers, or focused behavior specs.

Durable lessons or changed requirements from reviews, incidents, validation, or
postmortems should update the owning AFDS artifact instead of preserving the
event narrative in repository documentation.

## Assumptions and Dependencies

- AFDS adoption succeeds only when each kind of knowledge has one clear owning
  system of record.
- Product requirements, behavior specs, guidelines, issues, PRs, source
  contracts, generated outputs, installed outputs, and agent-local artifacts
  each own different lifecycle concerns.
- GitHub Issues and Linear remain the first supported external trackers, and
  live work state remains in those trackers.
- Claude Code and Codex remain the first supported output targets.
- Existing skills, agent roles, docs, and source behavior cover part of the
  desired workflow surface and must be reviewed before new workflow assets are
  approved.
- Consumer projects are willing to adopt AFDS conventions deliberately through
  guidance and reusable workflows rather than automatic repository rewrites.
- Users can provide the tracker, PR, CI/check, repository, and target-tool
  access required by the relevant workflows, or the missing access can be named
  as a blocker.
- Validation and review evidence can live in the system that performed or
  recorded it, with durable artifacts linking to that evidence only when it
  changes durable intent, behavior, policy, routing, or follow-up ownership.

## Product Risks

- If ownership boundaries are unclear, teams may recreate repo-local logbooks,
  duplicate tracker or PR history, or treat temporary agent artifacts as durable
  truth.
- If product requirements and behavior specs share one profile, contributors may
  treat broad product intent as acceptance-ready behavior.
- If lifecycle routing is too heavy, Product Leaders and developers may bypass
  the toolkit and return to ad hoc issue, PR, or chat-based context.
- If traceability requires copied summaries instead of stable links, durable
  artifacts will rot and systems of record will diverge.
- If evidence-location rules are vague, agents may create repo-local logbooks,
  postmortems, validation summaries, or narrative ledgers to compensate for
  missing links.
- If provider-specific issue behavior leaks into provider-neutral guidance,
  GitHub Issues and Linear support may drift into separate workflow models.
- If Claude Code, Codex, GitHub Issues, Linear, or CI/check systems change
  their supported surfaces, target parity and evidence discoverability may
  drift.
- If capability classification becomes too heavy, teams may bypass the toolkit
  during normal work instead of using it to reduce coordination cost.

## Open Decisions and Derivation Blockers

- What durable artifact should own the AFDS Workflow Capability Map: reusable
  workflow guidance, an ADR, or a focused behavior spec?
- Which artifact owns the canonical routing table or decision tree that lets a
  fresh human or agent map work origin to owner, route, or blocker?
- How should the toolkit handle private or inaccessible tracker, PR, or CI
  evidence without copying that evidence into repository documentation?
- What pilot threshold proves that the toolkit reduces process overhead instead
  of adding another review ritual?

## PRD Readiness Gate

This PRD is ready to serve as product direction when:

- the Portable AFDS Toolkit purpose, target users, and priority order are clear;
- key terms are defined or linked to owning definitions;
- a fresh Human Developer with Agent can identify what to read first, what is
  authoritative, what is evidence, and what is temporary context;
- GitHub Issues and Linear support are stated as issue-tracker options;
- target outputs for Claude Code and Codex are in scope;
- source-owned authoring surfaces, generated-output boundaries,
  installed-output boundaries, contract authority, evidence locations, and
  systems of record are stated without duplicating exact contracts;
- product validation criteria test deterministic routing, context discovery,
  evidence location, target portability, and low process overhead;
- traceability, gardening, and drift-evaluation requirements are stated without
  turning the PRD into detailed workflow procedure;
- assumptions, product risks, and open decisions are explicit;
- the new requirements path is discoverable from `MAP.md`.

Not included in this PRD: roadmap sequencing, exact behavior specifications,
workflow procedure, new workflow asset approval, new agent-role approval,
provider-specific issue workflow behavior, and any repo-local narrative artifact
for validation, postmortem, or execution history.

## Product Validation Gate

The Portable AFDS Toolkit is product-valid when pilot use demonstrates that:

- one GitHub Issues-backed project and one Linear-backed project can identify
  the AFDS adoption path from DevCanon documentation without DevCanon rewriting
  repository docs;
- a fresh human and a fresh agent can start from the same work origin and reach
  the same owning artifact, route, evidence location, or named blocker;
- fresh humans and agents can route representative seeded work origins through
  the documented start path without reading unrelated workflow history or
  creating a durable artifact unless a documented trigger fires;
- each pilot can route execution-work setup, shared issue workflow,
  implementation planning, review, and completion verification while live work
  state remains in the external tracker;
- ordinary execution-path work can proceed from an executable issue, review
  comment, failing test, or audit finding without capability classification
  when durable product intent, behavior, policy, architecture, contract
  ownership, and verification expectations do not change;
- Claude Code and Codex outputs are generated from the same source library and
  are usable by their target tools without manual rewriting;
- contributors can identify whether a change belongs in product requirements, a
  behavior spec, a roadmap, a guideline, source-owned implementation, an issue,
  a PR, CI/check evidence, or an agent-local artifact;
- pilot work includes at least one documentation gardening case where stale or
  misplaced durable content is routed to the owning AFDS artifact without
  copying live issue state, PR state, validation history, or agent-local
  execution detail into durable docs;
- pilots can resolve at least one stale, duplicated, or conflicting knowledge
  case by updating the owning artifact rather than copying the same truth into
  multiple locations;
- pilots reduce or remove duplicated durable claims found during the pilot
  instead of preserving them as parallel summaries;
- at least one proposed workflow addition is evaluated through the AFDS
  Workflow Capability Map and results in an explicit update, creation,
  deferral, or rejection decision with evidence linked from the owning artifact;
- pilot notes identify missing behavior specs, guidelines, skills, or source
  behavior as follow-up artifacts rather than embedding those procedures in
  this PRD.

Pilot outcomes should be recorded in the external issue tracker, PR notes,
CI/check output, source tests, or another owning evidence system. Durable AFDS
artifacts should link to that evidence only when it changes durable intent,
behavior, policy, routing, or follow-up ownership.

## PRD Maintenance Gate

Changes to this PRD should verify that:

- markdown formatting and linting pass;
- links point to existing owning artifacts;
- requirement IDs and headings remain stable unless intentionally renamed;
- a fresh human or agent can still discover context, route work, and locate
  evidence without private chat history or agent-local memory;
- no live issue status, PR state, branch plan, assignee, schedule,
  validation-history narrative, postmortem narrative, or agent-local execution
  log is introduced;
- no behavior-spec scenarios, exact contract field lists, renderer details, or
  workflow procedures are copied into the PRD;
- gardening requirements remain framed as ownership, routing, and maintenance
  expectations rather than detailed cleanup procedure;
- toolkit evaluation requirements distinguish capability-classification gates
  from pilot validation evidence;
- changes are checked for newly duplicated, stale, or conflicting authority
  across PRDs, specs, guidelines, roadmap items, issues, PRs, source contracts,
  generated outputs, installed outputs, CI/check evidence, and agent-local
  artifacts;
- any newly implied next artifact is named or captured as an open readiness
  blocker;
- no new recurring process artifact is introduced unless its owning AFDS profile
  and non-overlap with existing systems of record are explicit;
- `MAP.md` remains updated when this path is introduced or renamed.

## Future Change Constraints

Future changes should preserve these product constraints:

- this document owns product intent and broad requirements, not workflow
  procedure or implementation plans;
- external issue trackers own live work state;
- PRs own review and merge state;
- CI/check systems, source tests, PR notes, or issue comments own validation
  evidence unless durable requirements change;
- `.ephemeral/` artifacts own temporary agent execution detail;
- generated outputs and installed managed outputs remain non-source artifacts;
- repository documentation must not become a logbook, work journal, validation
  summary store, postmortem archive, or execution ledger for state owned
  elsewhere;
- new workflow surfaces require classification against existing DevCanon assets
  before approval;
- added guidance must reduce routing ambiguity or evidence discovery cost, not
  add process overhead for its own sake.
