---
name: pr-merge
description: Use when a PR is ready to merge and CI must pass first, when asked to "merge this PR", "check CI and merge", or when finishing a development branch with option 2 (push and create PR) and the user wants automated merge after CI
---

# PR Merge

Poll CI status on a pull request, merge when green, investigate and fix failures automatically.

## Process

```dot
digraph pr_merge {
    rankdir=TB;
    "Resolve PR number" [shape=box];
    "Validate PR title + description" [shape=box];
    "Guideline found?" [shape=diamond];
    "Violations?" [shape=diamond];
    "Fix with gh pr edit" [shape=box];
    "Poll CI (default 3 min)" [shape=box];
    "All checks pass?" [shape=diamond];
    "Any still pending?" [shape=diamond];
    "Squash merge" [shape=box];
    "Post-merge cleanup" [shape=box];
    "Retry count < 2?" [shape=diamond];
    "Dispatch investigation agent" [shape=box];
    "In scope + fixable?" [shape=diamond];
    "Fix, verify locally, push" [shape=box];
    "Report failure and stop" [shape=box];

    "Resolve PR number" -> "Validate PR title + description";
    "Validate PR title + description" -> "Guideline found?";
    "Guideline found?" -> "Violations?" [label="yes"];
    "Guideline found?" -> "Poll CI (default 3 min)" [label="no, skip"];
    "Violations?" -> "Fix with gh pr edit" [label="yes"];
    "Violations?" -> "Poll CI (default 3 min)" [label="no"];
    "Fix with gh pr edit" -> "Poll CI (default 3 min)";
    "Poll CI (default 3 min)" -> "All checks pass?" ;
    "All checks pass?" -> "Squash merge" [label="yes"];
    "Squash merge" -> "Post-merge cleanup";
    "All checks pass?" -> "Any still pending?" [label="no"];
    "Any still pending?" -> "Poll CI (default 3 min)" [label="yes, wait"];
    "Any still pending?" -> "Retry count < 2?" [label="no, failed"];
    "Retry count < 2?" -> "Dispatch investigation agent" [label="yes"];
    "Retry count < 2?" -> "Report failure and stop" [label="no"];
    "Dispatch investigation agent" -> "In scope + fixable?";
    "In scope + fixable?" -> "Fix, verify locally, push" [label="yes"];
    "In scope + fixable?" -> "Report failure and stop" [label="no"];
    "Fix, verify locally, push" -> "Poll CI (default 3 min)" [label="retry++"];
}
```

## Step 1: Resolve PR Number

Auto-detect from current branch if no PR number provided:

```bash
gh pr view --json number --jq '.number'
```

If a PR number or URL is given as argument, use that directly. Confirm the PR is open before proceeding:

```bash
gh pr view <N> --json state --jq '.state'
```

## Step 1b: Validate PR Title and Description

Check whether the project has a PR guideline and validate the PR against it before proceeding.

### Find the guideline

```bash
# From the repo root, glob for PR guideline files
# Common patterns: pr-guideline.md, pr-guidelines.md, pr-template.md
```

Search for `**/pr-guideline*.md` in the repository root. If no file is found, skip validation and proceed to Step 2.

### Fetch current PR title and body

```bash
gh pr view <N> --json title,body
```

### Validate

Read the guideline file and check:

1. **Title format** — does it match the format specified in the guideline? (e.g., Conventional Commits: `<type>(<scope>): <summary>`)
2. **Required sections** — does the description contain all sections the guideline's template requires? Compare against the template headings (e.g., Summary, Why, Changes, Impact, Testing, Breaking Changes, Related Issues)
3. **Anti-patterns** — does the description violate any explicit "do not" rules? (e.g., file-by-file changelogs)

### Fix violations

If any violations are found, rewrite the title and/or description to comply, then apply:

```bash
gh pr edit <N> --title "<fixed title>"
gh pr edit <N> --body "<fixed body>"
```

