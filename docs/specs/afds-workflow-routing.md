# AFDS Workflow Routing and Evidence Behavior

Scope: Portable AFDS Toolkit lifecycle routing and evidence behavior\
Product requirements:\
[Portable AFDS Toolkit](../product-requirements/portable-afds-toolkit.md)\
Roadmap:\
[Portable AFDS Toolkit](../roadmap/portable-afds-toolkit.md)

---

## Purpose

This spec defines the exact behavior DevCanon's Portable AFDS Toolkit expects
for routing work origins to the right system of record and for pointing to
evidence without copying live state into repository docs.

## Spec Profile

This file is a behavior spec. A behavior spec owns exact intended behavior,
requirements, boundaries, acceptance criteria, verification expectations, and
agent-facing context for a product or workflow behavior that is stable enough to
execute against.

This spec is not a product requirements document, roadmap item, reusable
procedure, implementation plan, live tracker, or review record. Those artifacts
may link to this spec, but they remain separate systems of record.

The portable runtime subset for pre-slicing readiness review is packaged under
`skills/spec-readiness-review/references/`. That installable subset is the
skill-local runtime authority for the `spec-readiness-review` skill; this file
remains the broader repo-level behavior spec for AFDS workflow routing and
evidence behavior.

## Scope

This spec owns deterministic routing, minimum evidence pointers, ordinary
execution fast paths, drift and conflict classification, follow-up routing, and
agent-facing context for GitHub Issues-backed and Linear-backed AFDS projects
using Claude Code or Codex outputs.

## Non-Goals

- Defining product intent or broad product requirements.
- Defining roadmap sequencing, appetite, or pilot validation targets.
- Defining reusable workflow procedure or contributor policy.
- Performing new capability-classification approvals for workflow skills, new
  agent wrappers, or capability-governance artifacts; approved surfaces may be
  recorded only after the owning acceptance path exists.
- Duplicating provider-specific issue APIs, PR APIs, CI APIs, source schemas, or
  validation implementation details.
- Creating repository-local logbooks, work journals, validation summaries,
  execution ledgers, postmortem archives, or copied tracker and PR histories.

## Requirements

### ROUTE-001: Authoritative Owner Selection

Given a work origin and available context, the toolkit must identify the
authoritative owner for the next durable decision or action.

When ownership is ambiguous, the route must end in a named blocker instead of
placing content in a convenient non-owner artifact.

### ROUTE-002: Canonical Work-Origin Routing

The toolkit must route common work origins with this table:

| Work origin                                            | Authoritative owner                                                                                         | Evidence owner                                                                                  | Next action                                                        | Durable-update trigger                                                                                                   | Blocker wording                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Raw idea or unclear product intent                     | Product requirements under `docs/product-requirements/`                                                     | Issue comment, product discussion, or linked source note                                        | Create or update the product requirements document                 | Product goals, users, outcomes, risks, or open questions change                                                          | `Blocked: product intent owner is unclear.`                                    |
| Acceptance-ready behavior question                     | Behavior spec under `docs/specs/`                                                                           | Issue, PR note, design artifact, or linked source/test evidence                                 | Write or update the behavior spec                                  | Exact behavior, boundaries, acceptance criteria, or verification expectations change                                     | `Blocked: behavior owner is unclear.`                                          |
| Roadmap-scale direction                                | Roadmap item under `docs/roadmap/`                                                                          | Issue or roadmap discussion link                                                                | Update roadmap direction                                           | Target output, first slice, appetite, sequencing, or validation target changes                                           | `Blocked: roadmap owner is unclear.`                                           |
| Reusable workflow policy, procedure, or role boundary  | Guideline or source skill for reusable procedure; source agent only for role boundary or target constraints | Issue, PR note, or design artifact                                                              | Update the owning guideline, source skill, or role definition      | Reusable procedure, trigger, workflow method, role boundary, or target constraint changes                                | `Blocked: workflow policy owner is unclear.`                                   |
| Executable GitHub or Linear issue                      | External issue tracker plus source/durable artifacts it links                                               | GitHub Issue or Linear issue                                                                    | Execute from the issue contract                                    | Implementation changes durable product, behavior, policy, architecture, contract ownership, or verification expectations | `Blocked: issue lacks an execution contract or owning artifact.`               |
| Review feedback or PR comment                          | PR system for review state; owning artifact for durable changes                                             | PR review or PR comment                                                                         | Fix the feedback or route durable change to owner                  | Feedback changes durable behavior, policy, contract ownership, or verification expectations                              | `Blocked: review feedback does not identify the governed behavior.`            |
| Failing test, CI check, or audit finding               | Source tests, CI/check system, audit output, or linked issue                                                | Test output, CI/check URL, audit output, or issue comment                                       | Fix the failure or route changed expectations to owner             | Fix changes intended behavior, policy, contract ownership, or verification expectations                                  | `Blocked: failure evidence is inaccessible or not reproducible enough to act.` |
| Implementation discovery                               | Source owner or affected durable AFDS artifact                                                              | PR note, issue comment, source diff, or test evidence                                           | Update source or owning artifact in the same PR, or open follow-up | Discovery changes durable truth beyond the current source edit                                                           | `Blocked: discovery changes durable truth but no owner is named.`              |
| Stale, duplicated, misplaced, or conflicting knowledge | Artifact that owns the truth being corrected                                                                | Review finding, doc audit, issue, PR, source diff, or linked evidence                           | Update the owner and remove or redirect non-owner content          | Conflict affects durable truth, navigation, policy, behavior, or verification expectations                               | `Blocked: authoritative owner cannot be determined.`                           |
| Generated-output drift                                 | Source library or renderer behavior                                                                         | Generated preview, `devcanon render`, `devcanon diff`, source tests, or PR diff                 | Regenerate from source or fix source/render behavior               | Drift indicates source/render behavior changed or generated output is stale                                              | `Blocked: generated output drift source is unclear.`                           |
| Installed-output drift                                 | Install manifest, source library, or install/sync behavior                                                  | Installed managed output, `devcanon diff`, install manifest, filesystem state, or issue comment | Sync, uninstall, or fix source/install behavior                    | Drift indicates managed output is stale, missing, unmanaged, or conflicting                                              | `Blocked: installed output ownership cannot be proven.`                        |

