---
name: play-review-response
description: Explicit-invocation workflow for verification-first response to code review feedback. Use only when the user explicitly invokes `play-review-response` or asks to address review feedback through that workflow.
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# Code Review Reception

## Invocation Policy

This workflow is explicit-invocation-only. Do not select it from ordinary discussion, review-shaped text, possible behavior-change wording, or implementation-adjacent language. Run it only when the user explicitly invokes `play-review-response` or when an owning workflow explicitly hands off to `play-review-response`.

## Overview

Code review requires technical evaluation, not emotional performance.

**Core principle:** Verify before implementing. Ask before assuming. Technical correctness over social comfort.

## The Response Pattern

```
WHEN receiving code review feedback:

1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY: Check against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each
```

## Forbidden Responses

**NEVER:**

- "You're absolutely right!" (explicit CLAUDE.md violation)
- "Great point!" / "Excellent feedback!" (performative)
- "Let me implement that now" (before verification)

**INSTEAD:**

- Restate the technical requirement
- Ask clarifying questions
- Push back with technical reasoning if wrong
- Just start working (actions > words)

## Handling Unclear Feedback

```
IF any item is unclear:
  STOP - do not implement anything yet
  ASK for clarification on unclear items

WHY: Items may be related. Partial understanding = wrong implementation.
```

**Example:**

```
the user: "Fix 1-6"
You understand 1,2,3,6. Unclear on 4,5.

❌ WRONG: Implement 1,2,3,6 now, ask about 4,5 later
✅ RIGHT: "I understand items 1,2,3,6. Need clarification on 4 and 5 before proceeding."
```

## Source-Specific Handling

### From the user

- **Trusted** - implement after understanding
- **Still ask** if scope unclear
- **No performative agreement**
- **Skip to action** or technical acknowledgment

### From External Reviewers

```
BEFORE implementing:
  1. Check: Technically correct for THIS codebase?
  2. Check: Breaks existing functionality?
  3. Check: Reason for current implementation?
  4. Check: Works on all platforms/versions?
  5. Check: Does reviewer understand full context?

IF suggestion seems wrong:
  Push back with technical reasoning

IF can't easily verify:
  Say so: "I can't verify this without [X]. Should I [investigate/ask/proceed]?"

IF conflicts with the user's prior decisions:
  Stop and discuss with the user first
```

**Rule:** "External feedback - be skeptical, but check carefully"

## Structural Lifecycle Feedback

Treat lifecycle-sensitive review feedback as structural risk unless
verification proves the concern is stale, invalid, already addressed,
explanation-only, or safely inside the inline envelope. Lifecycle-sensitive
feedback includes comments about operation start, readiness, success, failure,
cleanup, retries, cancellation, disposal, restart, reconnect, stale state,
stale events, concurrent or same-tick bypasses, correlation, ownership, or
authoritative completion signals.

Structural-risk feedback defaults to planned execution. Do not downgrade a
lifecycle-sensitive concern to inline execution merely because the reviewer's
patch suggestion is small, the diff looks local, the user wants speed, or tests
currently pass. Downgrade only after verification establishes one of these
dispositions:

- **Stale/invalid** - current code and current feedback-source state show the
  concern no longer applies or is technically incorrect; for
  GitHub/PR-thread-backed feedback, current thread state also supports that
  disposition.
- **Already addressed** - the pushed branch or current local diff contains the
  fix, and the same concern can be mapped to concrete evidence.
- **Explanation-only** - no code change is required, and a concise reply can
  explain why with source evidence.
- **Safely inline** - every normal inline condition is true, and the lifecycle
  concern does not affect operation boundaries, ownership, ordering,
  correlation, cleanup, retry, failure, or externally visible behavior.

For executable lifecycle-sensitive concerns, check the operation lifecycle
before writing code or a plan:

- **Start boundary** - what begins the operation and what prevents duplicate,
  same-tick, or concurrent starts?
