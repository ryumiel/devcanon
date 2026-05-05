---
name: play-review
description: Internal multi-agent review pipeline shared by `branch-review` and `pr-review`. Use when invoked by one of those wrappers. Do not use directly — call `branch-review` for local diffs or `pr-review` for GitHub PRs.
claude:
  model: "{{model:deep}}"
  user-invocable: false
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# play-review

Multi-agent code review pipeline. Internal — invoked by `branch-review`
(local diffs) or `pr-review` (GitHub PRs). The wrapper gathers inputs,
sets up the working directory, and disposes of findings; this skill runs
the review.

## Inputs

The wrapper composes these into the prose that hands off to this skill.
A missing required input means the wrapper has a bug — stop and report
rather than proceeding with defaults.

**Required:**

| Input                | Type                                       | Used by                                                   |
| -------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `working_directory`  | absolute path                              | Phase 1 guideline glob; Phase 3 agent dispatch            |
| `base_ref`           | string (e.g., `main`, `origin/main`)       | Doc-impact summary; agent briefings                       |
| `active_diff_range`  | git diff spec                              | Phase 3 agents review this                                |
| `full_pr_diff_range` | git diff spec (= `active` for branch case) | Doc-impact summary always uses this                       |
| `head_sha`           | string                                     | Briefings; reused by `pr-review` for `gh api` `commit_id` |
| `mode`               | `"present"` \| `"fix"` \| `"github-post"`  | Activates conditional sub-checks                          |
| `language_hints`     | derived file-extension set                 | Dynamic agent triggers                                    |

**Optional (follow-up / `pr-review` only):**

| Input                | Used by                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `prior_threads`      | array of `{file, line, body, author, status}` — critic carry-forward; "still open" detection |
| `last_reviewed_sha`  | string — incremental vs full-scope semantics                                                 |
| `is_followup_narrow` | bool — Architecture / Documentation agent override                                           |

## Output

A markdown document with two sections:

1. `## Findings` — one entry per finding, with stable headers:

   ````markdown
   ### Finding N

   - **Path:** <repo-relative file path>
   - **Line:** <integer or `start_line-line`>
   - **Severity:** Blocking | Nit
   - **Category:** Logic | Safety | Architecture | Tests | Maintainability | Documentation | Contracts
   - **Critic:** VALID | INVALID | DOWNGRADE | (skipped — nit)
   - **Anchor:** natural | missing-file | out-of-diff

   ```<lang>
   // <file>:<start>-<end>
   <evidence code, 3-7 lines>
   ```

   <Why this is a problem>

   **Recommendation:** <concrete suggestion>
   ````

2. `## Carry-forward` (follow-up only) — prior threads still open after re-verification, in the same shape.

The wrapper consumes this output and disposes per its surface (present
in conversation, auto-fix mechanical findings, post inline comments to
GitHub, etc.). This skill never touches GitHub, never auto-fixes, never
creates or removes worktrees.
