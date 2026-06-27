# Pre-Slicing Procedure Map Runtime Reference

This is a packaged runtime reference for `spec-readiness-review`. Use it when
the installed skill cannot rely on repository-local DevCanon docs.

This reference summarizes how to apply AFDS routing rules before drafting
executable GitHub or Linear issues from a durable owner artifact.

## Lifecycle Phases

Portable AFDS lifecycle work moves through these phases. Not every item needs
every phase.

| Phase                      | User goal                                                              | Owning surface                                                                |
| -------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Shape intent               | Turn unclear product or workflow intent into durable direction         | Product requirements, roadmap, guideline, ADR, or other durable AFDS artifact |
| Specify behavior           | Convert stable intent into acceptance-ready behavior                   | Behavior spec                                                                 |
| Slice work                 | Create executable work from the owning artifact                        | External issue tracker linked to the owning durable artifact                  |
| Execute issue              | Implement already-sliced work or concrete findings                     | Source, issue tracker, and any linked durable artifact                        |
| Review and verify          | Check the change against the execution contract and evidence           | PR system, source tests, CI/check systems, audit output, or review comments   |
| Merge                      | Ship the reviewed change and keep merge state out of docs              | PR system and Git history                                                     |
| Garden                     | Correct stale, duplicated, misplaced, or conflicting knowledge         | Artifact that owns the truth being corrected                                  |
| Govern reusable capability | Decide whether a repeated workflow need requires toolkit asset changes | Capability-classification issue or accepted governance artifact               |

The ordinary execution fast path remains valid: executable issues, review
comments, failing tests, CI checks, and audit findings do not need new product
requirements, behavior specs, or capability classification when durable truth is
unchanged.

## Issue-Slicing Path

Use this path to create executable work from an owning durable artifact.
Readiness review checks whether the artifact is ready to support slicing; it
does not draft tracker text or mutate tracker state.

1. Start with concrete evidence from one or more owners: product requirements,
   behavior spec, roadmap item, source owner, guideline, ADR, or accepted
   governance artifact.
2. Build or verify a minimum evidence pointer for each needed claim.
3. If the evidence describes reusable workflow or role-boundary work, ask
   whether this is a reusable capability gap.
4. If a reusable capability gap is suspected, route to AFDS workflow
   capability governance instead of approving a new or changed reusable asset
   inside readiness review.
5. Review readiness: scope, boundaries, non-goals, acceptance criteria,
   verification expectations, evidence pointers, and unresolved owner links.
6. Return `Ready`, `Needs revision`, or `Blocked`. Include slicing notes only
   when they clarify issue-slicing implications without drafting the issue.
7. Handoff to external issue drafting only after the durable owner is clear and
   the evidence pointer is sufficient.

Provider-specific live issue creation or mutation requires its own approved
workflow. Readiness review only determines whether slicing can safely proceed.

## Relevant Pre-Slicing Origins

Use work origin as the key. The same origin routes the same way regardless of
persona.

| Work origin                                            | Readiness question                                         | Owner                                                                                                  | Evidence owner                                                        | Procedure                                                                                                      | Allowed output                                                                                | Blocker wording                                      |
| ------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Raw idea or unclear product intent                     | What product outcome are we trying to make true?           | Product requirements                                                                                   | Issue comment, product discussion, or linked source note              | Shape users, goals, outcomes, risks, assumptions, and open questions before behavior or implementation slicing | Product requirements update, or blocker if no owner exists                                    | `Blocked: product intent owner is unclear.`          |
| Acceptance-ready behavior question                     | What behavior should the product or workflow guarantee?    | Behavior spec                                                                                          | Issue, PR note, design artifact, or linked source/test evidence       | Define exact requirements, boundaries, acceptance criteria, verification expectations, and agent context       | Behavior spec update and evidence links                                                       | `Blocked: behavior owner is unclear.`                |
| Roadmap-scale direction                                | What target output and validation path should guide work?  | Roadmap item                                                                                           | Issue or roadmap discussion link                                      | Define target output, appetite, first usable slices, sequencing, and validation signals                        | Roadmap update with links to owning artifacts or issue                                        | `Blocked: roadmap owner is unclear.`                 |
| Reusable workflow policy, procedure, or role boundary  | Which reusable procedure or role rule should users follow? | Guideline or accepted source owner; source agent only for governed role boundary or target constraints | Issue, PR note, or design artifact                                    | Identify whether the truth is policy, procedure, role identity, target constraint, or source behavior          | Guideline update, accepted source-owner update, candidate capability gap, or evidence pointer | `Blocked: workflow policy owner is unclear.`         |
| Stale, duplicated, misplaced, or conflicting knowledge | Which artifact owns the truth being corrected?             | Artifact that owns the truth being corrected                                                           | Review finding, doc audit, issue, PR, source diff, or linked evidence | Identify the owner, update it, and remove, redirect, or narrow non-owner content                               | Owner correction, redirect, stale duplicate removal, or blocker                               | `Blocked: authoritative owner cannot be determined.` |

These origins are especially relevant before slicing because they often mean the
artifact is not ready to become executable work. A finding should explain which
owner must be updated and what evidence pointer is missing or insufficient.

## Cross-Cutting Evidence Cases

Private, inaccessible, unavailable, or incomplete evidence is an evidence state,
not a normal work origin.

When evidence is incomplete:

1. Name the evidence system.
2. Provide the stable reference available to the user or agent.
3. State the checked requirement, route, execution contract, or owner.
4. Mark the result state as blocked, unavailable, not run, failing, or not
   applicable.
5. Name the blocker or follow-up owner.

Do not copy private issue, PR, CI, validation, or agent-local history into repo
docs. Do not invent a local summary to replace evidence the user or agent cannot
access. If a durable decision depends on unavailable evidence, the route remains
blocked until that evidence is available or the decision is reframed.

Agent-local issue snapshots, research briefs, designs, and plans are disposable
execution context. They may inform the current session, but they do not become
durable authority unless their conclusions are promoted into the owning
artifact.

Generated previews and installed managed outputs are also not durable authority.
Use them as drift evidence, then route back to source, renderer, manifest, or
install/sync ownership.

## Follow-Up Surface and Gap Handling

Follow-up workflow surfaces are candidates for later AFDS workflow capability
governance. Do not automatically convert them into implementation backlog and
do not approve new skills, agents, source behavior, provider automation, or
governance assets from readiness review alone.

Revisit a follow-up surface only when at least one condition is true:

- the same procedure gap blocks multiple issues or repositories;
- users cannot identify the authoritative owner with existing guidance;
- evidence pointers repeatedly fail because the current procedure is unclear;
- an existing skill, guideline, or source behavior cannot express the accepted
  workflow without becoming misleading;
- generated-output or installed-output drift exposes a missing source or
  manifest-owned procedure.

Extract a candidate capability gap only after the user procedure is clear.
Record:

- the work origin that exposed the gap;
- the user or workflow that was blocked;
- the authoritative owner and evidence owner;
- the procedure step that failed or was missing;
- the allowed output that existing assets could not produce;
- the named blocker or follow-up owner.

Capability classification decides whether a candidate should update an existing
asset, create a new asset, be deferred, or be rejected. Readiness review only
reports the gap and the owner needed for safe slicing.
