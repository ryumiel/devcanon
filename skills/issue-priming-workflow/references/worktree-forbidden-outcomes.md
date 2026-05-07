# Worktree forbidden outcomes — `issue-priming-workflow` Phase 1

When `issue-worktree-setup` returns `MODE=stop`, the workflow halts. The
forbidden outcome is **producing a worktree (or any equivalent checkout) for
this issue from inside the current session** — by any mechanism. That includes,
but is not limited to: `cd`-ing to the primary checkout; passing
`--git-dir`/`--work-tree`/`-C` to git or to the helper; setting `GIT_DIR` or
`GIT_WORK_TREE` env vars; calling `git worktree add` directly without the
helper; cloning the repo elsewhere on disk to escape the gate; or any other
path that reaches the same end state. If you find yourself reasoning about
_which_ mechanism is "really" forbidden, you are rationalizing — the outcome
is the rule. The operator returns to primary explicitly and re-runs the skill
from there.
