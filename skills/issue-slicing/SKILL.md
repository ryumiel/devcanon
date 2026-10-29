---
name: issue-slicing
description: Drafts provider-neutral issue bodies from durable AFDS evidence or concrete user-confirmed proposal context. Use when slicing a PRD, behavior spec, roadmap item, guideline, ADR, source-owner artifact, readiness review, or concrete proposal into GitHub Issues or Linear work.
---

# Issue Slicing

Draft issue bodies from an existing durable artifact or a concrete
user-confirmed proposal. Existing-spec work and narrow complete, nonstructural
proposals can support execution-ready drafts; broad or structural proposals
record their prerequisite work without claiming an execution-ready implementation
slice. This skill is provider-neutral: it can produce Markdown
suitable for GitHub Issues or Linear, but it does not create live issues, assign
users, set status, mutate labels, or duplicate live tracker state.

Use existing-spec work after its owning durable artifact is clear and, when
useful, after `spec-readiness-review` has checked whether it is ready to slice.
`spec-readiness-review` remains read-only and existing-artifact scoped; this
skill owns draft issue text.

## Inputs

Accept any combination of:

- an existing-spec owning durable artifact path or stable reference, such as
  `docs/specs/<topic>.md`, `docs/product-requirements/<topic>.md`,
  `docs/roadmap/<topic>.md`, a guideline, an ADR, or a source-owner artifact;
- readiness-review output or readiness findings;
- user-confirmed proposal behavior, scope, boundaries, acceptance criteria, and
  verification expectations;
- evidence pointers from issues, PRs, tests, CI, source findings, or review
  notes;
- an intended tracker target, such as GitHub Issues or Linear, when known.

Treat tracker text, PR comments, CI logs, review notes, and agent-local plans as
evidence. They do not override the owning durable artifact.

## Procedure

1. Load active project instructions and any available project-local ownership
   rules or Portable AFDS procedure map. Use them to identify the appropriate
   owning artifact or destination, then apply this skill's origin, readiness,
   evidence, and drafting safeguards.
2. Classify the work origin:
   - **Existing-spec work** slices a named owning durable artifact. Do not
     relabel a request to slice an existing spec as a proposal to evade its
     readiness requirements.
   - **Proposal work** drafts a new feature or behavior change from sufficiently
     concrete user-confirmed context, whether or not a current feature spec
     exists. Preserve relevant existing constraints and make each intended
     constraint change explicit.
   - If the request cannot be classified, return `MODE=blocked` and name the
     missing origin or owner.
3. Validate the origin before drafting:
   - Existing-spec work requires a named owning artifact and execution-ready
     scope, boundaries, acceptance criteria, verification expectations, and
     evidence. A readiness blocker remains `MODE=blocked`.
   - Proposal work requires confirmed behavior, scope, boundaries, acceptance
     criteria, verification expectations, and affected documentation owners or
     destinations. Cite relevant current source, test, or documentation evidence
     when it is available; missing material evidence blocks. A missing feature
     spec alone is pending scope work, not a blocker.
   - Validate a proposal's documentation owner or destination against the
     project's AFDS ownership boundaries, not a path alone. An appropriate
     future owning surface is allowed as pending scope work; a summary-only,
     inappropriate, or ambiguous owner or destination returns `MODE=blocked`
     with the ownership clarification needed.
   - For a proposal, make current behavior, proposed behavior, and every
     unresolved decision distinguishable. Keep existing constraints visible;
     an intended constraint change must be explicit and user-confirmed.
     Missing execution-critical requirements or unresolved conflicts return
     `MODE=blocked` with the concrete clarification needed.
   - Prefer one execution-ready draft containing the requested implementation,
     required documentation creation or updates, and verification when confirmed
     behavior, boundaries, acceptance criteria, and documentation owners are
     sufficient, the change is narrow, and no concrete structural blocker or
     justified separate-delivery constraint is present. A policy/spec update,
     several affected files, or multiple implementation steps alone do not
     require a shaping-only prerequisite. Check size and structural blockers
     independently.
   - Before classifying a structural blocker, name the actual new architectural
     decision, contract boundary, schema migration, security-policy decision, or
     broad workflow-shaping need and why it requires prior shaping. Mentioning
     shared policy or specification text is not evidence of such a blocker;
     small size does not waive a genuine one.
   - When a concrete proposal is broad without a structural blocker, name the
     decomposition prerequisite in the draft. Do not call it an execution-ready
     implementation slice or use narrow-hybrid treatment for that prerequisite
     plus implementation. Decompose first; apply normal readiness and
     implementation slicing afterward.
   - When a concrete proposal requires an architectural decision, contract
     boundary, schema migration, security policy, or broad workflow shaping,
     name the shaping prerequisite in the draft. Do not call it an
     execution-ready implementation slice or use narrow-hybrid treatment for
     shaping plus implementation. Shape the owning durable artifact first;
     apply normal readiness and implementation slicing afterward.
