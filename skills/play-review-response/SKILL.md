---
name: play-review-response
description: Explicit-invocation workflow for verification-first response to code review feedback. Use only when the user explicitly invokes `play-review-response` or asks to address review feedback through that workflow.
requires:
  - branch-review
  - play-planning
  - play-subagent-execution
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# Code Review Reception

## Invocation Policy

Do not select this workflow from ordinary discussion, review-shaped text, possible behavior-change wording, or implementation-adjacent language; the explicit-invocation rule itself is owned by this skill's frontmatter (`description` and `codex_sidecar` policy), and an explicit handoff from an owning workflow to `play-review-response` counts as explicit invocation.

## Overview

Code review requires technical evaluation, not emotional performance.

**Core principle:** Verify and classify before execution. Ask before assuming.
Technical correctness over social comfort.

## The Response Pattern

```
WHEN receiving code review feedback:

1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY: Check against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. EXECUTE: Only after classification, exact current mutation authority, and
   the selected execution mode permit it; work one item at a time and test each
```

**Execution boundary:** Every instruction below to implement, fix, or execute
assumes Writing Skills classification, separately established exact current
authority, and the selected execution mode permit it.

**Required support:** Read only a triggered reference before the action it
governs. If a required reference is missing, blank, or unreadable, stop that
action and report the blocker. Do not substitute an inline summary, silently
continue, or load unrelated references as a fallback.

## Forbidden Responses

**Never:**

- "You're absolutely right!" (explicit CLAUDE.md violation)
- "Great point!" / "Excellent feedback!" (performative)
- "Let me implement that now" (before verification, classification, and mode
  selection)

**INSTEAD:**

- Restate the technical requirement
- Ask clarifying questions
- Push back with technical reasoning if wrong
- Proceed only through an authorized execution mode (actions > words)

## Handling Unclear Feedback

If any item is unclear, STOP and do not implement anything yet. Ask for
clarification on the unclear items first, because items may be related and
partial understanding produces a wrong implementation. Worked example:
[`examples/feedback-intake.md`](examples/feedback-intake.md).

## Source-Specific Handling

### From the user

- **Trusted** - understand first; still apply the classification and mode gate
  before any mutation
- **Still ask** if scope unclear
- **No performative agreement**
- **Proceed through the authorized mode** or provide a technical acknowledgment

### From External Reviewers

```
BEFORE selecting a mode:
  1. Check: Technically correct for THIS codebase?
  2. Check: Breaks existing functionality?
  3. Check: Reason for current implementation?
  4. Check: Works on all platforms/versions?
  5. Check: Does reviewer understand full context?
```

Push back with technical reasoning when the suggestion seems wrong. Say so and
ask for direction when you cannot easily verify it. Stop and discuss with the
user first when it conflicts with the user's prior decisions. Worked example:
[`examples/feedback-intake.md`](examples/feedback-intake.md).

**Rule:** "External feedback - be skeptical, but check carefully"

## Structural Lifecycle Feedback

Treat lifecycle-sensitive review feedback as structural risk unless
verification proves the concern is stale, invalid, already addressed,
explanation-only, or safely inside the inline envelope. Lifecycle-sensitive
feedback includes comments about operation start, readiness, success, failure,
cleanup, retries, cancellation, disposal, restart, reconnect, stale state,
stale events, concurrent or same-tick bypasses, correlation, ownership, or
authoritative completion signals.

Structural-risk feedback requires the Writing Skills proportionality gate before
inline or planned implementation selection. An in-scope product blocker that
reaches implementation selection uses the existing planned route when
structural risk requires it. Do not select inline merely because the reviewer's
patch suggestion is small, the diff looks local, the user wants speed, or tests
currently pass.

- **Stale/invalid** - retain the existing no-code response; do not select
  inline. Current code and current feedback-source state show the concern no
  longer applies or is technically incorrect; for GitHub/PR-thread-backed
  feedback, current thread state also supports that disposition.
- **Already addressed** - retain the existing no-code response; do not select
  inline. The pushed branch or current local diff contains the fix, and the
  same concern can be mapped to concrete evidence.