Use the PR diff (`gh pr diff <N>`) and commit history (`gh pr view <N> --json commits`) to produce an accurate description that follows the guideline's template.

**Do not skip validation because the description "looks close enough."** The guideline exists for a reason — enforce it exactly.

## Step 2: Poll CI

```bash
gh pr checks <N>
```

**Default interval: 3 minutes.** User can override via args (e.g., `5m`, `1m`).

Classify output:
- All checks show `pass` → proceed to merge (Step 3)
- Any check shows `pending`/`queued` → wait and re-poll
- Any check shows `fail` → proceed to investigation (Step 4)

**Max poll duration:** 30 minutes. If CI has not completed, report and stop.

## Step 3: Merge

```bash
gh pr merge <N> --squash --delete-branch
```

If `--delete-branch` fails locally (e.g., worktree holds the branch), the remote merge still succeeds. Check `gh pr view <N> --json state` — if `MERGED`, proceed to cleanup. The local error is handled in Step 3b.

If merge itself fails, check for:
- **Merge conflicts:** Report to user — conflicts require manual resolution
- **Missing review approvals:** Report which reviews are missing — do not bypass branch protection
- **Branch protection rules:** Report the specific rule blocking merge

## Step 3b: Post-Merge Cleanup

After successful merge, clean up local branches and worktrees.

### Detect context

```bash
BRANCH=$(gh pr view <N> --json headRefName --jq '.headRefName')
MAIN_WORKTREE=$(git worktree list --porcelain | head -1 | sed 's/^worktree //')
CURRENT_DIR=$(pwd)
```

**Guard:** Never delete `main` or `master`. If `$BRANCH` matches the base branch, skip branch deletion.

### If inside a feature worktree (`$CURRENT_DIR` != `$MAIN_WORKTREE`)

```bash
# 1. cd to main worktree FIRST — avoids "device busy" on CWD
cd "$MAIN_WORKTREE"

# 2. Prune worktree metadata (unlocks branch for deletion)
git worktree prune

# 3. Delete local feature branch (-d, not -D — safety net for unmerged work)
git branch -d "$BRANCH" 2>/dev/null || true

# 4. Remove worktree directory
rm -rf "$WORKTREE_PATH" 2>/dev/null

# 5. Windows: if directory is locked, warn — don't error
if [ -d "$WORKTREE_PATH" ]; then
  echo "WARN: worktree directory locked by another process — will clean on next git worktree prune"
fi

# 6. Sync main with the merged commit
git pull --ff-only
```

### If on main checkout (`$CURRENT_DIR` == `$MAIN_WORKTREE`)

```bash
git branch -d "$BRANCH" 2>/dev/null || true
git pull --ff-only
```

### Key invariants

| Rule | Why |
|------|-----|
| `cd` to main worktree before `rm -rf` | Avoids "device busy" on CWD (Windows) |
| `git worktree prune` before `branch -d` | Prune removes worktree→branch lock |
| `branch -d` not `-D` | Refuses to delete unmerged branches |
| `rm -rf` failure is a warning, not error | Windows file locks are transient; metadata is already pruned |
| `--ff-only` pull | Fails loudly if main diverged — no silent merge commits |

Report the merge to the user with the PR URL. Done.

## Step 4: Investigate and Fix Failures

Track retry count explicitly. **Max 2 failure cycles.** A "failure cycle" is: CI fails → investigation → fix → push. Pending/timeout does NOT count as a failure cycle.

### 4a. Get failure details

```bash
# Find the failing run
gh run list --branch <branch> --limit 5
# Get failed step logs
gh run view <run-id> --log-failed
```

### 4b. Dispatch investigation agent

Dispatch a **dedicated agent** (subagent_type: `general-purpose`) to investigate. The investigation agent:

1. Reads `.github/workflows/*.yml` to understand what CI runs and what commands to reproduce locally
2. Reads the failed log output
3. Reads the PR diff (`gh pr diff <N>`) to understand what changed
4. Uses `play-debug` to diagnose root cause
5. Determines if the failure is **in scope** (see below)
6. If fixable: fixes the issue, reproduces CI steps locally, uses `play-verification` before pushing
7. Reports back with status