- **Readiness boundary** - what state means the operation is allowed to proceed?
- **Success boundary** - what authoritative completion signal marks success,
  and who owns setting it?
- **Failure boundary** - what failures are recoverable, retryable, terminal, or
  user-visible?
- **Ownership** - which component owns state transitions, cleanup, disposal,
  cancellation, restart, reconnect, and externally visible effects?
- **Identity / correlation** - how events, callbacks, jobs, retries, or
  responses map to the current operation rather than a stale one.
- **Stale state and events** - how old events, old promises, cached state, or
  previous attempts are rejected or ignored.
- **Retry / cancellation / disposal / restart / reconnect** - how repeated or
  interrupted lifecycles avoid double effects and missed cleanup.
- **Cleanup** - who owns normal cleanup, stale cleanup, speculative or
  render-only cleanup, and cleanup after failure or cancellation?
- **Tests** - what focused checks cover normal, stale, cleanup, retry,
  cancellation, failure, same-tick, and concurrent paths?
- **Docs / contracts** - whether the review feedback changes public contracts,
  workflow policy, skill/agent contracts, generated-output expectations, or
  consumer-facing behavior.

## Execution Mode Selection

After source-aware feedback intake and verification, classify each verified
concern before changing code. Source-aware feedback intake means capturing the
current feedback-source state for every concern, fetching current thread state
when feedback is GitHub/PR-thread-backed, mapping feedback to the same concern,
and separating executable feedback from stale, already-addressed,
explanation-only, or unclear feedback before selecting a mode.

- **Inline execution** - handle directly in this skill.
- **Planned execution** - write a review-response plan, then hand it to
  `play-subagent-execution`.
- **No-code response** - reply, report, or ask without changing code.

No-code response outcomes include technically invalid feedback, stale feedback,
already-addressed feedback, explanation-only feedback, and
needs-user-clarification feedback. No-code does not mean ignored: provide the
verified evidence, keep unclear or unresolved concerns open, and follow the
GitHub thread reply/refetching and resolution eligibility rules when applicable.

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

For planned execution, create a direct/manual `.ephemeral/*-plan.md` handoff
and invoke the executor with:

```text
Plan: <path>
```

Review-response-created plans must be valid direct/manual
`play-subagent-execution` plans under the executor's current structural
task-contract gate. They must not rely on issue-priming `--auto` reduced-route
behavior, because direct/manual review-response plans do not carry
parent-owned issue-priming state, validated auto-handoff evidence, or a
guaranteed downstream `branch-review --fix` loop.

Each planned task must include the reviewer concern, verified evidence,
disposition, source authority, acceptance criteria, TDD expectations,
verification expectations, and contract checklist fields as applicable.

`play-subagent-execution` owns executor-owned mechanics after the handoff:
task-contract validation, dispatch/skip-dispatch, review routing, snapshot
handling, implementer lifecycle, final whole-implementation review for
direct/manual calls, and whole-diff gate validation only when a caller-owned
handoff supplies that gate. This skill owns source-aware feedback intake,
verification, execution-mode selection, no-code dispositions, follow-up commit
continuity, GitHub thread replies/refetching, and resolution eligibility.

Direct/manual review-response plans do not get an automatic whole-diff review
after the executor's final code-quality reviewer. Run `branch-review` before
opening or updating a PR when planned review-response work needs whole-diff
coverage.

### Plan Approval Gate

For planned review-response work, create a written `.ephemeral/*-plan.md`
before implementation. This gate borrows the approval-gate shape from
`play-brainstorm` without invoking `play-brainstorm` and without making it a
dependency of `play-review-response`.

Before handing the plan to `play-subagent-execution`, present the plan to the
user with a distinct producer notice and approval prompt:

```text
I wrote the review-response plan at `.ephemeral/<date>-review-response-plan.md`.
Please review it. I will not implement it until you approve the plan.
```

The plan approval gate is explicit:

- The plan must be Markdown-valid enough for explicit repository scans and
  remains agent-local evidence under `.ephemeral/`; it is not durable product,
  architecture, or workflow documentation.
