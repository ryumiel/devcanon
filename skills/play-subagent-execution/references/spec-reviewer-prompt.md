# Spec Compliance Reviewer Prompt Template

Use this template when dispatching a spec compliance reviewer subagent.

**Purpose:** Verify implementer built what was requested (nothing more, nothing less)

**Promotion classification:** Workflow-local prompt template paired with the source agent at [`agents/spec-compliance-reviewer.yaml`](../../../agents/spec-compliance-reviewer.yaml) — referenced from `skills/play-subagent-execution/SKILL.md` for dispatch-time placeholder substitution. The role identity is already promoted; per [`docs/guidelines/agent-authoring-guide.md`](../../../docs/guidelines/agent-authoring-guide.md) §4, workflow-local prompt assembly stays as a template.

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
    - Consume any content snapshot the controller may hold (snapshots are for the controller's bookkeeping only; you must read the file from disk to stay independent of the implementer's framing)

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
    dispatched per task. For single-task plans, equivalent coverage lives
    in `play-review`'s Docs agent under the same name (invoked by both
    `branch-review` and `pr-review`).

    Apply the check only to `*.md` files the implementer's report identifies
    as changed for this task — you are already reading those files to verify
    spec compliance, so this adds no extra scope. Do not scan unchanged
    `*.md` files; cross-document checks are out of scope here and live in
    `play-review`'s Docs agent (Sub-check B), invoked by both `branch-review` and `pr-review`.

    - Does prose backtick an identifier that the adjacent code block does not use?
      Example: prose says `git worktree prune` but the code block runs
      `git worktree remove`.
    - Does a code block use an identifier the surrounding prose names differently?
    - Treat any mismatch as a `Blocking` finding in category `Documentation` —
      narration that contradicts the code it narrates is almost always a bug
      or staleness.
    - The code block is canonical: recommend rewriting prose to match. If the
      code block itself looks wrong, flag it as a separate finding for human
      judgment rather than auto-aligning.

    Illustrative scenario (within-document identifier drift):
    a single Markdown file's prose narrates "the procedure runs
    `git worktree prune`" while the adjacent fenced code block invokes
    `git worktree remove <path>`. The code was updated across review rounds;
    the prose was not. The reviewer should report:
    ❌ Issues found: <file>:<line> — prose names `git worktree prune` but the
    adjacent code block invokes `git worktree remove`. Code is canonical;
    rewrite prose to match. Blocking | Documentation.

    **Substitution audit (when changes include external CLI/API/system invocations):**

    Scope: this check runs only on multi-task plans, where this template is
    dispatched per task. For single-task plans, equivalent coverage lives
    in `play-review`'s Correctness agent under the same name. The broader
    documented-behavior verification (for new or modified invocations that
    aren't substitutions) is out of scope here and lives in `play-review`
    only (invoked by both `branch-review` and `pr-review`) — see that skill
    for Sub-check 2.

    Apply the check whenever the task's diff replaces an external CLI /
    REST / system primitive invocation token with a sibling at the same
    call site (e.g., `git branch -d` → `git branch -D`,
    `fs.writeFileSync` → `fs.writeFile`, `gh pr review --body ...` →
    `gh api .../reviews --input ...`). Detect substitutions by inspecting
    the task's diff hunks directly — do not rely on the implementer's
    report to flag the substitution, since they may have omitted it.
    "External invocation" means a CLI flag/subcommand swap, a method swap
    on an external SDK, a system primitive swap, or a flag-set
    rearrangement on the same call. Do not apply to internal-code
    refactors, literal renames, or mechanical formatting changes.

    Procedure:

    1. Identify the replaced primitive (old → new), citing the file:line
       in the task's diff.
    2. Enumerate every safety property, precondition check, or rejection
       mode the OLD primitive enforced. Pull from the tool's documented
       behavior (`--help` / official docs) when the property isn't obvious
       from the name alone.
    3. For each property, classify what the NEW code does: PRESERVES,
       GUARDS (equivalent runtime check), or SILENTLY DROPS (no equivalent
       guard, no waiver).
    4. A SILENTLY DROPS finding is `Blocking`, category `Safety`, unless the
       diff or surrounding spec explicitly waives the property with a
       rationale.

    Illustrative scenario (substitution audit):
    a task replaces `git branch -d` with `git branch -D` to silence a
    spurious squash-merge warning. The OLD primitive's safety properties
    include rejecting deletion when the branch has unmerged commits
    relative to its upstream and HEAD. The NEW primitive (`-D`) accepts
    unconditionally, and the diff adds no surrounding guard. The reviewer
    should report:
    ❌ Issues found: <file>:<line> — `git branch -D` silently drops the
    unmerged-commit rejection that `-d` enforced. Add a tip-equality check
    (local tip == PR head OID) before `-D` runs, or restore `-d` and
    handle its warning. Blocking | Safety.

    **Verify by reading code, not by trusting report.**

    Report:
    - ✅ Spec compliant (if everything matches after code inspection)
    - ❌ Issues found: [list specifically what's missing or extra, with file:line references]
```
