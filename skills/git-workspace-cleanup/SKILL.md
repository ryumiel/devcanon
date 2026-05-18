---
name: git-workspace-cleanup
description: Deterministic cleanup of Git worktrees and local branches back to the remote default branch. Use when the user asks to clean all linked worktrees, return the primary checkout to the remote default branch, or delete local branches after work is complete.
codex_sidecar:
  interface:
    display_name: "Git Workspace Cleanup"
    short_description: "Clean worktrees and local branches"
    icon_small: "./assets/git-small.svg"
    brand_color: "#7c3aed"
---

# Git Workspace Cleanup

Use this skill to return a Git repository to one primary checkout on the
remote default branch.

The bundled script owns the destructive operations. Do not hand-roll the
cleanup sequence.

## Required Workflow

1. Run the script in dry-run mode first.
2. Report the dry-run summary to the user.
3. If `STATUS=blocked`, stop and ask whether to force only the blocked category
   that can be forced.
4. Run `--execute` only after explicit user approval, using the same target repo
   shown in dry-run output.
5. Never use force flags unless the user approved them after seeing dry-run
   output.

```bash
SKILL_DIR="<path-to-git-workspace-cleanup-skill>"
TARGET_REPO="<path-to-target-repo-or-worktree>"
bash "$SKILL_DIR/scripts/git-workspace-cleanup.sh" --repo "$TARGET_REPO" --dry-run
```

Approved execution:

```bash
bash "$SKILL_DIR/scripts/git-workspace-cleanup.sh" --repo "$TARGET_REPO" --execute
```

If local-only commits exist on non-default branches and the user approves
discarding them:

```bash
bash "$SKILL_DIR/scripts/git-workspace-cleanup.sh" --repo "$TARGET_REPO" --execute --force-branches
```

If dirty linked worktrees exist and the user separately approves discarding
their uncommitted files:

```bash
bash "$SKILL_DIR/scripts/git-workspace-cleanup.sh" --repo "$TARGET_REPO" --execute --force-dirty-worktrees
```

Use both force flags only when both categories were shown in dry-run output and
the user explicitly approved both.

## Safety Policy

The script blocks by default on:

- uncommitted or untracked files in any worktree
- locked linked worktrees
- commits on non-default local branches that are not reachable from
  `origin/<default-branch>` and are not squash-merged into
  `origin/<default-branch>`
- commits on the local default branch that are ahead of
  `origin/<default-branch>`

Only two blocker classes are forceable:

- `--force-branches` permits deleting non-default branches with local-only
  commits.
- `--force-dirty-worktrees` permits removing dirty linked worktrees,
  including uncommitted or untracked files in those linked worktrees.

Dirty primary worktrees, locked linked worktrees, and default-branch local-only
commits are never forced. Ask the user to commit, stash, unlock, or otherwise
resolve those manually before running cleanup.

Ignored files alone are not blockers. Git can remove linked worktrees that
contain only ignored files without `--force`, and ignored files in the primary
worktree do not represent source changes that cleanup must stop on.

Dry-run refreshes `origin/*` with `git fetch origin --prune` before reporting.
Execute intentionally does not fetch again, so the destructive run uses the
remote-tracking state that the user approved from the dry-run report.

Squash-merged branch detection is part of this helper. A non-default branch is
treated as merged when its branch tree can be represented as a single commit on
top of its merge base and `git cherry origin/<default-branch>` reports that
patch as already present. Such branches can require `git branch -D` because
their tips are not ancestors of the default branch, but they do not require
`--force-branches`.

## Output Contract

The script writes `KEY=VALUE` lines.

Important keys:

- `MODE=dry-run|execute`
- `STATUS=ok|blocked`
- `DEFAULT_BRANCH=<branch>`
- `PRIMARY_WORKTREE=<absolute path>`
- `REMOVABLE_WORKTREES=<count>`
- `PRUNABLE_WORKTREES=<count>`
- `LOCKED_WORKTREES=<count>`
- `DIRTY_WORKTREES=<count>`
- `LOCAL_BRANCHES_TO_DELETE=<count>`
- `LOCAL_BRANCHES_WITH_UNIQUE_COMMITS=<count>`
- `DEFAULT_BRANCH_AHEAD_COMMITS=<count>`

Detail lines repeat as needed:

- `REMOVABLE_WORKTREE=<path>`
- `PRUNABLE_WORKTREE=<path>`
- `LOCKED_WORKTREE=<path>|REASON=<reason>`
- `DIRTY_WORKTREE=<path>|FILES=<count>|PRIMARY=true|false`
- `DELETE_BRANCH=<branch>`
- `MERGED_BRANCH=<branch>|REASON=ancestor|squash`
- `UNIQUE_BRANCH=<branch>|COMMITS=<count>`

Dry-run exits zero even when blocked so callers can inspect and report the
blockers. Execute exits non-zero when blocked.