- Run plan self-review and any applicable plan-review gate before asking for
  approval.
- Wait for user approval before implementation begins.
- If the user requests plan changes, revise the plan, rerun plan self-review
  and any applicable plan-review gate, then ask for approval again.
- Repeat the user approval loop until the user approves or stops the work.
  There is no fixed maximum for this human approval loop.
- Keep the separate `play-planning` agent-review cap out of the user approval
  gate; that cap governs planning-agent review rounds, not how many times the
  user may request plan changes before approval.

### Plan Self-Review

Plan self-review is semantic validation of the review-response plan before
asking for approval. Markdown lint may be useful, but it is not plan
self-review; formatting checks do not prove that reviewer concerns are
understood, current, correctly classified, or executable.

Before asking for approval, the plan must include a named `Plan Self-Review`
section. The section must show every current review concern/comment maps to one
of these dispositions: executable, stale/invalid, already addressed,
explanation-only, unclear, or unresolved. Put the evidence inside that named
section so the approval gate has one auditable review location.

For each concern, validate that:

- The reviewer concern is accurately restated.
- The current feedback-source state was captured and used.
- For GitHub/PR-thread-backed feedback, the current thread state was fetched
  and used.
- The current code evidence supports the disposition.
- The execution mode is justified under inline/planned/no-code rules.
- The acceptance criteria directly close the reviewer's failure mode.
- The tests and verification match the risk and touched contract.
- GitHub side effects are separated from implementation approval.
- The direct/manual executor handoff suitability is checked when the plan will be
  handed to `play-subagent-execution`.

Treat review-feedback intake as a ledger of evidence. Record enough current
feedback-source state, current thread state when the feedback is
GitHub/PR-thread-backed, code evidence, disposition reasoning, and gaps to prove
every review concern/comment maps to either a no-code disposition or an
implementation work item. Then derive executor work items from those root-cause
clusters rather than mechanically creating one implementation task per review
comment. The work items address the structural cause rather than only the
visible comment text.

Invalid self-review examples:

- `Markdown lint passed`
- `Plan looks good`
- `All comments listed` without concern-to-fix mapping

Valid self-review example:

```text
Comment mapping: C1 and C3 map to lifecycle or correlation gap; C2 is
explanation-only.
Current feedback-source and code evidence: captured the current reviewer
feedback state, fetched unresolved GitHub PR threads at 2026-06-02, and
confirmed `src/worker.ts` still accepts stale completion callbacks.
Gaps: no test covers same-tick cancellation followed by stale completion.
Root-cause diagnosis: missing validation boundary at the operation owner.
Root-cause-derived work items: strengthen the owner-side completion guard and
add stale-callback coverage, rather than one task per comment.
Residual risks: retry cleanup still needs focused verification.
Executor handoff suitability: direct/manual plan has source authority,
acceptance criteria, TDD expectations, verification, and GitHub closeout left
with `play-review-response`.
```

GitHub reply, refetch, and resolution closeout remain owned by
`play-review-response` and must not be dispatched as `play-subagent-execution`
implementation tasks.

### Root Cause / Structural Diagnosis

For multiple related comments, contract-sensitive, policy-sensitive,
lifecycle-sensitive, or cross-module feedback, include a `Root Cause /
Structural Diagnosis` section or equivalent evidence before deriving work
items.

Classify each related feedback cluster using the closest diagnosis:

- isolated implementation mistake.
- duplicated source of truth.
- unclear ownership or authority.
- contract drift between producer and consumer.
- missing validation boundary.
- lifecycle or correlation gap.
- test fixture mismatch hiding the real contract.

For each cluster, identify the authoritative source for the disputed behavior
and classify the fix strategy:

- patch local symptoms.
- consolidate authority.
- extract or strengthen a shared validation layer.
- update producer contract.
- update consumer adapter.
- document a no-code policy boundary.

After the executor returns, this skill resumes ownership of explanation-only
replies, thread refetching, resolution eligibility, and final PR-thread
closeout.

