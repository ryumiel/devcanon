---
name: play-verification
description: Explicit-invocation workflow for evidence-backed completion checks before claiming work is complete, fixed, or passing. Use only when the user explicitly invokes `play-verification` or an owning workflow explicitly requires completion verification.
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# Verification Before Completion

## Invocation Policy

Do not select this workflow from ordinary discussion, review-shaped text, possible behavior-change wording, or implementation-adjacent language; the explicit-invocation rule itself is owned by this skill's frontmatter (`description` and `codex_sidecar` policy).

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

The rule applies to its spirit as well as its letter: a paraphrased or implied claim is still a claim.

## The Rule

```
No completion claims without fresh verification evidence.
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
Before claiming any status or expressing satisfaction:

1. Identify: what command proves this claim?
2. Run: execute the full command (fresh, complete)
3. Read: full output, check exit code, count failures
4. Verify: does the output confirm the claim?
   - If no: state the actual status with evidence
   - If yes: state the claim with evidence
5. Only then: make the claim

A claim made with any step skipped is unverified.
```

## Reporting Verification Evidence

Passing verification is reported as command/result/gap:

- **Command:** the fresh full command that was run
- **Result:** exit status and the decisive pass/fail count or summary
- **Gap:** remaining unverified scope, warning, or blocker; use "none" only
  after reading the full output

Do not paste passing logs just to prove they were read. Detailed logs or
excerpts are included only when needed to diagnose a failure, warning, or
ambiguous result. This reporting rule does not weaken the gate: still run the
full command, read the full output, check the exit code, and count failures
before making any claim.

## Common Failures

| Claim                 | Requires                        | Not Sufficient                 |
| --------------------- | ------------------------------- | ------------------------------ |
| Tests pass            | Test command output: 0 failures | Previous run, "should pass"    |
| Linter clean          | Linter output: 0 errors         | Partial check, extrapolation   |
| Build succeeds        | Build command: exit 0           | Linter passing, logs look good |
| Bug fixed             | Test original symptom: passes   | Code changed, assumed fixed    |
| Regression test works | Red-green cycle verified        | Test passes once               |
| Agent completed       | VCS diff shows changes          | Agent reports "success"        |
| Requirements met      | Line-by-line checklist          | Tests passing                  |

## Rationalization Prevention

| Excuse                                    | Reality                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| "Should work now", "probably", "seems to" | RUN the verification                                                            |
| "I'm confident"                           | Confidence ≠ evidence                                                           |
| "Just this once"                          | No exceptions                                                                   |
| "Linter passed"                           | Linter ≠ compiler                                                               |
| "Agent said success"                      | Verify independently                                                            |
| "I'm tired"                               | Exhaustion ≠ excuse                                                             |
| "Partial check is enough"                 | Partial proves nothing                                                          |
| "Different words so rule doesn't apply"   | Spirit over letter                                                              |
| "Great!", "Perfect!", "Done!"             | Satisfaction before verification is still a claim                               |
| "I'll verify after I commit/push/PR"      | Verify before the commit, push, or PR                                           |
| "It is only wording"                      | ANY wording implying success without having run verification is a success claim |

## Key Patterns

**Tests:**

```
✅ [Run test command] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Regression tests (TDD Red-Green):**

```
✅ Write → Run (pass) → Revert fix → Run (MUST FAIL) → Restore → Run (pass)
❌ "I've written a regression test" (without red-green verification)
```

**Build:**

```
✅ [Run build] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**

```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete"
```

**Agent delegation:**

```
✅ Agent reports success → Check VCS diff → Verify changes → Report actual state
❌ Trust agent report
```

## Why This Matters

From 24 failure memories:

- the user said "I don't believe you" - trust broken
- Undefined functions shipped - would crash
- Missing requirements shipped - incomplete features
- Time wasted on false completion → redirect → rework
- Violates: "Honesty is a core value. If you lie, you'll be replaced."

## When To Apply

**ALWAYS before:**

- ANY variation of success/completion claims
- ANY expression of satisfaction
- ANY positive statement about work state
- Committing, PR creation, task completion
- Moving to next task
- Delegating to agents

**Rule applies to:**

- Exact phrases
- Paraphrases and synonyms
- Implications of success
- ANY communication suggesting completion/correctness

## The Bottom Line

**No shortcuts for verification.**

Run the command. Read the output. Then claim the result.

This rule has no exceptions.
