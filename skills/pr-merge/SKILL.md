---
name: pr-merge
description: PR merge automation with CI polling and in-scope failure investigation. Use when a PR is ready to merge pending CI, or when asked to "merge this PR" or "check CI and merge".
---

# PR Merge

Poll CI status on a pull request, merge when green, investigate and fix failures automatically.

Keep deterministic mechanics out of this always-loaded skill when they become
script-scale. This skill owns orchestration, safety policy, routing, and final
reporting; helper scripts own parseable Git context and cleanup mechanics.

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

Use the `pr-authoring` skill workflow in `validate-fix` mode by reading and
following `skills/pr-authoring/SKILL.md`; apply any repaired title/body it
returns before proceeding. `pr-authoring` is the shared policy owner for PR
title/body validation; this step owns the `gh pr edit` side effect only. Do not
search for or require a callable `pr-authoring` tool.

Gather stable PR data for `pr-authoring` up front with `gh pr view`,
`gh pr diff --name-only`, and PR commit metadata:

- current PR title and body;
- PR diff file list;
- PR commit headlines and bodies;
- any already-read PR policy contents from `**/pr-guideline*.md`,
  `docs/guidelines/pr-guideline.md`, `.github/pull_request_template.md`,
  `CONTRIBUTING.md`, and `WORKFLOW.md` when available; otherwise let
  `pr-authoring` discover and read the policy surfaces.

`pr-authoring` always validates title format, required sections,
anti-patterns, and content-vs-diff. When no project-specific guideline or
template exists, it applies its default fallback contract instead of bypassing
validation.

If `pr-authoring` returns `VALID`, proceed to CI. If it returns a repaired title
and/or body, apply only changed fields with `gh pr edit`. For body repairs, use
`--body-file` so multiline Markdown and shell-sensitive characters are
preserved. Omit flags for unchanged fields.

Do not skip `pr-authoring` because the description "looks close enough." The
shared procedure exists so PR creation and PR merge enforce the same policy.

## Step 2: Poll CI

**Default interval: 3 minutes.** User can override via args (e.g., `5m`, `1m`).
Poll with `gh pr checks <N>`.

Classify output:

- All checks show `pass` → proceed to merge (Step 3)
- Any check shows `pending`/`queued` → wait and re-poll
- Any check shows `fail` → proceed to investigation (Step 4)

**Max poll duration:** 30 minutes. If CI has not completed, report and stop.

## Step 3: Preflighted Merge

Before any merge command, gather PR metadata:

- `headRefName`
- `baseRefName`
- `headRefOid`
- `headRepository.nameWithOwner`
- `baseRepository.nameWithOwner`
- `baseRepository.defaultBranchRef.name`
- verified base repository remote URL
- PR URL

Run `skills/pr-merge/scripts/preflight-worktree-context.sh` with
`PR_HEAD_BRANCH` and `PR_BASE_BRANCH` set from that metadata. Parse its
`KEY=VALUE` output without whitespace splitting.

Preflight output:

- `MODE=safe-direct|cd-primary|remote-only|stop`
- `REASON_CODE=<stable reason>`
- `CURRENT_WORKTREE=<absolute path or empty>`
- `CURRENT_BRANCH=<branch name or empty>`
- `CURRENT_DETACHED=true|false`
- `PRIMARY_WORKTREE=<absolute path or empty>`
- `HEAD_WORKTREE=<absolute path or empty>`
- `BASE_WORKTREE=<absolute path or empty>`
- `REASON=<operator-facing reason>`

Mode routing:

| Mode          | Action                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `safe-direct` | Run `gh pr merge <N> --squash` from the current directory.                                                     |
| `cd-primary`  | Change to `PRIMARY_WORKTREE`, then run `gh pr merge <N> --squash`.                                             |
| `remote-only` | Run `gh pr merge <N> --squash` without local cleanup delegation, verify `MERGED`, then use the cleanup helper. |
| `stop`        | Do not merge. Report `REASON` and one remediation.                                                             |

No mode may use `gh pr merge --delete-branch`. Local worktree cleanup, local
branch deletion, and same-repository remote branch deletion are owned by
`skills/pr-merge/scripts/post-merge-cleanup.sh`.

If a preflighted merge command exits nonzero, immediately check
`gh pr view <N> --json state`. If state is `MERGED`, treat the remote merge as
successful and continue to cleanup. If state is not `MERGED`, report the merge
failure using the existing merge-conflict, missing-review, or branch-protection
classification. Do not retry an execution-context failure unless you changed
directory, changed mode, or collected new evidence that invalidates the
preflight result.

## Step 3b: Post-Merge Cleanup

After every verified remote merge, run
`skills/pr-merge/scripts/post-merge-cleanup.sh`. Supply PR metadata plus the
preflight paths:

- `PR_STATE`
- `PR_HEAD_BRANCH`
- `PR_BASE_BRANCH`
- `PR_HEAD_SHA`
- `PR_HEAD_REPO`
- `PR_BASE_REPO`
- `PR_BASE_DEFAULT_BRANCH`
- `PR_BASE_REMOTE_URL`
- `PRIMARY_WORKTREE`
- `HEAD_WORKTREE`
- `CURRENT_WORKTREE`

Cleanup helper output:

- `WORKTREE_CLEANUP=removed|retained|skipped|failed`
- `WORKTREE_CLEANUP_REASON=<reason>`
- `BASE_UPDATE=updated|skipped|failed`
- `BASE_UPDATE_REASON=<reason>`
- `LOCAL_BRANCH_CLEANUP=deleted|retained|skipped|failed`
- `LOCAL_BRANCH_CLEANUP_REASON=<reason>`
- `REMOTE_BRANCH_CLEANUP=deleted|retained|skipped|failed`
- `REMOTE_BRANCH_CLEANUP_REASON=<reason>`
- `MANUAL_ACTION=<none or concise action>`

The cleanup helper owns deterministic mechanics: canonical path comparison,
safe relocation before worktree removal, dirty/untracked/locked worktree
retention, base checkout and `git pull --ff-only`, local branch deletion gated
by `MERGED` plus local tip equality with `PR_HEAD_SHA`, and same-repository
remote branch deletion gated by non-base/default branch identity and remote tip
equality with `PR_HEAD_SHA`. Remote branch deletion must also verify that local
`origin` resolves to `PR_BASE_REMOTE_URL`; retain the branch for manual cleanup
when the local remote cannot be proven to be the PR base repository.

If the helper reports `retained`, `skipped`, or `failed`, do not hide it behind
the successful remote merge. Report the remaining manual action.

### Final report contract

Every terminal report path must name each field, even when a field is "not
attempted":

- Remote merge: merged, not merged, or unknown, with the PR URL when known.
- Preflight: mode and reason, or helper failure.
- Worktree cleanup: removed, retained, skipped, failed, or not attempted.
- Base checkout/pull: updated, skipped, failed, or not attempted.
- Local branch cleanup: deleted, retained, skipped, failed, or not attempted.
- Remote branch cleanup: deleted, retained, skipped, failed, or not attempted.
- Manual action: none, or the specific action still required.

## Step 4: Investigate and Fix Failures

Track retry count explicitly. **Max 2 failure cycles.** A "failure cycle" is: CI fails → investigation → fix → push. Pending/timeout does NOT count as a failure cycle.

### 4a. Get failure details

Use GitHub Actions evidence from the failing check: list recent runs for the PR
branch, then read failed-step logs for the matching run/job.

### 4b. Dispatch investigation agent

Before dispatching the CI investigation agent, use `subagent-lifecycle` for
the controller-local lifecycle ledger, target lifecycle capability
classification, cleanup gate before spawns, target-honest cleanup outcomes,
and slot-limit recovery. Capture the investigation session's role-specific
state before closing or superseding it: CI run/check identifiers, failing
workflow/job names, reproduced command evidence, in-scope/out-of-scope
classification, fix summary, and any blocker that requires manual resolution.

Dispatch a **dedicated investigation agent**. The investigation agent:

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

| Situation                         | Action                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| No PR number given                | Auto-detect from current branch via `gh pr view`                                                                                                      |
| PR authoring validation           | Use the `pr-authoring` skill workflow through `skills/pr-authoring/SKILL.md` in `validate-fix` mode, then apply repaired title/body with `gh pr edit` |
| Description content stale vs diff | Accept the repaired title/body returned by `pr-authoring`, applying body fixes with `gh pr edit --body-file`                                          |
| No project guideline found        | Use `pr-authoring` default fallback validation; do not bypass PR title/body validation                                                                |
| CI pending                        | Poll every 3 min (configurable)                                                                                                                       |
| CI passes                         | Run worktree preflight → `gh pr merge --squash` → verify `MERGED` → cleanup helper                                                                    |
| Post-merge cleanup                | Run `skills/pr-merge/scripts/post-merge-cleanup.sh`; report worktree, base update, local branch, remote branch, and manual-action outcomes separately |
| CI fails (1st time)               | Investigate → fix if in scope → push → re-poll                                                                                                        |
| CI fails (2nd time)               | Report and stop                                                                                                                                       |
| Out-of-scope failure              | Report and stop immediately                                                                                                                           |
| CI not done after 30 min          | Report and stop                                                                                                                                       |
| Merge conflicts                   | Report to user — requires manual resolution                                                                                                           |
| Missing review approvals          | Report which reviews are missing                                                                                                                      |

## Common Mistakes

### Skipping PR authoring validation

The validation step exists because agents routinely create PRs with generic descriptions that don't follow project conventions. Do not skip it because "the description looks fine." `pr-authoring` checks project-specific surfaces when present and falls back to its default PR contract when no custom guideline or template exists.

### Description content drifted from the diff

`pr-authoring` validates that the description still reflects the diff, not just that the headings are present. When branch-review or PR review adds commits after the description was written, the Changes / Summary sections often go stale — the headings stay valid but the content stops describing what actually merged.

`pr-authoring` repairs the affected sections from the commit log + diff name-only before merging. The repair must still follow the discovered project policy surfaces and the fallback anti-pattern rules — no commit SHAs, no "originally / now" chronology, no file-by-file framing, no verbatim commit-message paste. Group by subsystem and behavior, not by which commit introduced the change.

The check is best-effort and subsystem-level. A description that names every affected subsystem with a behavior bullet passes even if it never names individual files; that is the guideline, not a gap.

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

After merge, always run the cleanup helper and report its outcome. Leftover
worktrees accumulate and cause branch name conflicts on future work, but dirty,
untracked, or locked worktrees must be retained for manual cleanup.

### Deleting main/master branch

Never delete the base/default branch during cleanup. The cleanup helper owns
that guard for local and remote branch deletion; do not bypass it manually.