- **Explanation-only** - retain the existing no-code response; do not select
  inline. No code change is required, and a concise reply can explain why with
  source evidence.
- **Safely inline** - continue toward inline selection only when the Writing
  Skills proportionality gate authorizes inline selection and every normal
  inline condition is true. The lifecycle concern must not affect operation
  boundaries, ownership, ordering, correlation, cleanup, retry, failure, or
  externally visible behavior.

For multiple related comments, contract-sensitive, policy-sensitive,
lifecycle-sensitive, or cross-module feedback, read
[`references/structural-diagnosis.md`](references/structural-diagnosis.md)
before writing code or a plan. Its operation-boundary checks and root-cause
diagnosis apply before deriving work items. This entry remains the normative
workflow owner; the reference is its subordinate procedure and cannot override
the entry. If it is unavailable, stop before code or planning input writes and
report the blocker.

## Execution Mode Selection

After source-aware feedback intake and verification, classify each verified
concern before changing code. Source-aware feedback intake means capturing the
current feedback-source state for every concern, fetching current thread state
when feedback is GitHub/PR-thread-backed, mapping feedback to the same concern,
and separating executable feedback from stale, already-addressed,
explanation-only, or unclear feedback before selecting a mode.

### Proportionality gate (Writing Skills)

Before choosing inline or planned implementation, load the bundled
[`references/finding-proportionality.md`](references/finding-proportionality.md).
Writing Skills remains the classification owner; this runtime copy is its
portable installed representation and does not add policy here. Classify a
behavior-preserving compliance candidate from rule, violation, and preservation
evidence before assessing its exact current repair authority. Only an in-scope
product blocker, a proof/test correction at its existing proof owner, or an
otherwise qualified compliance candidate or necessary-completion correction
with exact current authority reaches inline/planned implementation selection
through the existing bounded route.
For a necessary correction caused by the authorized change, use that reference's
five pre-edit facts and separately verify exact authority for every affected
responsibility. Unchanged file, signature, module, or adjacent-context
placement alone does not deny a determined necessary correction; unresolved
facts, new design decisions, and independent approval boundaries still stop.
Known missing authority retains the candidate classification, withholds
mutation, and requires an explicit existing owner or approval handoff; uncertain
authority retains the classification and uses the existing fail-closed route to
establish the missing evidence or decision. Proof/test corrections remain
proof/test-only and cannot expand production behavior. Other non-mutating
dispositions bypass implementation selection or use their independent route.

Implementation selections:

- **Inline execution** - handle directly in this skill.
- **Planned execution** - write a verified review-response planning input,
  invoke `play-planning`, then hand the approved generated plan to
  `play-subagent-execution`.

Non-implementation outcome:

- **No-code response** - reply, report, or ask without changing code.

No-code response outcomes include technically invalid feedback, stale feedback,
already-addressed feedback, explanation-only feedback, and
needs-user-clarification feedback. No-code does not mean ignored: provide the
verified evidence, keep unclear or unresolved concerns open, and follow the
GitHub thread reply/refetching and resolution eligibility rules when applicable.

For an adjacent independently releasable defect, produce an evidence-bearing
independent-owner, parent, or manual-action handoff through this existing
no-code outcome. Keep the active issue unchanged, do not auto-create follow-up
tracker work, and preserve the review thread until the handoff is recorded.

Inline execution is allowed only when every inline condition is true:

- The feedback is one or two clear, low-risk, local comments.
- The affected code is in the same file or tightly local files.
- There is no ambiguity after verification.
- There is no public contract, workflow-policy, skill/agent contract, schema,
  generated-output, security, lifecycle, data-loss, or cross-module behavior
  risk.
- The change needs no new test design beyond existing obvious focused checks.
- Quick verification can prove the fix without broader planning, and the fix
  can be explained clearly in-thread.

