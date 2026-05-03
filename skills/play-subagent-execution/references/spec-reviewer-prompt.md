# Spec Compliance Reviewer Prompt Template

Use this template when dispatching a spec compliance reviewer subagent.

**Purpose:** Verify implementer built what was requested (nothing more, nothing less)

```
Task tool (general-purpose):
  description: "Review spec compliance for Task N"
  prompt: |
    You are reviewing whether an implementation matches its specification.

    ## What Was Requested

    [FULL TEXT of task requirements]

    ## What Implementer Claims They Built

    [From implementer's report]

    ## CRITICAL: Do Not Trust the Report

    The implementer finished suspiciously quickly. Their report may be incomplete,
    inaccurate, or optimistic. You MUST verify everything independently.

    **DO NOT:**
    - Take their word for what they implemented
    - Trust their claims about completeness
    - Accept their interpretation of requirements

    **DO:**
    - Read the actual code they wrote
    - Compare actual implementation to requirements line by line
    - Check for missing pieces they claimed to implement
    - Look for extra features they didn't mention

    ## Your Job

    Read the implementation code and verify:

    **Missing requirements:**
    - Did they implement everything that was requested?
    - Are there requirements they skipped or missed?
    - Did they claim something works but didn't actually implement it?

    **Extra/unneeded work:**
    - Did they build things that weren't requested?
    - Did they over-engineer or add unnecessary features?
    - Did they add "nice to haves" that weren't in spec?

    **Misunderstandings:**
    - Did they interpret requirements differently than intended?
    - Did they solve the wrong problem?
    - Did they implement the right feature but wrong way?

    **Within-document identifier drift (when changes include `*.md` files):**

    Scope: this check runs only on multi-task plans, where this template is
    dispatched per task (per ADR-0007). For single-task plans, equivalent
    coverage lives in `branch-review`'s Docs agent under the same name.

    Apply the check only to `*.md` files the implementer's report identifies
    as changed for this task — you are already reading those files to verify
    spec compliance, so this adds no extra scope. Do not scan unchanged
    `*.md` files; cross-document checks are out of scope here and live in
    `branch-review`'s Docs agent (Sub-check B).

    - Does prose backtick an identifier that the adjacent code block does not use?
      Example: prose says `git worktree prune` but the code block runs
      `git worktree remove`.
    - Does a code block use an identifier the surrounding prose names differently?
    - Treat any mismatch as a P1 finding — narration that contradicts the code it
      narrates is almost always a bug or staleness.
    - The code block is canonical: recommend rewriting prose to match. If the
      code block itself looks wrong, flag it as a separate finding for human
      judgment rather than auto-aligning.

    Illustrative scenario (within-document identifier drift, pattern from PR #106):
    a single Markdown file's prose narrates "the procedure runs
    `git worktree prune`" while the adjacent fenced code block invokes
    `git worktree remove <path>`. The code was updated across review rounds;
    the prose was not. The reviewer should report:
    ❌ Issues found: <file>:<line> — prose names `git worktree prune` but the
    adjacent code block invokes `git worktree remove`. Code is canonical;
    rewrite prose to match. P1.

    **Verify by reading code, not by trusting report.**

    Report:
    - ✅ Spec compliant (if everything matches after code inspection)
    - ❌ Issues found: [list specifically what's missing or extra, with file:line references]
```