Inline example:

```text
Reviewer: "Typo in this private helper name."
Verification: same file, clear local typo, no contract risk, quick test exists.
Mode: Inline execution.
Action: Fix directly, run the focused check, commit as follow-up if the PR was
already pushed or reviewed.
```

Plan-plus-executor handoff example:

```text
Reviewer: "This skill routing should cover schemas, lifecycle recovery, and
thread closeout behavior."
Verification: policy-sensitive, contract-sensitive, multi-surface workflow
change with traceability needs.
Mode: Planned execution.
Action: Write `.ephemeral/<date>-review-response-plan.md`, run plan
self-review and applicable plan-review, ask for approval, wait for
approval, then invoke `play-subagent-execution` with `Plan: <path>`.
```

## YAGNI Check for "Professional" Features

```
IF reviewer suggests "implementing properly":
  grep codebase for actual usage

  IF unused: "This endpoint isn't called. Remove it (YAGNI)?"
  IF used: Then implement properly
```

**Rule:** "You and reviewer both report to me. If we don't need this feature, don't add it."

## Implementation Order

```
FOR multi-item feedback:
  1. Clarify anything unclear FIRST
  2. Then implement in this order:
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

## Pre-Push Review Gate

Before any push, GitHub reply, GitHub resolve, or GitHub comment side effect for
review-response work, stop at the Pre-Push Review Gate and wait for explicit
approval unless an active owning workflow already has an approved posting gate
that covers the same side effects.

The gate summary must include:

- Local changes since the review-response work began, including follow-up
  commit SHA when a commit exists.
- Verification run and result, including regression coverage or a clear reason
  no code change was needed.
- Thread disposition for each concern: behavioral fix, no-code explanation,
  stale/invalid/already-addressed, unresolved, or needs clarification.
- Intended external actions, such as push, in-thread reply, top-level PR
  comment, thread resolution, or leaving a thread unresolved.

Do not treat "push it", "respond", or "looks good" as permission to skip this
gate when the workflow has not yet seen the local-state, verification, and
intended-action summary. After approval, perform only the listed side effects;
new side effects require another gate summary.

## Pushed-Fix Inline Thread Closure

Use this sequence after addressing inline GitHub review feedback on an
already-pushed or reviewed PR branch:

1. Verify the current review comments before changing code.
2. Implement the fix, or prepare the explanation when no code change is
   required.
3. Run the relevant checks.
4. Commit the response work with a follow-up commit when the branch is already
   pushed or reviewed.
5. Run the Pre-Push Review Gate before push, reply, resolve, or comment side
   effects.
6. Push normally only after the gate approves that push.
7. Re-fetch PR review thread state after the push and before any reply.
8. Confirm GitHub writes are permitted by explicit user approval or the active
   workflow's approved posting gate.
9. Reply in-thread with concise fix or explanation evidence.
10. Re-fetch PR review thread state again after the reply and immediately before
    any resolution. Re-fetch authorship/ownership after the reply and
    immediately before any resolution in that same current state so resolution
    is based on the latest reviewer identity or ownership, not on stale
    pre-reply metadata.
11. Resolve only eligible threads.

Safe-to-resolve criteria:

Permission to reply is not permission to resolve. Posting fix or no-code
evidence after GitHub write approval only authorizes the reply; resolving the
thread requires the separate eligibility gate below.

- GitHub writes are permitted by explicit user approval or the active
  workflow's approved posting gate.
- The latest fetched thread after the reply is still unresolved.
- The current post-reply fetched thread state identifies reviewer identity or
  ownership clearly enough to classify the thread as human-authored,
  bot-authored, or self-authored.
- The thread maps to the same concern that you verified and addressed.
- The pushed branch contains the fix, or the in-thread reply explains why no
  code change is required.
- For outdated unresolved threads, current code and current thread state show
  the underlying concern is stale, invalid, already addressed, or fully
  addressed by pushed or replied evidence.
- The post-reply refetch still maps the thread to the same concern and does not
  show new disagreement, new reviewer feedback, unclear ownership, or a newer
  conflicting state.
- The relevant checks have passed.
- The current actor has permission to resolve the thread.
- Human-authored review threads are eligible only with explicit current-list
  resolve approval, reviewer confirmation that the concern is addressed, or
  explicit repository policy delegation for resolving human-authored review
  threads.
- Bot-authored and self-authored review threads remain eligible for resolution
  under the Safe-to-resolve criteria when every other criterion passes.
- Replying or resolving does not bypass `pr-review`'s user-gated
  posting/resolution workflow when that workflow is the active owner.

Edge dispositions:

- Explanation-only comments get an in-thread reply, then resolution only when
  the reply fully addresses the concern and the post-reply fetched thread is
  still unresolved.
- Human-authored review threads stay unresolved by default after fix or no-code
  replies unless explicit current-list resolve approval, reviewer confirmation,
  or explicit repository policy delegation exists.
- Stale or outdated threads are not resolved merely because they are outdated.
  Re-fetch current thread state, verify the underlying concern first, confirm
  pushed or replied evidence addresses that same concern, re-fetch after the
  reply, and apply the normal Safe-to-resolve criteria.
- Already-resolved threads are left alone. Do not add duplicate replies unless
  new information is needed.
- Unclear ownership stays unresolved and is reported to the user.
- Threads with unclear, partially fixed, or newly conflicting feedback stay
  unresolved and are reported to the user.

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

When feedback IS correct:

```
✅ "Fixed. [Brief description of what changed]"
✅ "Good catch - [specific issue]. Fixed in [location]."
✅ [Just fix it and show in the code]