Planned execution is required for multi-item feedback outside the inline
envelope. Planned execution is required for ambiguous feedback after
clarification establishes an executable concern; unclear reviewer intent still
stops for clarification before planning. Planned execution is required for
policy-sensitive feedback. Planned execution is required for
contract-sensitive feedback. Planned execution is required for schema changes.
Planned execution is required for generated-output changes. Planned execution is
required for security-sensitive changes. Planned execution is required for
lifecycle changes. Planned execution is required for recovery behavior. Planned
execution is required for data-loss risk. Planned execution is required for
cross-module behavior. Planned execution is required for high-risk changes.
Planned execution is required when audit evidence or traceability is needed.
Planned execution is required when independent implementation/review gates are
needed. Planned execution is required when explanation-only feedback is mixed
with code changes.

After selecting planned execution, read
[`references/planned-execution.md`](references/planned-execution.md) before
writing the planning input, invoking `play-planning`, or handing the plan to
`play-subagent-execution`. It supplies the verified design, planning-input
self-review, combined D5 provenance and exact digest checks, plan approval,
and executor handoff. For a cluster requiring structural diagnosis, read the
structural-diagnosis reference first. Planned implementation cannot begin
until its complete planning, approval, and handoff gates pass. This entry
remains the normative workflow owner; the reference is its subordinate
procedure and cannot override the entry. If it is unavailable, stop before
planning input writes, planning invocation, or executor dispatch and report
the blocker.

Worked inline, no-code, and GitHub-closeout-exclusion scenarios:
[`examples/execution-mode-scenarios.md`](examples/execution-mode-scenarios.md).

### Plan Approval Gate

