---
name: issue-slicing
description: Drafts provider-neutral executable issue bodies from durable AFDS evidence or concrete user-confirmed proposal context. Use when slicing a PRD, behavior spec, roadmap item, guideline, ADR, source-owner artifact, readiness review, or concrete proposal into GitHub Issues or Linear work.
---

# Issue Slicing

Draft executable issue bodies from an existing durable artifact or a concrete
user-confirmed proposal. This skill is provider-neutral: it can produce Markdown
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

1. Load project instructions and, when present, the Portable AFDS procedure map
   at `docs/guidelines/portable-afds-user-procedure-map.md`.
2. Classify the work origin:
   - **Existing-spec work** slices a named owning durable artifact. Do not
     relabel a request to slice an existing spec as a proposal to evade its
     readiness requirements.
   - **Proposal work** drafts a new feature or behavior change from sufficiently
     concrete user-confirmed context, including when no feature spec exists.
   - If the request cannot be classified, return `MODE=blocked` and name the
     missing origin or owner.
3. Validate the origin before drafting:
   - Existing-spec work requires a named owning artifact and execution-ready
     scope, boundaries, acceptance criteria, verification expectations, and
     evidence. A readiness blocker remains `MODE=blocked`.
   - Proposal work requires confirmed behavior, scope, boundaries, acceptance
     criteria, verification expectations, relevant available current-behavior
     evidence, and affected documentation owners or destinations. A missing
     feature spec alone is pending scope work, not a blocker.
   - For a proposal, make current behavior, proposed behavior, and every
     unresolved decision distinguishable. Keep existing constraints visible;
     an intended constraint change must be explicit and user-confirmed.
     Missing execution-critical requirements or unresolved conflicts return
     `MODE=blocked` with the concrete clarification needed.
4. Extract or summarize only what the external issue needs to execute the work.
   Do not copy live tracker state, PR review history, validation logs, or
   agent-local plans into the draft.
5. For proposal work, put required documentation creation or updates, including
   their owners or destinations, in Scope. Treat those future docs as pending
   work, never as accepted evidence.
6. Draft one provider-neutral issue body. Prefer Markdown that can be pasted
   into either GitHub Issues or Linear without provider-specific metadata.
7. Stop after presenting the draft. A draft does not approve implementation or
   publication. Do not create live issues, assign users, set
   status, mutate labels, link blockers in the tracker, or post comments unless
   a separate approved provider-specific workflow owns that behavior.

## Evidence Pointers

Each draft must include evidence pointers that preserve traceability without
turning repository docs into live-state stores.

For existing-spec work, at least one evidence pointer must name the owning
durable artifact being sliced. Supporting evidence may cite issues, PRs, tests,
CI, source findings, or review notes, but it cannot replace the owning artifact
pointer.

For proposal work, cite confirmed decisions with an available reference or a
concise attributed user-confirmed context, plus relevant current source, test,
or documentation evidence. Do not invent a URL, decision ID, accepted feature
spec, or acceptance status. A missing stable discussion URL alone is not a
blocker when the confirmed context is concrete; missing material evidence is.

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
  expectations, relevant current evidence, or documentation owner/destination
  is missing when it affects execution;
- a proposal has an unresolved execution-critical decision or conflict;
- the requested output requires provider-specific mutation, such as creating an
  issue, setting labels, assigning users, setting status, or linking blockers.

Name the blocker concretely, for example:

- `Blocked: owning durable artifact is unclear.`
- `Blocked: readiness evidence is missing acceptance criteria.`
- `Blocked: failure evidence is inaccessible or not reproducible enough to act.`
- `Blocked: provider-specific issue mutation is outside this skill.`

## Draft Shape

When the origin is ready to draft, return `MODE=draft` and include exactly one
draft issue body in this shape:

```markdown
Title: <type(scope): short executable summary>

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

## Scope

<What is included.>

<For proposal work, required documentation creation or updates and their owners or destinations.>

## Acceptance Criteria

- [ ] <Concrete executable requirement>
- [ ] <Concrete executable requirement>

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
implementation-facing and verifiable. Do not add assignees, labels, status,
milestones, priority fields, or provider-specific relationship metadata.

## Output Format

Return one of these two outcomes.

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

## Common Mistakes

- Creating or posting the issue. This skill drafts only.
- Treating a draft as implementation approval or publication permission.
- Treating a readiness review as implementation approval. Readiness only means
  the artifact can support issue slicing.
- Treating missing proposal documentation as a readiness blocker while omitting
  the required documentation work from Scope.
- Calling an unresolved constraint conflict or a missing execution-critical
  proposal requirement an executable acceptance criterion.
- Copying live issue comments, PR review history, validation logs, or
  agent-local plans into the draft.
- Hiding missing acceptance criteria by writing vague issue text.
- Adding GitHub- or Linear-specific metadata before a provider-specific workflow
  is approved to own that mutation.

## Verification Scenarios

Use [proposal scenarios](references/proposal-scenarios.md) for focused
proposal-origin retests. They are evaluator inputs, not a replacement for the
routing policy or an output protocol.
