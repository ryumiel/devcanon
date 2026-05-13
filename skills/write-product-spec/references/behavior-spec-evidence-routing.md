# Behavior Spec Evidence Routing

This packaged runtime reference defines how `write-product-spec` records
evidence pointers, prepares readiness-review handoff, and keeps issue-slicing
boundaries clear when installed outside this repository.

## Behavior Spec Ownership

A behavior spec owns exact intended behavior that is stable enough to execute
against:

- requirements;
- boundaries and non-goals;
- acceptance criteria;
- verification expectations;
- agent-facing context.

Behavior specs do not own broad product intent, roadmap sequencing,
implementation architecture, live issue state, PR review state, validation
history, assignees, schedules, branch names, or single-PR execution plans.

When product intent is not stable enough for acceptance-ready behavior, route to
product requirements first. When architecture, roadmap direction, reusable
workflow policy, or contract authority owns the needed truth, route to that
owner instead of forcing it into a behavior spec.

## Evidence Pointers

Use evidence pointers to support behavior requirements without copying live
state into the spec. A minimum evidence pointer must identify:

- evidence system;
- stable reference, such as an issue URL, PR URL, review comment, CI/check URL,
  source test path, command, audit output reference, commit, or source file path;
- checked requirement, route, execution contract, or owner;
- result state, such as passed, failed, blocked, unavailable, not run, or not
  applicable;
- blocker or follow-up owner when evidence is incomplete, private,
  inaccessible, or failing.

For behavior specs, the pointer must still be enough for a later human or agent
with appropriate access to find the evidence. When the evidence is incomplete,
private, inaccessible, or failing, record the blocker or follow-up owner as a
durable team, system, role, or artifact instead of live tracker ownership.

Do not record person names, assignees, reviewer names, or live tracker
ownership in behavior specs. If the only available owner is a person or live
tracker assignment, name the durable role, team, system, artifact, or blocker
needed before readiness can be assessed.

## Readiness Before Slicing

Before behavior-spec evidence becomes executable tracker work, route through
readiness review:

1. Confirm the behavior spec has scope, non-goals, acceptance criteria,
   verification expectations, evidence pointers, and durable owner links.
2. Name blockers for missing, private, inaccessible, or incomplete evidence.
3. Keep readiness review read-only. It decides whether slicing can proceed; it
   does not approve implementation, draft issue bodies, or mutate tracker
   state.
4. After readiness review says the artifact can support slicing, hand the spec,
   readiness evidence, or evidence pointers to issue slicing so that workflow
   can draft executable issue content.

Provider-specific live issue creation, assignment, labeling, status changes, or
tracker mutation belong outside behavior-spec authoring and require an approved
workflow.

## Storage Boundary

Keep evidence in the system that owns it:

- Issue trackers own live issue evidence.
- PR systems own review and merge evidence.
- CI/check systems and source tests own validation evidence.
- Git history owns committed source history.
- Agent-local artifacts own temporary planning and execution detail.

Repository docs may link to those systems when durable truth changes. They must
not become validation-history stores, execution ledgers, postmortem archives, or
copied issue/PR transcripts.
