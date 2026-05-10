# Portable AFDS Toolkit

**Status:** Direction set\
**Owning product requirements:** [Portable AFDS Toolkit product requirements](../product-requirements/portable-afds-toolkit.md)\
**Live planning:** [GitHub issue #217](https://github.com/ryumiel/devcanon/issues/217)

Live planning links are pointers to execution tracking only. This roadmap item
and its linked product requirements own the durable direction.

## Summary

DevCanon's durable product direction is to provide portable skills, thin agent
roles, and supporting guidance for development projects that follow AFDS.

It helps teams run an AFDS-based product workflow across Claude Code and Codex,
and provides migration/setup guidance for existing or new projects adopting
that methodology.

DevCanon remains a user-wide CLI and source library. Consumer-project adoption
is guided by reusable skills, generated target-native agent files, and
documentation patterns; it is not automatic repository rewriting or
repository-level document management.

## Target Output

The Portable AFDS Toolkit should make it practical to adopt a consistent
AI-assisted development workflow across projects that use either GitHub Issues
or Linear.

The target output includes:

- portable AFDS skills for shaping, issue-priming entrypoints, shared issue
  workflow, planning, review, and documentation impact workflows
- thin agent roles that provide stable delegate identities and target-supported
  controls
- guidance for specs, roadmaps, workflows, issue slicing, PRs, review, and
  documentation impact
- migration/setup guidance for projects adopting AFDS from an existing state
- Claude Code and Codex outputs generated from the same source library

## Starting Assumptions for First Slice

The first slice starts from existing DevCanon product and workflow constraints
rather than from a new tool surface:

- reusable workflow guidance and thin role definitions already have source
  owners under the source library; `MAP.md` owns current source navigation;
- GitHub Issues and Linear issue entrypoints isolate provider-specific issue
  access, worktree setup, and issue-body persistence before handing off to a
  shared issue workflow;
- GitHub-backed use depends on authenticated `gh` access, and Linear-backed use
  depends on the configured Linear issue-reading skills or connector surface;
- AFDS documentation separates product requirements, behavior specs, roadmap
  direction, guidelines, architecture, ADRs, issue tracking, PR review state,
  generated outputs, installed managed outputs, and agent-local artifacts;
- CLI validation and listing apply to source definitions, while rendering,
  syncing, diffing, and uninstalling operate on generated or installed managed
  outputs derived from those sources.

Generated previews under `generated/` are disposable render outputs. They are
useful as evidence that the source library renders consistently, but the source
library remains authoritative.

## Scope

- Preserve the user-wide DevCanon CLI and source-library model.
- Support both GitHub Issues-backed and Linear-backed AFDS projects.
- Keep skills as the primary reusable workflow unit.
- Keep agent roles as thin role wrappers for stable roles and target-specific
  controls.
- Provide durable guidance that helps consumer projects adopt AFDS deliberately.

## Non-Goals

- DevCanon does not become a repository-level document manager.
- DevCanon does not automatically rewrite or manage consumer repositories.
- DevCanon does not force every old document into one mandatory template.
- DevCanon does not duplicate live issue or PR tracking in repository docs.
- DevCanon does not make generated outputs authoritative source files.
- DevCanon does not create repository-local logbooks, work journals, execution
  ledgers, postmortem archives, or validation summary stores for state already
  owned by issue trackers, PRs, CI/check systems, Git history, source tests, or
  linked evidence.

## Related Docs

- [Portable AFDS Toolkit product requirements](../product-requirements/portable-afds-toolkit.md)
- [Behavior specs overview](../specs/overview.md)
- [Core concepts and design principles](../specs/core-concepts.md)
- [Documentation standard](../guidelines/documentation-standard.md)
- [Project management model](../guidelines/project-management-model.md)
- [Agent authoring guide](../guidelines/agent-authoring-guide.md)
- [Writing skills in this repo](../guidelines/writing-skills.md)

## Outcome-Level Sequencing

### First Usable Slice

The first usable slice is a provider-neutral guided adoption path for Product
Leaders and Human Developers with Agent.

The slice should let a project:

1. find the Portable AFDS purpose, target users, systems-of-record model, and
   roadmap direction from the repository entry points;
2. identify whether current work belongs in product requirements, a behavior
   spec, a roadmap item, a guideline, source-owned implementation, an external
   issue, a PR, CI/check evidence, or an agent-local artifact;
3. start from either a GitHub Issues-backed or Linear-backed issue and enter
   the same shared issue-priming workflow after provider-specific issue access,
   worktree setup, issue-body persistence, and handoff;
4. move through shaping, execution, review, validation, and completion without
   creating a new durable artifact unless the documented ownership trigger
   fires;
5. prove Claude Code and Codex parity by rendering both targets from the same
   source skills and agent role definitions, then running source validation and
   render checks.

This slice is intentionally smaller than the full toolkit. Its appetite is to
make one end-to-end AFDS adoption path usable, traceable, and low-overhead
across both first-supported issue trackers and both first-supported agent
targets. Exact routing tables, evidence-pointer fields, acceptance-ready
workflow behavior, and new workflow asset approvals belong in their owning
specs, guidelines, source files, or follow-up issues.

For first-slice derivation, deterministic routing and evidence behavior are
owned by
[`docs/specs/afds-workflow-routing.md`](../specs/afds-workflow-routing.md).
Reusable capability classification should be owned by the planned
`docs/guidelines/afds-workflow-capability-governance.md` guideline. This
roadmap only depends on those owners being available enough to pilot the slice;
it does not define their exact behavior.

### Sequencing

1. Preserve the product direction and roadmap ownership model.
2. Reconcile AFDS taxonomy and workflow guidance into durable docs that a fresh
   Product Leader or Human Developer with Agent can navigate.
3. Define the provider-neutral first usable slice from the starting assumptions.
4. Establish enough routing/evidence behavior and capability-governance
   procedure to pilot the slice without putting those contracts in the roadmap.
5. Exercise the same first-slice adoption path in one GitHub Issues-backed
   project and one Linear-backed project.
6. Validate Claude Code and Codex parity by rendering both targets from the same
   source library and running source validation and render checks.
7. Route pilot findings to their owning systems: durable docs for changed
   product, behavior, policy, or roadmap direction; source files for source-
   owned behavior; external trackers for live work; PRs for review state; and
   CI/checks, source tests, PR notes, issue comments, or linked evidence for
   validation evidence.

## Validation Targets

- A new project can understand DevCanon's AFDS direction from `README.md`,
  `AGENTS.md`, `MAP.md`, and this roadmap item.
- A contributor can tell where durable roadmap direction belongs and where live
  issue tracking belongs.
- A GitHub Issues-backed AFDS project can adopt the guidance without
  repository-specific hard-coding.
- A Linear-backed AFDS project can adopt the guidance without repository-
  specific hard-coding.
- A Product Leader can identify the first durable artifact to update when
  product intent, roadmap direction, behavior, policy, or follow-up ownership
  changes.
- A Human Developer with Agent can start from a work origin and reach the same
  owning artifact, route, evidence location, or named blocker as another fresh
  human or agent.
- The GitHub Issues-backed and Linear-backed pilots use the same AFDS workflow
  concepts while keeping provider-specific behavior isolated to provider
  entrypoints and tracker integration points.
- Pilot evidence shows reduced routing ambiguity and process overhead without
  copying live tracker state, PR review state, validation history, postmortem
  narratives, or agent-local execution detail into repository roadmap docs.
- Generated Claude Code and Codex outputs continue to come from the same source
  skills and agent role definitions.
- Proposed workflow additions discovered during pilots are routed through the
  owning capability-governance path before becoming new skills, agents, docs,
  or source behavior.