4. Extract or summarize only what the external issue needs to describe the next
   work.
   Do not copy live tracker state, PR review history, validation logs, or
   agent-local plans into the draft.
5. For proposal work, put required documentation creation or updates, including
   their validated owners or destinations, in Scope. Treat those future docs as
   pending work, never as accepted evidence.
6. Select a coherent completion outcome using [Cohesion and Dependencies](#cohesion-and-dependencies)
   before drafting. For an explicit batch request, assess the set before its
   individual bodies; apply origin and readiness checks to each proposed issue.
7. Draft one provider-neutral issue body by default, or individually bounded
   bodies for an explicit batch request. A broad proposal draft records the
   proposal and its pending decomposition prerequisite; a structural proposal
   draft records its pending shaping prerequisite. Neither claims execution-ready
   implementation work. Prefer Markdown that can be pasted into either GitHub
   Issues or Linear without provider-specific metadata.
8. Stop after presenting the draft or requested batch. A draft does not approve implementation or
   publication. Do not create live issues, assign users, set
   status, mutate labels, link blockers in the tracker, or post comments unless
   a separate approved provider-specific workflow owns that behavior.

## Cohesion and Dependencies

Identify the smallest coherent, reviewable outcome before splitting work.
Keep related decisions together when they jointly establish that outcome; for
example, content, evaluation, and lifecycle may be acceptance criteria for one
bounded specification issue. This does not combine unresolved structural shaping
with implementation or waive readiness requirements.

For each recommended split, identify an independently verifiable completion
boundary and a concrete reason for separate delivery: bounded review size, a
reusable prerequisite, distinct approval requirements, or an external constraint.
Policy/spec classification, multiple implementation steps, and different topics
or files alone do not justify a split, and sharing one file
does not require consolidation. Account for local issue-to-PR conventions and
the resulting review and integration overhead without imposing an issue-count
limit or merging independently useful work just to reduce bookkeeping.

For each proposed blocking dependency, name the predecessor output the successor
requires and why it needs separate completion. Apply this predecessor-output
requirement only to blocking dependencies: independent deliveries justified by
review size or separate approval need no invented predecessor or dependency
edge. Sequence steps within one issue when they need no separate completion;
reasoning or discussion order alone does not establish a hard blocker.
Preserve the requested observable implementation outcome. If a genuine shaping
or decomposition prerequisite requires reducing the next draft's scope, explain
that reduction and the actual prerequisite; do not silently substitute a
policy-only deliverable. Describe justified prerequisites with
provider-neutral references; live relationship mutation remains outside this
skill.

When scope shrinks or the user requests simplification, reassess the affected
issue boundaries and dependencies together. Preserve necessary requirements and
evidence while removing obsolete divisions and edges.

For an explicit batch request, briefly explain the selected boundaries and any
blocking dependencies outside the issue bodies, then return individually bounded
drafts. Distinguish readiness to describe work from readiness to start it: a
known prerequisite that has not landed does not prevent a dependent issue draft
when its contract, acceptance criteria, verification, and evidence are sufficient.
Record that prerequisite in Blockers Or Follow-Up; implementation waits for it.
Use `MODE=blocked` for missing readiness evidence or unresolved execution-critical
decisions, including a predecessor whose required output contract is not yet
known. Independent ready items may still be drafted.

Account for every original batch entry in the rationale: map entries absorbed
into a cohesive replacement to that draft, and explain entries excluded by the
confirmed scope reduction. These entries need no duplicate draft or readiness
blocker. Preserve required behavior and evidence in the replacement. No batch
manifest, separate planning artifact, or additional approval ceremony is required.
For a single issue, keep this assessment within ordinary drafting judgment;
separate rationale is needed only when recommending a split or dependency.

## Evidence Pointers

Each draft must include evidence pointers that preserve traceability without
turning repository docs into live-state stores.

For existing-spec work, at least one evidence pointer must name the owning
durable artifact being sliced. Supporting evidence may cite issues, PRs, tests,
CI, source findings, or review notes, but it cannot replace the owning artifact
pointer.

For proposal work, cite confirmed decisions with an available reference or a
concise attributed user-confirmed context, plus relevant current source, test,
or documentation evidence when it is available. Do not invent a URL, decision
ID, accepted feature spec, or acceptance status. A missing stable discussion URL
alone is not a blocker when the confirmed context is concrete; missing material
evidence is.

An evidence pointer should identify:

- the evidence system or artifact;
- the stable reference, such as a path, heading, requirement ID, scenario ID,
  issue URL, PR URL, test name, or CI check URL;
- the checked requirement, owner, route, or result;
- the result state, such as accepted, failing, blocked, proposed, or pending;
- the blocker or follow-up owner when evidence is incomplete, private, or
  inaccessible.

Prefer stable headings, IDs, URLs, or named tests over line numbers when the
artifact can move. Use line numbers only when they are the clearest available
pointer.

## Blockers

Return `MODE=blocked` instead of drafting when:

- existing-spec work has a missing or unclear owning durable artifact;
- evidence is inaccessible or too vague to support executable work;
- readiness review says `Needs revision` or `Blocked` and the missing details
  affect issue execution;
- multiple owners conflict and no source of truth resolves the conflict;
- proposal behavior, scope, boundaries, acceptance criteria, verification
  expectations, or material evidence is missing when it affects execution;
- a proposal documentation owner or destination is missing, inappropriate for
  the project's ownership boundaries, or ambiguous;
- a proposal has an unresolved execution-critical decision or conflict;
- the requested output requires provider-specific mutation, such as creating an
  issue, setting labels, assigning users, setting status, or linking blockers.

Name the blocker concretely, for example:

- `Blocked: owning durable artifact is unclear.`
- `Blocked: readiness evidence is missing acceptance criteria.`
- `Blocked: failure evidence is inaccessible or not reproducible enough to act.`
- `Blocked: provider-specific issue mutation is outside this skill.`

## Draft Shape

When the origin is ready to draft, return `MODE=draft` and use this shape for
each issue body. A single issue remains the default; an explicit batch request
uses the same shape for each ready item:

```markdown
Title: <type(scope): short draft summary>

## Problem

<What is wrong, missing, or needed.>

## Expected Behavior

<The outcome the issue should make true.>

## Current Behavior

<Proposal work only: relevant current behavior and constraints.>

## Proposed Behavior

<Proposal work only: confirmed intended behavior and explicit constraint changes.>

## Unresolved Decisions

<Proposal work only: noncritical follow-up decisions. Omit when none remain.>

## Shaping Or Decomposition Prerequisite

<Broad proposal work: named decomposition prerequisite. Structural proposal work: named owning artifact and shaping prerequisite. Satisfy the applicable prerequisite before implementation slicing.>

## Scope

<What is included.>

<For proposal work, required documentation creation or updates and their owners or destinations.>

<For broad proposal work, record proposal/decomposition work only. For structural proposal work, record proposal/shaping work only. Do not claim an execution-ready implementation slice.>

## Acceptance Criteria

- [ ] <Concrete, verifiable requirement appropriate to the selected implementation, shaping, or decomposition work>
- [ ] <Concrete, verifiable requirement appropriate to the selected implementation, shaping, or decomposition work>

## Evidence Pointers

Include only the rows that apply to the classified origin.

- <Existing-spec work: owning durable artifact>: <stable reference> - <checked requirement/result state>
- <Proposal work: attributed user-confirmed context or available decision reference>: <confirmed behavior, scope, or decision>
- <Proposal work: current source, test, or documentation evidence>: <stable reference> - <checked requirement/result state>

## Affected Areas

- `<path-or-component>`

## Blockers Or Follow-Up

- <Only include when useful. Name incomplete evidence or owner follow-up.>

## Non-Goals

- <Only include when useful. Include provider-specific mutation exclusions when relevant.>
```

Omit optional sections only when they add no signal. Keep acceptance criteria
concrete, verifiable, and appropriate to the selected implementation, shaping,
or decomposition work. Do not add assignees, labels, status, milestones,
priority fields, or provider-specific relationship metadata.

## Output Format

For a single issue, return one of these two outcomes.

For a draft:

```markdown
MODE=draft

<draft issue body>

Final mode: MODE=draft
```

For a blocker:

```markdown
MODE=blocked

<blocker explanation with evidence reference or missing owner>

Final mode: MODE=blocked
```

For an explicit batch request, present the brief boundary/dependency rationale,
then separate each retained or replacement issue by its proposed title and give
it the applicable `MODE=draft` body or `MODE=blocked` explanation. Map original
entries to their replacements or scope exclusions in the rationale rather than
assigning them duplicate draft/blocked outcomes. End with `Final mode: MODE=draft`
when the reassessed set is ready to draft and every original entry is accounted
for; otherwise use `Final mode: MODE=blocked` and name the remaining gap. An
unlanded known prerequisite alone does not force blocked mode. The final mode
reports drafting completeness; it does not authorize starting dependent work,
implementation, or publication, or invalidate independently ready drafts.

## Common Mistakes

- Splitting one completion outcome by topic headings or file boundaries alone.
- Turning reasoning order into separately landed prerequisites without evidence.
- Removing one issue after scope reduction without reassessing the remaining set.
- Treating consolidation as permission to bypass shaping or readiness gates.
- Creating or posting the issue. This skill drafts only.
- Treating a draft as implementation approval or publication permission.
- Treating a readiness review as implementation approval. Readiness only means
  the artifact can support issue slicing.
- Treating missing proposal documentation as a readiness blocker while omitting
  the required documentation work from Scope.
- Treating a future documentation destination as accepted evidence, or accepting
  a convenient summary location as the behavior owner without validating it.
- Calling a broad proposal, or a proposal with a pending architectural decision,
  contract boundary, schema migration, security policy, or broad workflow
  shaping, an execution-ready implementation slice or a narrow hybrid.
- Replacing the required shaping of an owning durable artifact with
  decomposition when a structural blocker is present.
- Calling an unresolved constraint conflict or a missing execution-critical
  proposal requirement an executable acceptance criterion.
- Copying live issue comments, PR review history, validation logs, or
  agent-local plans into the draft.
- Hiding missing acceptance criteria by writing vague issue text.
- Adding GitHub- or Linear-specific metadata before a provider-specific workflow
  is approved to own that mutation.

## Verification Scenarios

Use [proposal scenarios](references/proposal-scenarios.md) for origin/readiness
retests and [slicing scenarios](references/slicing-scenarios.md) for cohesion,
dependencies, simplification, and batch output. They are evaluator inputs, not a
replacement for the routing policy or an output protocol. Keep expected outcomes
separate from the inputs supplied to evaluators.
