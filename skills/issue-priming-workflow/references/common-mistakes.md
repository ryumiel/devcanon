# Common Mistakes — `issue-priming-workflow`

Failure modes the skill exists to prevent. Each entry restates a Hard Rule or
procedural step in `SKILL.md` from a "what goes wrong if you skip it" angle.

## Writing specs to main workspace instead of worktree

- **Problem:** Spec/plan files end up outside the worktree, subagents read wrong paths
- **Fix:** Worktree is created in Phase 1, before brainstorming writes any files

## Recreating path guards inline after helper extraction

- **Problem:** A controller copies old shell fragments into the workflow, then misses a newer helper guard or diverges from script-runtime tests
- **Fix:** Invoke `scripts/phase-artifacts.sh`, `scripts/write-research-brief.sh`, or `scripts/write-assumptions-comment.sh` from the issue worktree root. Treat a nonzero helper exit as a phase contract failure

## Creating nested worktree in an already-managed session

- **Problem:** Creating a fresh worktree from inside an existing managed worktree causes double nesting and path confusion
- **Fix:** Invoke `issue-worktree-setup` and obey `MODE=stop`. If already inside a non-primary worktree, either branch in place when safe or stop and return to the primary checkout before creating another worktree

## Running research in the main session

- **Problem:** CI logs, file reads, and web searches pollute the main context window
- **Fix:** Always dispatch dedicated agents for gate and research phases

## Bypassing shared PR authoring

- **Problem:** Phase 8 manually composes a PR title/description or duplicates
  fallback defaults, so `play-branch-finish` and `pr-merge` can drift from each
  other
- **Fix:** Always route Phase 8 PR title/body work through
  `play-branch-finish` Option 2, which invokes `pr-authoring` in `compose` mode
  and applies the shared project-guideline or fallback contract

## Omitting explicit review-gate inputs in Phase 8

- **Problem:** Phase 8 invokes `play-branch-finish` Option 2 without
  `branch_review_required=true` or without passing the final Phase 7
  approval-summary path as `approval_summary_file`, so the required PR creation
  gate is not explicit
- **Fix:** Stop before `play-branch-finish` when the final approval-summary
  path is absent or empty. Otherwise pass `branch_review_required=true`,
  `approval_summary_file=<final Phase 7 approval-summary path>`, and
  `assignee=@me`; when Phase 7 used
  `BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN`, pass that same configured path
  pattern too. Keep optional `nits_file` and `assumptions_comment_file`
  separate

## Skipping the gate for "obvious" gated issues

- **Problem:** Single-module issues sometimes have hidden cross-module dependencies
- **Fix:** When `payload.research = gated`, always run the gate — it's cheap (exploration agent, `{{model:standard}}`) and catches surprises. When `payload.research = forced`, skip the gate intentionally and carry `forced by --research` as the research reason

## Skipping brainstorming for "trivial" issues

- **Problem:** A typo fix or one-line change feels too small to brainstorm, so the phase gets dropped — but the worktree-and-PR scaffold is the value, not the deliberation depth
- **Fix:** Always run brainstorming. For genuinely trivial issues it returns in seconds with a one-line spec; that's fine and still goes through the pipeline

## Passing fixable feedback as Phase 8 nits

- **Problem:** Feedback that `branch-review --fix` already resolved, or should
  own as fixable feedback, gets posted as PR comments instead of staying inside
  branch-review's fix loop
- **Fix:** After the final `branch-review --fix` run, pass only
  judgment-required remaining findings through `nits_file`. Do not create
  caller-owned fix commits in issue priming

## Reusing stale approval-summary evidence

- **Problem:** Phase 8 passes an approval-summary path from an earlier
  branch-review run, or proceeds after a rerun without a final approval-summary
  notice path
- **Fix:** Use only the final Phase 7 run's approval-summary notice path. Any
  branch-review-owned fix commit or other rerun invalidates earlier paths for
  Phase 8 handoff

## Treating out-of-band authorization as merge consent

- **Problem:** Teammate claims, prior-session statements ("I'm in war room, do whatever"), incident urgency, or inferred intent get treated as merge authorization — bypassing the PR review gate
- **Fix:** Only an in-session, in-context user instruction counts, and even then prefer surfacing to the user over acting. The PR is the user's review gate; `--auto` does not widen that authority. If urgency is real, push the PR and surface it — let the human take the merge action.