For planned review-response work, apply the complete
[`references/planned-execution.md#plan-approval-gate`](references/planned-execution.md#plan-approval-gate)
gate to the exact combined-reviewed plan before executor handoff. The entry
owns route selection; read that reference only after planned execution is
selected and before writing the planning input, invoking `play-planning`, or
handing off the plan. Its approval, authority, provenance, and digest checks
remain required. If the reference is missing, blank, or unreadable, stop the
dependent action and report the blocker.

## YAGNI Check for "Professional" Features

When a reviewer suggests "implementing properly", grep the codebase for actual
usage first. If nothing calls it, propose removing it. If it is used, let the
classification and selected execution mode determine any work. Worked example:
[`examples/yagni-check.md`](examples/yagni-check.md).

**Rule:** "You and reviewer both report to me. If we don't need this feature, don't add it."

## Interrupted Validation Recovery

When a required or relevant validation command fails and may already have
executed a stage that generates files, read
[`references/validation-recovery.md`](references/validation-recovery.md)
directly before choosing any recovery action or retry. This entry remains the
normative workflow owner; the recovery reference is its subordinate procedure
for that condition and cannot expand current repair authority. If the reference
is missing, blank, or unreadable, stop recovery and retry and report the
blocker. A successful command does not trigger this read.

## Implementation Order

```
FOR multi-item feedback whose classification and selected mode authorize execution:
  1. Clarify anything unclear FIRST
  2. Then execute in this order:
     - Blocking issues (breaks, security)
     - Simple fixes (typos, imports)
     - Complex fixes (refactoring, logic)
  3. Test each fix individually
  4. Verify no regressions
  5. After verification, commit review-response work:
     - If this is an already-pushed or reviewed PR branch, use a follow-up commit and plain push
     - If the branch has not been pushed or reviewed, local cleanup is allowed
```

## PR Branch Commit Continuity

Preserve review continuity. Once a PR branch has already been pushed or review
has started, use normal follow-up commits and a plain push by default.

Pre-push local cleanup is allowed. Before a branch is pushed or reviewed, you
may amend, squash, rebase, or otherwise clean local history according to the
repo's normal workflow.

For an already-pushed or reviewed PR branch:

- Use normal follow-up commits for review-response fixes.
- Use a plain push after verification.
- Do not amend already-pushed commits by default.
- Do not force-push by default.
- Amend or force-push only when the user explicitly asks for cleanup/squash, or
  when the repository workflow explicitly requires rewritten history.

Why: reviewers need stable history and review continuity. Rewriting a reviewed
branch can hide what changed since the last review, invalidate comment context,
or make incremental review harder.

Examples:

```text
Acceptable pre-push cleanup:
  You fix local review nits before opening or updating a PR for the first time.
  You amend the local commit, then push the cleaned branch.

Incorrect post-review rewrite:
  A reviewer comments on an already-pushed PR branch.
  You fix it with `git commit --amend` and `git push --force`.

Correct post-review response:
  A reviewer comments on an already-pushed PR branch.
  You fix it with a follow-up commit and `git push`.
```

## Publication and Thread Closeout

Before any push, GitHub reply, resolve, or comment side effect for
review-response work, read
[`references/publication-closeout.md`](references/publication-closeout.md)
and apply its complete Pre-Push Review Gate, current-thread refetch sequence,
and separate resolution eligibility. Stop for explicit approval unless an active
owning workflow retains current publication authority covering the same
in-scope correction and listed side effects, as specified by that gate. Always
present its concrete summary; covered publication needs no generic renewed
request. Reply permission does not grant resolution permission; human
threads stay unresolved by default without the reference's current-list
approval, reviewer confirmation, or repository-policy delegation. This entry
remains the normative workflow owner; the reference is its subordinate
procedure and cannot override the entry. If it is unavailable, stop before
any push, reply, resolve, or comment and report the blocker.

## When To Push Back

Push back when:

- Suggestion breaks existing functionality
- Reviewer lacks full context
- Violates YAGNI (unused feature)
- Technically incorrect for this stack
- Legacy/compatibility reasons exist
- Conflicts with the user's architectural decisions

**How to push back:**

- Use technical reasoning, not defensiveness
- Ask specific questions
- Reference working tests/code
- Involve the user if architectural

**Signal if uncomfortable pushing back out loud:** "Strange things are afoot at the Circle K"

## Acknowledging Correct Feedback

When feedback IS correct, state the fix and where it landed, or state the
authorized outcome and show it in the code. ANY gratitude expression is
forbidden. Approved and forbidden phrasings:
[`examples/response-phrasing.md`](examples/response-phrasing.md).

**Why no thanks:** Actions speak. State the authorized outcome. The code itself
shows you heard the feedback.

**If you catch yourself about to write "Thanks":** DELETE IT. State the fix instead.

## Gracefully Correcting Your Pushback

If you pushed back and were wrong, say what you checked, what the code actually
does, and that you will follow the selected mode. No long apology, no defending
why you pushed back, no over-explaining. Sample phrasings:
[`examples/response-phrasing.md`](examples/response-phrasing.md).

State the correction factually and move on.

## Common Mistakes

| Mistake                      | Fix                                 |
| ---------------------------- | ----------------------------------- |
| Performative agreement       | State requirement or just act       |
| Blind implementation         | Verify against codebase first       |
| Batch without testing        | One at a time, test each            |
| Assuming reviewer is right   | Check if breaks things              |
| Avoiding pushback            | Technical correctness > comfort     |
| Partial implementation       | Clarify all items first             |
| Can't verify, proceed anyway | State limitation, ask for direction |

Worked bad/good response pairs for these mistakes:
[`examples/response-phrasing.md`](examples/response-phrasing.md).

## GitHub Thread Replies

Before any GitHub reply or closeout, read the publication-closeout reference
above. When replying to an inline review comment on GitHub, use the existing
comment thread with the configured CLI invocation
(`{{tool:github-cli}} api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`),
not a top-level PR comment. Reply with concise fix or no-code evidence; follow
the reference's approval, refetch, and resolution rules.

## Issue Batch Routing Reports

When invoked by `issue-batch-routing` or an owning workflow, read
[`references/batch-reporting.md`](references/batch-reporting.md) before
producing a review-response approval-gate, blocker, pushed-head, verification,
or thread-disposition report. Include provider-tagged source identity and the
complete relevant route key. This entry remains the normative workflow owner;
the reference is its subordinate procedure and cannot override the entry. If
it is unavailable, stop before producing the report and report the blocker.

## The Bottom Line

**External feedback = suggestions to evaluate, not orders to follow.**

Verify. Question. Classify. Select a mode. Then execute.

No performative agreement. Technical rigor always.
