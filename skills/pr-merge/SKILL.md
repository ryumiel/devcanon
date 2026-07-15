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

Use the available sibling `pr-authoring` skill workflow in `validate-fix` mode
by reading and following that skill bundle's `SKILL.md`; apply any repaired
title/body it returns before proceeding. `pr-authoring` is the shared policy
owner for PR title/body validation; this step owns the
`{{tool:github-cli}} pr edit` side effect only. Do not search for or require a
callable `pr-authoring` tool.

Gather stable PR data for `pr-authoring` up front with
`{{tool:github-cli}} pr view`, `{{tool:github-cli}} pr diff --name-only`, and
PR commit metadata:

- current PR title and body;
- PR diff file list;
- PR commit headlines and bodies;
- any already-read PR policy contents from `**/pr-guideline*.md`,
  `docs/guidelines/pr-guideline.md`, `.github/pull_request_template.md`,
  `CONTRIBUTING.md`, and `{{file:workflow-guide}}` when available; otherwise
  let `pr-authoring` discover and read the policy surfaces.

`pr-authoring` always validates title format, required sections,
anti-patterns, and content-vs-diff. When no project-specific guideline or
template exists, it applies its default fallback contract instead of bypassing
validation.

If `pr-authoring` returns `VALID`, proceed to CI. If it returns a repaired title
and/or body, apply only changed fields with `{{tool:github-cli}} pr edit`. For
body repairs, use `--body-file` so multiline Markdown and shell-sensitive
characters are preserved. Omit flags for unchanged fields.

Do not skip `pr-authoring` because the description "looks close enough." The
shared procedure exists so PR creation and PR merge enforce the same policy.

## Step 2: Poll CI

**Default interval: 3 minutes.** User can override via args (e.g., `5m`, `1m`).
Poll with `{{tool:github-cli}} pr checks <N>`.

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

| Mode          | Action                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `safe-direct` | Run `{{tool:github-cli}} pr merge <N> --squash` from the current directory.                                                     |
| `cd-primary`  | Change to `PRIMARY_WORKTREE`, then run `{{tool:github-cli}} pr merge <N> --squash`.                                             |
| `remote-only` | Run `{{tool:github-cli}} pr merge <N> --squash` without local cleanup delegation, verify `MERGED`, then use the cleanup helper. |
| `stop`        | Do not merge. Report `REASON` and one remediation.                                                                              |

No mode may use `{{tool:github-cli}} pr merge --delete-branch`. Local worktree
cleanup, local branch deletion, and same-repository remote branch deletion are
owned by `skills/pr-merge/scripts/post-merge-cleanup.sh`.

If a preflighted merge command exits nonzero, immediately check
`{{tool:github-cli}} pr view <N> --json state`. If state is `MERGED`, treat the
remote merge as successful and continue to cleanup. If state is not `MERGED`,
report the merge failure using the existing merge-conflict, missing-review, or
branch-protection classification. Do not retry an execution-context failure
unless you changed directory, changed mode, or collected new evidence that
invalidates the preflight result.

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

## Issue Batch Routing Reports

When invoked by `issue-batch-routing`, this workflow produces
issue-batch-routing reports for merge approval waits, CI polling timeout or
failure, in-scope CI investigation result, merge-conflict blockers,
missing-review blockers, missing-protection blockers, merge result, post-merge
cleanup outcome, and terminal merge-path reports.

Every report should include the source provider, source issue identifier, PR
provider and identifier, head SHA, gate kind, relevant complete route key,
base branch evidence when known, mergeability state when known, branch
protection or review state when relevant, CI run/check identifiers when
relevant, merge/CI/protection evidence, blocking evidence, requested parent
action, cleanup outcome when attempted, manual action when needed, and next
safe command or workflow.

Reports missing source provider, source issue identifier, gate kind, or the
relevant complete route key are incomplete for router reconciliation; the router
should wait or request manual action instead of inferring the source item from
PR-only identity.

This workflow does not perform pre-merge review-response work or source-issue
status mutation. Those cases become parent/manual-action reports or routes to
the workflow that owns the specific gate.

## Step 4: Investigate and Fix Failures

Track retry count explicitly. **Max 2 failure cycles.** A "failure cycle" is: CI fails → investigation → fix → push. Pending/timeout does NOT count as a failure cycle.

### 4a. Get failure details

Use GitHub Actions evidence from the failing check: list recent runs for the PR
branch, then read failed-step logs for the matching run/job. Record the current
PR head SHA with the failing check and use it as the diagnosis/fix anchor.

### 4b. Dispatch investigation agent

Before dispatching the CI investigation agent, use `subagent-lifecycle` for
the controller-local lifecycle ledger, target lifecycle capability
classification, cleanup gate before spawns, target-honest cleanup outcomes,
and slot-limit recovery. Capture the investigation session's role-specific
state before closing or superseding it: CI run/check identifiers, failing
workflow/job names, reproduced command evidence, in-scope/out-of-scope
classification, fix-route recommendation, and any blocker that requires manual
resolution.

Dispatch one response-only `investigator`, balanced/high and source-immutable,
with zero handoffs. This bounded B3 diagnosis route has external authority
`none`; do not substitute another role, capability, effort, mutation default,
or ambient agent.

Resolve `PR_MERGE_DIR` to the installed `pr-merge` bundle directory, then set
`SOURCE_IMMUTABILITY_HELPER="$PR_MERGE_DIR/scripts/source-immutability.sh"`.
Keep this lifecycle exact:

