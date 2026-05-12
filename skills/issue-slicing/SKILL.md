---
name: issue-slicing
description: Drafts provider-neutral executable issue bodies from durable AFDS evidence. Use when slicing a PRD, behavior spec, roadmap item, guideline, ADR, source-owner artifact, or readiness review into GitHub Issues or Linear work.
---

# Issue Slicing

Draft executable issue bodies from owning durable AFDS artifacts. This skill is
provider-neutral: it can produce Markdown suitable for GitHub Issues or Linear,
but it does not create live issues, assign users, set status, mutate labels, or
duplicate live tracker state.

Use this after the owning durable artifact is clear and, when useful, after
`spec-readiness-review` has checked whether the artifact is ready to slice.
`spec-readiness-review` remains read-only; this skill owns draft issue text.

## Inputs

Accept any combination of:

- an owning durable artifact path or stable reference, such as
  `docs/specs/<topic>.md`, `docs/product-requirements/<topic>.md`,
  `docs/roadmap/<topic>.md`, a guideline, an ADR, or a source-owner artifact;
- readiness-review output or readiness findings;
- evidence pointers from issues, PRs, tests, CI, source findings, or review
  notes;
- an intended tracker target, such as GitHub Issues or Linear, when known.

Treat tracker text, PR comments, CI logs, review notes, and agent-local plans as
evidence. They do not override the owning durable artifact.

## Procedure

1. Load project instructions and, when present, the Portable AFDS procedure map
   at `docs/guidelines/portable-afds-user-procedure-map.md`.
2. Identify the work origin and owning durable artifact. If ownership is
   unclear, return `MODE=blocked`.
3. Check whether the artifact or readiness findings provide enough scope,
   boundaries, acceptance criteria, verification expectations, and evidence to
   draft executable work. If the artifact is not ready, return `MODE=blocked`.
4. Extract or summarize only what the external issue needs to execute the work.
   Do not copy live tracker state, PR review history, validation logs, or
   agent-local plans into the draft.
5. Draft one provider-neutral issue body. Prefer Markdown that can be pasted
   into either GitHub Issues or Linear without provider-specific metadata.
6. Stop after presenting the draft. Do not create live issues, assign users, set
   status, mutate labels, link blockers in the tracker, or post comments unless
   a separate approved provider-specific workflow owns that behavior.

## Evidence Pointers

Each draft must include evidence pointers that preserve traceability without
turning repository docs into live-state stores.

At least one evidence pointer must name the owning durable artifact being
sliced. Supporting evidence may cite issues, PRs, tests, CI, source findings, or
review notes, but it cannot replace the owning artifact pointer.

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

- the owning durable artifact is missing or unclear;
- evidence is inaccessible or too vague to support executable work;
- readiness review says `Needs revision` or `Blocked` and the missing details
  affect issue execution;
- multiple owners conflict and no source of truth resolves the conflict;
- the requested output requires provider-specific mutation, such as creating an
  issue, setting labels, assigning users, setting status, or linking blockers.

Name the blocker concretely, for example:

- `Blocked: owning durable artifact is unclear.`
- `Blocked: readiness evidence is missing acceptance criteria.`
- `Blocked: failure evidence is inaccessible or not reproducible enough to act.`
- `Blocked: provider-specific issue mutation is outside this skill.`

## Draft Shape

When the artifact is slice-ready, return `MODE=draft` and include exactly one
draft issue body in this shape:

```markdown
Title: <type(scope): short executable summary>

## Problem

<What is wrong, missing, or needed.>

## Expected Behavior

<The outcome the issue should make true.>

## Scope

<What is included.>

## Acceptance Criteria

- [ ] <Concrete executable requirement>
- [ ] <Concrete executable requirement>

## Evidence Pointers

- <owning durable artifact>: <stable reference> - <checked requirement/result state>
- <supporting evidence system>: <stable reference> - <checked requirement/result state>

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
- Treating a readiness review as implementation approval. Readiness only means
  the artifact can support issue slicing.
- Copying live issue comments, PR review history, validation logs, or
  agent-local plans into the draft.
- Hiding missing acceptance criteria by writing vague issue text.
- Adding GitHub- or Linear-specific metadata before a provider-specific workflow
  is approved to own that mutation.