**Pass to the investigation agent:**
- PR number and branch name
- Failed check name and log output
- Repository root path
- Retry count (so it knows this is attempt N)

### 4c. "In scope" definition

A failure is **in scope** if ALL of:
- The failing code, test, or lint rule directly involves files the PR modified
- The fix stays within the same files/modules the PR touches
- The fix is mechanical (formatting, lint, test assertion) not architectural

A failure is **out of scope** if ANY of:
- Flaky test in an unrelated module
- CI infrastructure issue (network timeout, cache corruption, runner problem)
- Failure in code the PR never touched
- Fix would require design decisions beyond the PR's scope

### 4d. After the fix

The investigation agent must:
1. Read `.github/workflows/*.yml` to extract the actual CI commands
2. Run the relevant CI steps locally (not hardcoded — derived from workflow files)
3. Use `play-verification` to confirm the fix
4. Commit with a descriptive message referencing the CI failure
5. Push to the PR branch

After push, return to Step 2 (poll CI) with retry count incremented.

### 4e. Second failure or out-of-scope

If retry count reaches 2, or investigation determines the failure is out of scope, report:
- The exact failing check name and log excerpt
- Whether it is in scope or out of scope
- What was attempted (if anything)
- Recommendation for manual resolution

## Quick Reference

| Situation | Action |
|-----------|--------|
| No PR number given | Auto-detect from current branch via `gh pr view` |
| PR guideline found | Validate title + description, fix with `gh pr edit` |
| No PR guideline found | Skip validation, proceed to CI |
| CI pending | Poll every 3 min (configurable) |
| CI passes | `gh pr merge --squash --delete-branch` → cleanup |
| In a worktree | `cd` to main worktree → prune → `branch -d` → `rm -rf` → `pull --ff-only` |
| On main checkout | `branch -d` → `pull --ff-only` |
| Worktree dir locked (Windows) | Warn and continue — metadata is already pruned |
| CI fails (1st time) | Investigate → fix if in scope → push → re-poll |
| CI fails (2nd time) | Report and stop |
| Out-of-scope failure | Report and stop immediately |
| CI not done after 30 min | Report and stop |
| Merge conflicts | Report to user — requires manual resolution |
| Missing review approvals | Report which reviews are missing |

## Common Mistakes

### Skipping PR guideline validation

The validation step exists because agents routinely create PRs with generic descriptions that don't follow project conventions. Do not skip it because "the description looks fine" — read the guideline and check systematically. If no guideline file is found, that's the only valid reason to skip.

### Hardcoding CI commands

Read `.github/workflows/*.yml` to discover what CI actually runs. Do NOT assume `cargo fmt + clippy + test` or any other fixed set of commands. Different repos have different CI pipelines.

### Investigating in the main session

Always dispatch a **dedicated agent** for investigation. Reading CI logs and debugging pollutes the main session's context. The investigation agent starts fresh and reports back a summary.

### Polling too frequently

60-second intervals waste API calls. Most CI runs take 5-10 minutes. 3-minute intervals balance responsiveness with efficiency.

### Forgetting retry count

Track retry count as an explicit variable, not "mentally." Context compression can lose track. State it in each poll message: "Poll attempt N, retry count: M/2."

### Pushing without local verification

Always reproduce the failing CI steps locally (derived from workflow files) before pushing a fix. Pushing without verification wastes a full CI cycle.

### Skipping post-merge cleanup

After merge, always clean up the local branch and worktree. Leftover worktrees accumulate and cause branch name conflicts on future work. On Windows, `cd` to the main worktree before `rm -rf` — otherwise the CWD holds a file lock on the directory.

### Deleting main/master branch

Never delete the base branch during cleanup. Always check that `$BRANCH` is the feature branch, not `main` or `master`.