1. capture before spawn and retain the returned baseline path in the
   controller;
2. spawn the investigator and capture only its raw terminal response and
   status;
3. verify before semantic validation or consumption;
4. after successful verification, validate and retain the evidence-only
   response in controller memory;
5. cleanup the exact retained baseline; and
6. after successful cleanup, re-read the PR head SHA and classify the fix route
   from the retained diagnosis only when the head still matches.

Capture failure prevents the spawn. Every post-capture terminal path attempts
exact cleanup, including unavailable dispatch, child failure, malformed
response, semantic rejection, and verification rejection. An ordinary
unavailable, failed, malformed, or verification-rejected diagnosis keeps the
retry count unchanged; after safe cleanup, perform no fix, push, or merge and
report the failed check with a manual-resolution recommendation. Detected
source mutation or cleanup failure is guard-integrity terminal: preserve the
visible source state, stop, and do not repair or hide the mutation. If the PR
head SHA changes, invalidate the retained diagnosis, keep the retry count
unchanged, perform no fix/push/merge, and return to Step 2 for the replacement
head.

The investigator reads `.github/workflows/*.yml`, the failed logs, and the PR
diff (`{{tool:github-cli}} pr diff <N>`); uses `play-debug`; and may run bounded
reproduction commands. It must not edit, stage, commit, push, merge, or write a
handoff. Its response contains evidence only:

- anchored PR head SHA and CI run/check identifiers;
- failing workflow/job names and the relevant log excerpt;
- reproduced command evidence and root-cause diagnosis;
- in-scope or out-of-scope classification with reasons;
- for an in-scope failure, `exact mechanical` or `judgment-bearing`, the
  authorized fix paths, and workflow-derived verification commands; and
- any blocker requiring manual resolution.

**Pass to the investigation agent:**

- PR number, branch name, and anchored head SHA
- Failed check name and log output
- Repository root path
- Retry count (so it knows this is attempt N)

### 4c. "In scope" definition

A failure is **in scope** if ALL of:

- The failing code, test, or lint rule directly involves files the PR modified
- The fix stays within the same files/modules the PR touches
- The fix remains within the PR's existing intent and needs no architecture or
  product decision beyond that scope

A failure is **out of scope** if ANY of:

- Flaky test in an unrelated module
- CI infrastructure issue (network timeout, cache corruption, runner problem)
- Failure in code the PR never touched
- Fix would require design decisions beyond the PR's scope

For an in-scope diagnosis, classify the proposed change as either an exact
mechanical fix with no implementation judgment or a judgment-bearing fix that
still remains within the PR's existing intent. This classification selects the
mutable route; it does not broaden scope.

### 4d. Dispatch the validated fix

Only after the diagnosis response passes verification and validation, its
baseline cleanup succeeds, and its anchored head remains current, dispatch
exactly one mutable fix child:

- Route an exact mechanical fix to one source-mutable `executor`,
  efficient/medium.
- Route a judgment-bearing fix to one source-mutable `implementer`,
  balanced/high.

These are the only two fix routes; do not add or infer a fourth D17 path. Every
semantic child has external authority `none`. Name the exact authorized durable
workspace paths and the validated diagnosis in the mutable child's prompt. The
mutable child may edit only the authorized paths, run verification, and commit;
it must not push, merge, edit the PR, or perform any other provider mutation.
The controller/root alone owns push and merge.

The mutable child must:

1. Read `.github/workflows/*.yml` to extract the actual CI commands
2. Run the relevant CI steps locally (not hardcoded — derived from workflow files)
3. Use `play-verification` to confirm the fix
4. Commit with a descriptive message referencing the CI failure

Review the returned summary, authorized-path diff, verification evidence, and
commit before any external mutation. Re-read the PR head SHA immediately before
push. A changed head invalidates the diagnosis and fix: keep the retry count
unchanged, do not push, merge, rebase, or hide the local state, and report the
stale-head blocker. An unavailable, failed, malformed, out-of-scope, or
unverified mutable-child result also keeps the retry count unchanged; do not
push or merge, preserve visible source state, and report the failed check plus
the manual-resolution recommendation.

The controller/root runs the relevant validation again, then pushes the
validated committed fix to the PR branch. After the controller/root pushes the
validated commit, increment the retry count and return to Step 2.

### 4e. Second failure or out-of-scope

If retry count reaches 2, or investigation determines the failure is out of scope, report:

- The exact failing check name and log excerpt
- Whether it is in scope or out of scope
- What was attempted (if anything)
- Recommendation for manual resolution

## Quick Reference

| Situation                         | Action                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| No PR number given                | Auto-detect from current branch via `{{tool:github-cli}} pr view`                                                                                     |
| PR authoring validation           | Use the available sibling `pr-authoring` skill workflow in `validate-fix` mode, then apply repaired title/body with `{{tool:github-cli}} pr edit`     |
| Description content stale vs diff | Accept the repaired title/body returned by `pr-authoring`, applying body fixes with `{{tool:github-cli}} pr edit --body-file`                         |
| No project guideline found        | Use `pr-authoring` default fallback validation; do not bypass PR title/body validation                                                                |
| CI pending                        | Poll every 3 min (configurable)                                                                                                                       |
| CI passes                         | Run worktree preflight → `{{tool:github-cli}} pr merge --squash` → verify `MERGED` → cleanup helper                                                   |
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
