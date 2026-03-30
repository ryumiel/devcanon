# Phase Template

Use this template to prepare a phase before execution.

Fill each field with enough detail that another engineer or agent could execute the phase without guessing.

## Summary

- Goal: [What problem this phase solves in 1-2 sentences]
- Scope: [What is included in this phase]
- Non-goals: [What looks adjacent but is explicitly out of scope]
- Acceptance criteria: [How success will be verified; prefer observable outcomes]
- Compatibility requirements: [Existing behavior, platforms, or contracts that must not regress]

## Change Surface

- Files or modules to create: [List planned new files or modules]
- Files or modules to modify: [List planned touched areas]
- Dependencies to add or avoid: [Include justification for each decision]

## Validation

- Tests to add or update: [What coverage proves the change]
- Manual checks: [Only the checks that cannot be automated]
- Verification commands: [Exact commands to run]
- Gates that may be unavailable: [Name each gate, why it may be unavailable, and the fallback]

## Documentation

- Docs to update: [User-facing, developer-facing, or contract docs]
- Proposal or design sections to cross-reference: [Exact sections or docs that constrain the phase]

## Risks

- Blocking risks: [What could stop the phase entirely]
- Open assumptions: [What is believed true but still needs confirmation]
- Execution path: [Specialized agent, general coding agent, or direct implementation if allowed]
- Rollback or fallback plan: [How to recover if execution or verification fails]

## Approval

- Reviewers to involve: [Apply the review matrix explicitly]
- Approval required before execution: [Who approves and what they are approving]
- Execution output: [What delivered state, artifacts, or report the phase must return]
