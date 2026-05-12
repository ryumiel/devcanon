# Routing and Evidence Runtime Reference

This is a packaged runtime reference for `spec-readiness-review`. Use it when
the installed skill cannot rely on repository-local DevCanon docs.

This reference summarizes AFDS work-origin routing, owner selection, evidence
pointer rules, drift handling, and source authority boundaries for pre-slicing
readiness review.

## Owner Selection

Identify the authoritative owner for the next durable decision or action before
reviewing slice readiness. If ownership is ambiguous, return a named blocker
instead of placing content in a convenient non-owner artifact.

Use this rule of thumb:

- Product goals, users, outcomes, assumptions, risks, and open questions belong
  to product requirements.
- Exact behavior, boundaries, acceptance criteria, verification expectations,
  and agent-facing behavior context belong to behavior specs.
- Target output, appetite, sequencing, first usable slices, and validation
  direction belong to roadmap items.
- Reusable workflow policy, procedure, and governed role boundaries belong to
  the owning guideline, source skill, or source agent definition.
- Live issue state belongs to the external issue tracker.
- Review state belongs to the PR system.
- Test, CI, and audit state belongs to the system that produced it.
- Generated previews and installed managed outputs are derived evidence, not
  durable authority.

## Work-Origin Routing

| Work origin                                            | Authoritative owner                                                                           | Evidence owner                                                                               | Next action                                                    | Durable-update trigger                                                                                                   | Blocker wording                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Raw idea or unclear product intent                     | Product requirements                                                                          | Issue comment, product discussion, or linked source note                                     | Create or update product requirements                          | Product goals, users, outcomes, risks, or open questions change                                                          | `Blocked: product intent owner is unclear.`                                    |
| Acceptance-ready behavior question                     | Behavior spec                                                                                 | Issue, PR note, design artifact, or linked source/test evidence                              | Write or update behavior spec                                  | Exact behavior, boundaries, acceptance criteria, or verification expectations change                                     | `Blocked: behavior owner is unclear.`                                          |
| Roadmap-scale direction                                | Roadmap item                                                                                  | Issue or roadmap discussion link                                                             | Update roadmap direction                                       | Target output, first slice, appetite, sequencing, or validation target changes                                           | `Blocked: roadmap owner is unclear.`                                           |
| Reusable workflow policy, procedure, or role boundary  | Guideline or source skill; source agent only for governed role boundary or target constraints | Issue, PR note, or design artifact                                                           | Update owning guideline, source skill, or role definition      | Reusable procedure, trigger, workflow method, role boundary, or target constraint changes                                | `Blocked: workflow policy owner is unclear.`                                   |
| Executable GitHub or Linear issue                      | External issue tracker plus linked source or durable artifacts                                | GitHub Issue or Linear issue                                                                 | Execute from the issue contract                                | Implementation changes durable product, behavior, policy, architecture, contract ownership, or verification expectations | `Blocked: issue lacks an execution contract or owning artifact.`               |
| Review feedback or PR comment                          | PR system for review state; owning artifact for durable changes                               | PR review or PR comment                                                                      | Fix feedback or route durable change to owner                  | Feedback changes durable behavior, policy, contract ownership, or verification expectations                              | `Blocked: review feedback does not identify the governed behavior.`            |
| Failing test, CI check, or audit finding               | Source tests, CI/check system, audit output, or linked issue                                  | Test output, CI/check URL, audit output, or issue comment                                    | Fix failure or route changed expectations to owner             | Fix changes intended behavior, policy, contract ownership, or verification expectations                                  | `Blocked: failure evidence is inaccessible or not reproducible enough to act.` |
| Implementation discovery                               | Source owner or affected durable AFDS artifact                                                | PR note, issue comment, source diff, or test evidence                                        | Update source or owning artifact in same PR, or open follow-up | Discovery changes durable truth beyond the current source edit                                                           | `Blocked: discovery changes durable truth but no owner is named.`              |
| Stale, duplicated, misplaced, or conflicting knowledge | Artifact that owns the truth being corrected                                                  | Review finding, doc audit, issue, PR, source diff, or linked evidence                        | Update owner and remove or redirect non-owner content          | Conflict affects durable truth, navigation, policy, behavior, or verification expectations                               | `Blocked: authoritative owner cannot be determined.`                           |
| Generated-output drift                                 | Source library or renderer behavior                                                           | Generated preview, render/diff command, source tests, or PR diff                             | Regenerate from source or fix source/render behavior           | Drift shows source/render behavior changed or generated output is stale                                                  | `Blocked: generated output drift source is unclear.`                           |
| Installed-output drift                                 | Install manifest, source library, or install/sync behavior                                    | Installed managed output, diff command, install manifest, filesystem state, or issue comment | Sync, uninstall, or fix source/install behavior                | Drift shows managed output is stale, missing, unmanaged, or conflicting                                                  | `Blocked: installed output ownership cannot be proven.`                        |

