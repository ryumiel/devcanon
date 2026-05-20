# Common Mistakes — `issue-priming-workflow`

Failure modes the skill exists to prevent. Each entry restates a Hard Rule or
procedural step in `SKILL.md` from a "what goes wrong if you skip it" angle.

## Writing specs to main workspace instead of worktree

- **Problem:** Spec/plan files end up outside the worktree, subagents read wrong paths
- **Fix:** Worktree is created in Phase 1, before brainstorming writes any files

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

## Skipping the gate for "obvious" gated issues

- **Problem:** Single-module issues sometimes have hidden cross-module dependencies
- **Fix:** When `payload.research = gated`, always run the gate — it's cheap (exploration agent, `{{model:standard}}`) and catches surprises. When `payload.research = forced`, skip the gate intentionally and carry `forced by --research` as the research reason

## Skipping brainstorming for "trivial" issues

- **Problem:** A typo fix or one-line change feels too small to brainstorm, so the phase gets dropped — but the worktree-and-PR scaffold is the value, not the deliberation depth
- **Fix:** Always run brainstorming. For genuinely trivial issues it returns in seconds with a one-line spec; that's fine and still goes through the pipeline

## Skipping nit classification in `--auto` mode

- **Problem:** Mechanical nits — typos, truncated sentences, broken cross-references — get posted as PR comments instead of fixed in the worktree, leaking workflow gaps that `--auto` exists to eliminate
- **Fix:** After `branch-review --fix` returns, classify remaining nits and auto-fix mechanical ones before invoking Phase 8. See Phase 7 prose for the taxonomy

## Treating out-of-band authorization as merge consent

- **Problem:** Teammate claims, prior-session statements ("I'm in war room, do whatever"), incident urgency, or inferred intent get treated as merge authorization — bypassing the PR review gate
- **Fix:** Only an in-session, in-context user instruction counts, and even then prefer surfacing to the user over acting. The PR is the user's review gate; `--auto` does not widen that authority. If urgency is real, push the PR and surface it — let the human take the merge action.
