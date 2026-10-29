---
name: git-workspace-cleanup
description: Deterministic cleanup of selected local worktrees and branches or an entire Git workspace. Use when the user asks to clean all linked worktrees, return the primary checkout to the remote default branch, or delete local branches after work is complete.
---

# Git Workspace Cleanup

Helper invocation, inputs, outputs, and refusal mechanics are owned by the adjacent [git-workspace-cleanup usage](references/git-workspace-cleanup-usage.md).

When invoking this Bash helper from Windows PowerShell, use the environment-
specific path conversion route in that usage reference before the required
dry-run.

Use this skill for explicit local-target cleanup or to return a Git repository
to one primary checkout on the remote default branch.

The bundled script owns ordinary repository-wide destructive operations. Do not
hand-roll the cleanup sequence. Before selecting it, read the usage reference's
[mechanism selection](references/git-workspace-cleanup-usage.md#mechanism-selection-and-verification).
Selected PR cleanup remains with `pr-merge`; completed-owner local cleanup uses
this helper's explicit-target mode. Host-managed worktrees require a supported
host lifecycle and attachment/ownership reconciliation path.

## Selected local cleanup

Read the usage reference's **Selected local cleanup** contract. Preserve required
evidence and establish disposal authority for the exact path, local branch and
expected commit. For completed batch owners, transfer cleanup to a controller
outside the target, archive the terminal owner, reconcile the supported host
result, then dry-run and execute selected cleanup. Honor explicit user ordering;
never archive an owner with assigned work or wake it solely to remove its checkout.
Host refusal or pending/unknown effects hold only dependent Git cleanup.
Pass those exact resources as retained selections and continue independent
eligible cleanup; never stop unrelated work merely because one checkout is held.

Completed-session cleanup includes `.ephemeral/` under
[EVID-004-CLEANUP](../../docs/specs/afds-workflow-routing.md#evid-004-cleanup-session-artifact-lifetime).
Missing review records or diagnostic provenance alone do not require preservation.
Establish completion and resolve active consumers and uncertain effects; retain
explicitly requested resources with a concrete reason. This is included in existing
cleanup approval, not another per-artifact discard question. Designate additional
disposable directories explicitly; `.gitignore` alone is not a disposal policy.
For detached worktrees or unused branches, use the helper's explicit detached or
branch-only mode rather than inventing a branch/worktree pairing. For completed
reviews, use the review adapter's completed-session route after these checks.

Present the dry-run result and reuse compatible standing cleanup authority.
No broad force flags are allowed. The runtime's clean-submodule force is guarded,
not permission to discard nested work. Report worktree and branch statuses
separately; use the same inputs for an eligible partial retry. Missing target
inputs must never route to broad cleanup.

## Repository-wide workflow

1. Establish current-session/host protection, explicit retention requests,
   active consumers and unresolved effects. Pass each held checkout using
   `--retain-worktree` and each independently held branch using `--retain-branch`.
   Record each reason and release condition in existing workflow context. Host
   ownership is not inferred by this Git helper. Run dry-run with those same
   selections and any explicitly designated disposable directories.
2. Report the dry-run summary to the user.
3. If `STATUS=blocked`, classify each blocker. Ask only for a missing discard
   decision in a forceable category; report a concrete remedy for protected
   categories.
4. Run `--execute` under explicit user approval covering the same repository-wide
   scope shown in dry-run output. Reuse compatible standing approval after
   presenting the current plan; ask again only for changed scope, newly identified
   discard categories, or an applicable explicit host approval requirement.
5. Never use force flags unless the user approved the corresponding discard
   category after seeing its dry-run output. A new snapshot mechanism or a host
   refusal is not discard authorization.

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

## Repository-wide safety policy

The script retains each affected resource by default on:

- uncommitted or untracked files in any worktree
- locked linked worktrees
- commits on non-default local branches that are not reachable from
  `origin/<default-branch>` and are not squash-merged into
  `origin/<default-branch>`
- commits on the local default branch that are ahead of
  `origin/<default-branch>`
- nested repository blockers reported as `NESTED_REPOSITORY` in the usage
  reference; these are not bypassed by either force flag

Only two blocker classes are forceable:

- `--force-branches` permits deleting non-default branches with local-only
  commits.
- `--force-dirty-worktrees` permits removing dirty linked worktrees,
  including uncommitted or untracked files in those linked worktrees.

Dirty primary worktrees, locked linked worktrees, and default-branch local-only
commits are never forced. Retain them with their reason and continue independent
eligible cleanup. Their owner must resolve the particular condition before a
later attempt. Retained worktrees also retain branches they use.

Ignored content in `.ephemeral/` is disposable for authorized completed-session
cleanup. Use `--disposable-dir <relative-directory>` for other explicitly
identified disposable directories. Arbitrary ignored files retain that checkout,
even with force flags. Ignored primary files alone do not stop independent work.
Detached local-only commits are retained; branch force does not discard them.

Dry-run refreshes `origin/*` with `git fetch origin --prune` before reporting.
Execute intentionally does not fetch again, so the destructive run uses the
remote-tracking state that the user approved from the dry-run report.

Squash-merged branch detection is part of this helper. A non-default branch is
treated as merged when its branch tree can be represented as a single commit on
top of its merge base and `git cherry origin/<default-branch>` reports that
patch as already present. Such branches can require `git branch -D` because
their tips are not ancestors of the default branch, but they do not require
`--force-branches`.

Clean initialized submodules are inspected recursively. The helper uses Git's
single `--force` only to remove a verified clean checkout with private submodule
administration and no nested local-only work; this is not a broad dirty-work
override. It never deinitializes submodules or changes shared registration.
Dirty submodules (including ignored artifacts), local-only nested work, shared/external administration and
embedded repositories require preservation or an owner-supported remedy first.

## Repository-wide output contract

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
- `NESTED_REPOSITORY=<path>|KIND=submodule|embedded|REASON=<classification>|GIT_DIR=<path>|COMMON_DIR=<path>`

Dry-run exits zero even when blocked so callers can inspect and report the
blockers. Execute exits non-zero when blocked.

Counts describe inspected candidates and eligibility, not completed effects.
`CANDIDATE_WORKTREES` includes retained targets; `REMOVABLE_WORKTREES` counts only
eligible ones. `WORKTREE_RESULT` and `BRANCH_RESULT` report actual resource status
and reason; `BASE_UPDATE` reports the independent default-checkout update.
Execution continues after resource-local refusal or failure and exits nonzero
when any requested resource remains retained or failed. Verify each outcome;
neither plan counts nor an accepted host archive request prove cleanup.
Repository-wide cleanup leaves unavailable registrations for explicit resolution;
it does not prune unrelated registrations as a side effect.