## Ordinary Execution Fast Path

Executable issues, review comments, failing tests, CI checks, and audit findings
can proceed without a new durable artifact when they do not change durable
product intent, exact behavior, reusable workflow policy, architecture, contract
ownership, roadmap direction, or verification expectations.

For readiness review, this means an already-sliced issue or concrete finding is
not automatically a reason to demand a PRD, spec, roadmap, or capability
classification update. The review may state that no durable owner update is
needed and cite the immediate execution contract.

## Durable Update Trigger

Require a same-PR owner update, or name a follow-up blocker, when the work
changes any of these durable truths:

- product intent;
- exact intended behavior;
- reusable workflow policy or role boundary;
- architecture or contract ownership;
- roadmap direction;
- verification expectations;
- follow-up ownership.

Do not store durable truth only in issue comments, PR comments, validation logs,
agent-local plans, or generated output.

## Evidence Pointers

An evidence pointer must be enough for a later human or agent with appropriate
access to find the evidence without copying the evidence body into repository
docs. Include:

- evidence system;
- stable reference, such as an issue URL, PR URL, review comment, CI/check URL,
  source test path, command, audit output reference, commit, or source file path;
- checked requirement, route, execution contract, or owner;
- result state, such as passed, failed, blocked, unavailable, not run, or not
  applicable;
- blocker or follow-up owner when evidence is incomplete, private,
  inaccessible, or failing.

## Evidence Storage Boundary

Keep evidence in the system that owns it:

- Issue trackers own live issue evidence.
- PR systems own review and merge evidence.
- CI/check systems and source tests own validation evidence.
- Git history owns committed source history.
- Agent-local artifacts own temporary planning and execution detail.

Repository docs may link to those systems when durable truth changes. They must
not become validation-history stores, execution ledgers, postmortem archives, or
copied issue/PR transcripts.

## Private or Inaccessible Evidence

When evidence is private, inaccessible, unavailable, or incomplete, name the
evidence system and the missing access or missing evidence as a blocker.

If a durable decision depends on unavailable evidence, keep the route blocked
until the evidence is available or the decision is reframed so it no longer
depends on that evidence. The owning artifact may record the blocker and
evidence pointer, but it must not copy private evidence or invent a local
summary as substitute evidence.

## Drift and Conflict Classification

Classify drift and conflict before changing durable artifacts:

| Case                                                                                                   | Detection class                                                   | Expected route                                                         |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Broken links, missing indexed paths, stale generated previews, markdown formatting, lint failures      | Mechanically detectable                                           | Fix in the owner or regenerate from source                             |
| Duplicate claims across product requirements, spec, roadmap, guideline, issue, or PR text              | Review-detectable                                                 | Identify the owner, update it, and remove or redirect non-owner claims |
| Conflicting behavior requirements or workflow policies                                                 | Review-detectable                                                 | Update the owning durable artifact or name a blocker                   |
| Generated output differs from source render result                                                     | Mechanically detectable                                           | Regenerate output or fix renderer/source behavior                      |
| Installed managed output differs from manifest/source expectations                                     | Mechanically detectable when local installed paths are accessible | Run diff, sync, uninstall, or open follow-up                           |
| Private tracker state, private PR evidence, inaccessible CI logs, or unavailable local installed paths | Out of scope for mechanical validation without access             | Name the access blocker and use an evidence pointer                    |
| Agent-local scratch detail not promoted to a durable owner                                             | Out of scope for durable docs                                     | Leave local or discard unless it changes durable truth                 |

## Source and Generated Authority

Source skills, source agent definitions, durable docs, source schemas, source
types, validators, renderers, install logic, and the install manifest own their
respective contracts.

Generated previews and installed managed outputs are derived artifacts. They may
provide drift evidence, but they are not durable product, behavior, policy, or
contract authority.