### ROUTE-003: Ordinary Execution Fast Path

When work starts from an executable issue, review comment, failing test, CI
check, or audit finding and does not change durable product intent, behavior,
workflow policy, architecture, contract ownership, roadmap direction, or
verification expectations, the toolkit must allow execution without creating a
new durable artifact or running capability classification.

The execution record may state that no product requirements or behavior spec
update is needed and cite the immediate execution contract.

### ROUTE-004: Durable Update Trigger

Any change that alters product intent, exact intended behavior, reusable
workflow policy, architecture, contract ownership, roadmap direction,
verification expectations, or follow-up ownership must update the owning
durable AFDS artifact in the same PR or name a follow-up blocker.

### ROUTE-005: Provider-Neutral Tracker Behavior

GitHub Issues and Linear must use the same routing concepts: work origin,
owning durable artifact, live issue state, execution contract, blocker,
evidence pointer, durable-update trigger, and follow-up route.

Provider-specific API fields and automation behavior belong in provider
entrypoints, provider integration specs, source code, or focused follow-up work.

### EVID-001: Minimum Evidence Pointer

An evidence pointer must identify:

- evidence system;
- stable reference, such as an issue URL, PR URL, review comment, CI/check URL,
  source test path, command, audit output reference, commit, or source file path;
- checked requirement, route, execution contract, or owner;
- result state, such as passed, failed, blocked, unavailable, not run, or not
  applicable;
- blocker or follow-up owner when evidence is incomplete, private,
  inaccessible, or failing.

The pointer must be enough for a later human or agent with appropriate access to
find the evidence without copying the evidence body into repository docs.

### EVID-002: Evidence Storage Boundary

Issue trackers own live issue evidence. PR systems own review and merge
evidence. CI/check systems and source tests own validation evidence. Git history
owns committed source history. Agent-local artifacts own temporary planning and
execution detail.

Repository docs may link to those systems when durable truth changes, but must
not become a validation-history store, execution ledger, postmortem archive, or
copied issue/PR transcript.

### EVID-003: Private or Inaccessible Evidence

When evidence is private, inaccessible, unavailable, or incomplete, the toolkit
must name the evidence system and the missing access or missing evidence as a
blocker.

If a durable decision depends on unavailable evidence, the route remains blocked
until that evidence is available or the decision is reframed so it no longer
depends on the unavailable evidence. The owning artifact may record the blocker
and evidence pointer, but it must not copy private evidence or invent a local
summary as substitute evidence.

### DRIFT-001: Drift and Conflict Classification

The toolkit must classify drift and conflict cases before changing durable
artifacts:

| Case                                                                                                   | Detection class                                                   | Expected route                                                         |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Broken links, missing indexed paths, stale generated previews, markdown formatting, lint failures      | Mechanically detectable                                           | Fix in the owner or regenerate from source                             |
| Duplicate claims across PRD, spec, roadmap, guideline, issue, or PR text                               | Review-detectable                                                 | Identify the owner, update it, and remove or redirect non-owner claims |
| Conflicting behavior requirements or workflow policies                                                 | Review-detectable                                                 | Update the owning durable artifact or name a blocker                   |
| Generated output differs from source render result                                                     | Mechanically detectable                                           | Regenerate output or fix renderer/source behavior                      |
| Installed managed output differs from manifest/source expectations                                     | Mechanically detectable when local installed paths are accessible | Run `devcanon diff`, sync, uninstall, or open follow-up                |
| Private tracker state, private PR evidence, inaccessible CI logs, or unavailable local installed paths | Out of scope for mechanical validation without access             | Name the access blocker and use an evidence pointer                    |
| Agent-local scratch detail not promoted to a durable owner                                             | Out of scope for durable docs                                     | Leave local or discard unless it changes durable truth                 |