❌ "You're absolutely right!"
❌ "Great point!"
❌ "Thanks for catching that!"
❌ "Thanks for [anything]"
❌ ANY gratitude expression
```

**Why no thanks:** Actions speak. Just fix it. The code itself shows you heard the feedback.

**If you catch yourself about to write "Thanks":** DELETE IT. State the fix instead.

## Gracefully Correcting Your Pushback

If you pushed back and were wrong:

```
✅ "You were right - I checked [X] and it does [Y]. Implementing now."
✅ "Verified this and you're correct. My initial understanding was wrong because [reason]. Fixing."

❌ Long apology
❌ Defending why you pushed back
❌ Over-explaining
```

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

## Real Examples

**Performative Agreement (Bad):**

```
Reviewer: "Remove legacy code"
❌ "You're absolutely right! Let me remove that..."
```

**Technical Verification (Good):**

```
Reviewer: "Remove legacy code"
✅ "Checking... build target is 10.15+, this API needs 13+. Need legacy for backward compat. Current impl has wrong bundle ID - fix it or drop pre-13 support?"
```

**YAGNI (Good):**

```
Reviewer: "Implement proper metrics tracking with database, date filters, CSV export"
✅ "Grepped codebase - nothing calls this endpoint. Remove it (YAGNI)? Or is there usage I'm missing?"
```

**Unclear Item (Good):**

```
the user: "Fix items 1-6"
You understand 1,2,3,6. Unclear on 4,5.
✅ "Understand 1,2,3,6. Need clarification on 4 and 5 before implementing."
```

## GitHub Thread Replies

When replying to inline review comments on GitHub, reply in the comment thread (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`), not as a top-level PR comment.

Reference the follow-up commit or fix in that reply while preserving the
existing thread context. When a follow-up commit exists, include its commit SHA.
Each reply should state the behavioral fix or no-code disposition, regression
coverage or reason no code change was needed, and a concise verification
summary. Follow `Pushed-Fix Inline Thread Closure` before resolving any thread.
Do not resolve continuity by replacing reviewed history unless the user
explicitly asked for that cleanup or the repository workflow requires rewritten
history.

## The Bottom Line

**External feedback = suggestions to evaluate, not orders to follow.**

Verify. Question. Then implement.

No performative agreement. Technical rigor always.
