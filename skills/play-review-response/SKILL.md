---
name: play-review-response
description: Verification-first response to code review feedback. Use when receiving code review feedback, especially if feedback seems unclear or technically questionable.
---

# Code Review Reception

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

## Execution Mode Selection

After thread-aware intake and verification, classify each verified concern
before changing code. Thread-aware intake means reading the current review
thread/comment state, mapping feedback to the same concern, and separating
executable feedback from stale, already-addressed, explanation-only, or unclear
feedback before selecting a mode.

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
handoff supplies that gate. This skill owns thread-aware intake, verification,
execution-mode selection, no-code dispositions, follow-up commit continuity,
GitHub thread replies/refetching, and resolution eligibility.

Direct/manual review-response plans do not get an automatic whole-diff review
after the executor's final code-quality reviewer. Run `branch-review` before
opening or updating a PR when planned review-response work needs whole-diff
coverage.

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
Action: Write `.ephemeral/<date>-review-response-plan.md`, then invoke
`play-subagent-execution` with `Plan: <path>`.
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

## Pushed-Fix Inline Thread Closure

Use this sequence after addressing inline GitHub review feedback on an
already-pushed or reviewed PR branch:

1. Verify the current review comments before changing code.
2. Implement the fix, or prepare the explanation when no code change is
   required.
3. Run the relevant checks.
4. Commit the response work with a follow-up commit when the branch is already
   pushed or reviewed.
5. Push normally.
6. Re-fetch PR review thread state after the push and before any reply.
7. Confirm GitHub writes are permitted by explicit user approval or the active
   workflow's approved posting gate.
8. Reply in-thread with concise fix or explanation evidence.
9. Re-fetch PR review thread state again after the reply and immediately before
   any resolution.
10. Resolve only eligible threads.

Safe-to-resolve criteria:

- GitHub writes are permitted by explicit user approval or the active
  workflow's approved posting gate.
- The latest fetched thread after the reply is still unresolved.
- The thread maps to the same concern that you verified and addressed.
- The pushed branch contains the fix, or the in-thread reply explains why no
  code change is required.
- The relevant checks have passed.
- The current actor has permission to resolve the thread.
- Replying or resolving does not bypass `pr-review`'s user-gated
  posting/resolution workflow when that workflow is the active owner.

Edge dispositions:

- Explanation-only comments get an in-thread reply, then resolution only when
  the reply fully addresses the concern and the post-reply fetched thread is
  still unresolved.
- Stale or outdated threads are not resolved merely because they are outdated.
  Re-fetch current thread state and verify the underlying concern first.
- Already-resolved threads are left alone. Do not add duplicate replies unless
  new information is needed.
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
existing thread context. Follow `Pushed-Fix Inline Thread Closure` before
resolving any thread. Do not resolve continuity by replacing reviewed history
unless the user explicitly asked for that cleanup or the repository workflow
requires rewritten history.

## The Bottom Line

**External feedback = suggestions to evaluate, not orders to follow.**

Verify. Question. Then implement.

No performative agreement. Technical rigor always.