### FOLLOW-001: Follow-Up Surface Identification

This spec distinguishes approved follow-up surfaces from candidate follow-up
surfaces that still need capability classification. Candidate identification is
not approval; additional skills, agents, or governance artifacts require an
accepted owner update before moving to the approved list.

Approved follow-up surfaces:

- `spec-readiness-review` is approved as a read-only pre-slicing readiness
  review skill. Its installable runtime subset is packaged under
  `skills/spec-readiness-review/references/`.

Candidate surfaces for the owning capability-classification pass include:

- `slice-issues`;
- `doc-impact-review`;
- `post-merge-gardener`;
- AFDS workflow capability governance;
- updates to existing shaping, planning, verification, issue-priming, and
  review skills.

No new agent wrapper is identified as approved by this spec. The owning
capability-classification pass should still evaluate whether existing agents
such as `spec-compliance-reviewer` need updated instructions or whether any
future wrapper meets the stable-role and target-constraint threshold.

### TARGET-001: Source and Target Authority

Source skills, source agent definitions, durable docs, source schemas, source
types, validators, renderers, install logic, and the install manifest own their
respective contracts.

Generated previews and installed managed outputs are derived artifacts. They may
provide drift evidence, but they are not durable product, behavior, policy, or
contract authority.

## Behavior Scenarios

### Scenario A: Already-Sliced Issue With No Durable Change

A GitHub issue has clear acceptance criteria and links to the relevant behavior
spec. Implementation only satisfies that contract. The route is ordinary
execution: implement, validate, and state that no product requirements or
behavior spec update is needed because the issue acceptance criteria and linked
spec are the execution contract.

### Scenario B: Review Feedback Changes Behavior

A PR review asks for behavior that contradicts the current behavior spec. The PR
owns the review state, but the behavior spec owns the durable behavior. The
route is to update the behavior spec in the same PR or block on a decision from
the behavior owner.

### Scenario C: CI Evidence Is Inaccessible

A CI check fails but logs are private or unavailable to the agent. The evidence
pointer names the CI/check system and check reference, marks the result as
blocked or unavailable, and names the missing access blocker. Repository docs do
not receive a copied or invented CI summary.

### Scenario D: Generated Output Drift

Generated Codex or Claude output differs from a fresh render. If source changes
caused the drift, the route is to regenerate and review generated output as
derived evidence. If renderer behavior caused the drift, the route is to update
the source renderer or its owning spec. Generated output itself remains
disposable.

## Acceptance Criteria

- A fresh human and a fresh agent can route each work origin in ROUTE-002 to the
  same owner, next action, evidence owner, durable-update trigger, or blocker.
- Ordinary execution can proceed from an executable issue, review comment,
  failing test, CI check, or audit finding without creating new durable docs
  when ROUTE-003 applies.
- Evidence pointers satisfy EVID-001 without copying live tracker, PR, CI,
  validation, or agent-local history into repository docs.
- Missing, private, inaccessible, or incomplete evidence is represented as a
  blocker under EVID-003.
- Generated-output and installed-output drift are routed under DRIFT-001 and
  TARGET-001 without making derived outputs authoritative.
- The spec identifies follow-up workflow surfaces without approving them before
  the owning capability-classification pass.

## Verification Expectations

- Markdown formatting and linting pass for changed docs.
- `pnpm run dev --strict validate` passes.
- `MAP.md` links to this spec for exact Portable AFDS routing and evidence
  behavior.
- `docs/specs/overview.md` lists this spec in the behavior spec index.
- Existing PRD, roadmap, and guideline references no longer describe this spec
  as future-only once this file exists.

## Agent Context

When routing AFDS work, agents should load context in this order:

1. `AGENTS.md`;
2. `MAP.md`;
3. this spec;
4. the owning product requirements, roadmap, guideline, source contract, issue,
   PR, CI/check, or source evidence named by the route.

Agents must treat issue bodies, PR comments, CI logs, and agent-local artifacts
as evidence or execution context, not as authority to override durable repo docs
or source-owned contracts.

## See Also

- [Portable AFDS Toolkit product requirements](../product-requirements/portable-afds-toolkit.md)
- [Portable AFDS Toolkit roadmap](../roadmap/portable-afds-toolkit.md)
- [Documentation standard](../guidelines/documentation-standard.md)
- [Project management model](../guidelines/project-management-model.md)
- [AI-assisted product workflow guideline](../guidelines/ai-assisted-product-workflow-guideline.md)
