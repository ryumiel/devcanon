---
name: issue-batch-routing
description: Provider-neutral batch routing for GitHub and Linear issue work across owner threads, PR gates, approvals, merges, and archival. Use when monitoring or routing a mixed batch of issue-provider records through existing issue, review, CI, PR, and thread workflows.
claude:
  model: "{{model:deep}}"
codex:
  license: MIT
  metadata:
    short-description: Route mixed issue batches across owner threads and PR gates
codex_sidecar:
  interface:
    display_name: Issue Batch Routing
    short_description: Route issue batches without owning implementation side effects
    brand_color: "#2563eb"
---

# Issue Batch Routing

Coordinate a batch of issue-provider records by inspecting live state, routing
work to existing owning workflows, and keeping a compact monitor ledger. This
is a routing workflow only: it may inspect, classify, route, send
evidence-bound approvals, and report, but it must not directly implement code
fixes, must not author review responses, must not rerun CI outside the
delegated workflow, must not merge PRs directly, must not mutate source-issue
status directly, and must not bypass owning workflows.

Use this skill when a parent or controller thread is responsible for keeping
multiple GitHub and Linear issues moving across owner implementation threads,
GitHub PRs, review/CI gates, merge routing, source-issue reporting, and
owner-thread archival.

## Inputs

Accept a batch of normalized issue references. Each item must preserve the
source provider instead of collapsing all records into a GitHub-only issue
number model:

- GitHub issue: `source_provider: github` plus repository and issue number or URL.
- Linear issue: `source_provider: linear` plus identifier or URL.
- Optional known owner-thread, branch, PR, or head facts from a prior monitor
  pass.
- Optional parent approval evidence, scoped as described below.

When the host provides thread-management or automation tools, use those tools to
start, inspect, message, and archive owner threads. When those tools are absent,
report the needed manual routing action and keep the ledger in the
parent/controller thread.

## Batch Ledger

Maintain a compact controller-local ledger. The ledger is monitor state, not a
tracker substitute and not durable source authority. Carry it across monitor
passes and automation resumes when possible.

Allowed values: `source_provider: github | linear`. Additional providers
require an explicit provider boundary.

| Field                                          | Meaning                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source_provider`                              | Provider family for the source issue record.                                                                                                                    |
| `source_issue_identifier`                      | Provider-native issue identity, such as `github:owner/repo#123` or `linear:ENG-123`.                                                                            |
| `source_issue_title`                           | Latest known source issue title.                                                                                                                                |
| `owner_thread_id`                              | Delegated owner thread that owns implementation or source-specific follow-up.                                                                                   |
| `branch_name`                                  | Current owner branch, when known.                                                                                                                               |
| `pr_provider`                                  | PR provider, initially `github`; optional until a PR exists.                                                                                                    |
| `pr_identifier`                                | Provider-native PR identity, optional until a PR exists.                                                                                                        |
| `current_head_sha`                             | Current branch or PR head SHA, optional until known.                                                                                                            |
| `current_gate_kind`                            | Waiting gate such as `issue-priming`, `plan-approval`, `review-response`, `ci-fix`, `merge-conflict`, `merge-routing`, `source-issue-reporting`, or `archival`. |
| `source_issue_state_snapshot_digest`           | Digest of the provider-supported source-issue state snapshot used for the last decision.                                                                        |
| `last_owner_thread_report_digest`              | Digest of the last owner-thread gate report integrated by the parent.                                                                                           |
| `last_routed_issue_priming_route_key`          | Full replay-sensitive issue-priming route key last sent.                                                                                                        |
| `last_routed_review_thread_set_digest`         | Digest for the last unresolved review-thread set routed.                                                                                                        |
| `last_routed_review_response_route_key`        | Full replay-sensitive review-response route key last sent.                                                                                                      |
| `last_routed_ci_run_check_identifier`          | Check run, job, or workflow identifier for the last CI route. Diagnostic only and not authoritative for de-duplication.                                         |
| `last_routed_ci_fix_route_key`                 | Full replay-sensitive CI-fix route key last sent.                                                                                                               |
| `last_routed_merge_conflict_key`               | Merge-conflict route key last sent.                                                                                                                             |
| `last_routed_bot_review_signal_key`            | Review-bot signal route key last handled.                                                                                                                       |
| `last_routed_source_issue_reporting_route_key` | Full replay-sensitive source-issue reporting route key last sent.                                                                                               |
| `last_reported_approval_waiting_key`           | Waiting or report-only approval-gate key recorded when approval evidence is missing, stale, or too broad.                                                       |
| `last_routed_approval_gate_key`                | Approval-gate route key last sent after matching approval evidence is present.                                                                                  |
| `last_routed_merge_routing_key`                | Merge-ready route key last sent to `pr-merge`.                                                                                                                  |
| `last_routed_archival_key`                     | Terminal archival route key last confirmed or sent.                                                                                                             |

`last_routed_ci_run_check_identifier` is diagnostic only and is not
authoritative for de-duplication. Replay-sensitive review-response and CI-fix
deduplication must use the full route-key fields.
`last_routed_approval_gate_key` records only actual approval routes sent after
matching approval evidence is present. Report-only waiting state uses
`last_reported_approval_waiting_key` instead.

Unknown provider states are reported as waiting rather than coerced into GitHub
or Linear terminology.

## Provider And Workflow Boundaries

The batch router coordinates existing workflows; it does not replace them.

- `github-issue-priming` owns GitHub issue fetching, evidence persistence,
  worktree setup, and handoff into `issue-priming-workflow`.
- `linear-issue-priming` owns Linear issue fetching, evidence persistence,
  worktree setup, and handoff into `issue-priming-workflow`.
- `issue-priming-workflow` owns gate, research, brainstorming, planning, implementation, branch review, and Phase 8 PR-creation handoff and preconditions in `--auto` mode.
- `play-review-response` owns review-thread replies and resolution behavior.
- CI-fix routing uses an available provider-specific CI-failure repair skill or
  workflow capability for the PR provider. Availability requires observable
  capability evidence from the current session skill/workflow catalog or an
  explicit parent-provided provider-specific CI-fix workflow name.
  `github:gh-fix-ci` is allowed only when it appears as observed
  session-provided capability evidence; the router must not name it as a
  source-owned required workflow.
- If no provider-specific CI-fix workflow is available for the PR provider,
  failing CI waits with the missing workflow reported. Missing
  provider-specific CI-fix capability fails closed to waiting or manual action;
  do not rerun CI directly and do not fall back to `pr-merge` for repair
  outside the merge path.
- `pr-merge` owns GitHub PR CI polling inside the merge path, final merge execution, and merge-result reporting.
- `branch-review` is used only when the owning workflow requires a local branch-review gate before PR update or merge.
- `play-branch-finish` owns pushing branches, running PR creation side effects, posting caller-supplied assumptions or nits, and preserving the branch and worktree after PR creation when an owning workflow hands off to it.
- `pr-authoring` owns PR title/body policy, title/body composition, and pre-merge title/body validation, but must not create, edit, comment on, or merge PRs.
- source-issue status updates remain provider-specific delegated work, not a generic batch-routing side effect.
- If no provider-specific source-issue reporting workflow is available for the
  source provider and requested source-specific side effect, report waiting or
  manual action with the missing workflow and next safe action; do not mutate
  the source issue directly and do not route to a generic fallback workflow.

Do not directly implement code, resolve conflicts, author PR replies, rerun CI,
merge, update issue status, or archive threads when an owning workflow must do
or confirm that work.

## Monitor Loop

For each open batch item:

1. Refresh source-issue state through the provider surface when available.
2. Classify source-issue state before deciding whether missing-owner issue
   priming is valid.
3. If `owner_thread_id` is missing, route only active source issues to the
   matching source-specific issue-priming entrypoint: GitHub items route to
   `github-issue-priming`, Linear items route to `linear-issue-priming`.
   Convert provider-prefixed `source_issue_identifier` values into
   provider-native entrypoint arguments before invoking source-specific issue
   priming. GitHub conversion must preserve repository identity as a full issue
   URL, or as a bare issue number only when current repository context is
   explicitly proven. Linear conversion must pass an accepted Linear identifier
   such as `ENG-123` or a Linear issue URL. If provider-native conversion
   cannot be proven, report waiting instead of guessing. Before routing
   source-specific issue priming, compute the complete `issue-priming` route key
   from source provider, source issue identifier, source-state digest,
   provider-native entrypoint argument, and missing-owner state. If
   `last_routed_issue_priming_route_key` already matches that complete key and
   `owner_thread_id` is still missing, wait, inspect, or report instead of
   routing another source-specific priming entrypoint. Missing route-key
   evidence fails closed to waiting or manual action. Record
   `last_routed_issue_priming_route_key` before or at handoff. Record the
   created or located owner-thread mapping before continuing the item. Only
   active source issues with missing owner threads route to source-specific
   issue priming. Terminal, duplicate, abandoned, blocked, or unknown no-owner
   states wait or report instead of creating owner work.
4. Refresh owner-thread state and integrate any owner-thread gate report.
5. Refresh PR provider state when a PR exists.
6. Classify the current gate using PR gate precedence, source-issue state, and
   any owner-thread report.
7. Compare the gate's duplicate-route key with the ledger.
8. Route only when the route key is new or the current state invalidates the
   prior route.
9. Record the route, approval, waiting reason, or terminal state in the ledger.
10. Report the monitor pass.

If a required live-state surface is unavailable, report the item as waiting
with the missing surface and the next safe manual command or workflow.

## Duplicate Route Keys

Every route key is scoped to the source provider and source issue identifier,
then narrowed by the current state identifier that makes the route unique.
Never reuse a prior route when the head SHA or relevant state digest changed.

| Route type               | Required key components                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue-priming`          | source provider, source issue identifier, source-issue state digest, provider-native entrypoint argument, missing-owner state.                                                                                                   |
| `review-response`        | source provider, source issue identifier, PR provider, PR identifier, head SHA, unresolved-thread-set digest.                                                                                                                    |
| `ci-fix`                 | source provider, source issue identifier, PR provider, PR identifier, head SHA, check run ID or failing run/check identifier.                                                                                                    |
| `merge-conflict`         | source provider, source issue identifier, PR provider, PR identifier, head SHA, mergeability state, proven base branch or base evidence digest.                                                                                  |
| `source-issue-state`     | source provider, source issue identifier, source-issue state digest.                                                                                                                                                             |
| `source-issue-reporting` | source provider, source issue identifier, owner thread ID, gate kind, owner-thread report digest or source-issue reporting gate digest, requested provider-specific side effect, source-issue state digest, head SHA when known. |
| `approval-gate`          | source provider, source issue identifier, owner thread ID, gate kind, approval-gate digest, source-issue state digest, head SHA when known.                                                                                      |
| `bot-review-signal`      | source provider, source issue identifier, PR provider, PR identifier, head SHA, bot signal digest.                                                                                                                               |
| `merge-routing`          | source provider, source issue identifier, PR provider, PR identifier, head SHA, CI state, mergeability state, branch-protection/review state, bot signal digest when configured.                                                 |
| `archival`               | source provider, source issue identifier, owner thread ID, terminal PR or source-state digest.                                                                                                                                   |

The route key prevents duplicate routes after monitor resumes, context
compaction, repeated polling, or owner-thread re-reporting. A changed key means
the parent must re-evaluate from fresh state rather than treating prior routing
as still current.

Persist the complete route key after routing; partial fields such as only the
unresolved-thread-set digest or only the check identifier are diagnostic hints,
not replay authority.
`issue-priming` route keys suppress duplicate source-specific priming while
`owner_thread_id` remains missing for the same complete key. Missing
source-state digest or provider-native entrypoint argument makes the
issue-priming key incomplete and must fail closed to waiting or manual action.
`source-issue-reporting` is distinct from `source-issue-state` and must not
reuse the source-state monitoring key for provider-specific reporting side
effects.
`approval-gate` route keys include the source-issue state digest so source-state
changes invalidate pre-PR approval routing.
`merge-routing` route keys include CI state so pending, timed-out pending, and
green merge-path states do not suppress each other as duplicates.
Report-only waiting state must not update `last_routed_approval_gate_key`.
Approval-gate duplicate suppression uses `last_routed_approval_gate_key` only
after matching approval evidence has been routed to the owner thread.

## PR Gate Precedence

For PR providers that expose these signals, evaluate gates in this order:

1. Draft PRs wait unless the owner thread reports that draft status is stale.
2. Active blocking review-bot signals block merge.
3. Stale approval signals tied to an older head SHA do not count.
4. Merge conflicts route to the owner thread for the PR's current base branch when a PR exists, or for configured/default base evidence when no PR base is known. Unknown base evidence waits instead of assuming `origin/main`; do not assume `origin/main` unless it is proven as the current or configured base.
5. Unresolved inline review threads route to the review-response workflow unless already routed for the same complete review-response route key, including source provider, source issue identifier, PR provider, PR identifier, head SHA, and unresolved-thread-set digest.
6. Failing CI routes to the CI-fix workflow only when the current failing run/check requires repair work outside PR-merge's normal polling scope. CI-fix routing also requires a provider-specific CI-fix workflow to be available. When that workflow is unavailable, report waiting with the missing workflow.
7. Otherwise merge-ready PRs that require explicit human merge approval wait until matching human merge approval evidence is present.
8. Merge-ready PRs route to `pr-merge` only when all configured gates pass:
   non-draft, CI-green or pending CI, conflict-free, no unresolved review
   threads, no active blocking bot signal, branch protection permits merge or
   is compatible with waiting for CI, any required human merge approval is
   present, and any configured approving bot signal is fresh for the current
   head SHA.

Pending CI that is already inside the merge path belongs to `pr-merge` polling,
not a separate CI-fix route. A provider that does not expose one signal should
record `unknown` for that signal and continue only when the remaining gates
make the route safe; unknown required merge evidence means wait.
Pending CI routes to `pr-merge` for polling only after every non-CI merge gate
is satisfied. Non-CI merge gates include non-draft status, conflict-free or
mergeable state, no unresolved review threads, no active blocking bot signal,
branch protection and review state compatible with waiting for CI, required
human merge approval when policy requires it, and any configured approving bot
signal fresh for the current head SHA. `pr-merge` may merge only after pending
CI becomes green and current merge protections still pass. Failing CI that
requires repair is not pending merge-path polling.

## Source-Issue State

Normalize only the generic state category:

| Generic state      | Routing behavior                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `active`           | Continue monitoring owner thread and PR state.                                                              |
| `blocked`          | Report waiting unless an owner workflow owns the unblocking action.                                         |
| `duplicate`        | Report waiting for provider-specific disposition or delegated source-issue handling.                        |
| `abandoned`        | Route archival only after PR/source terminal checks and no pending work.                                    |
| `closed/completed` | Verify linked PR, or when no PR exists verify source state and owner-thread terminal state before archival. |
| `unknown`          | Report waiting; do not mutate or coerce into provider-specific terminology.                                 |

Provider-specific issue status updates are delegated to the matching
source-specific workflow or explicitly authorized provider workflow.

## Routing Fixtures

Use these concrete fixture outcomes to self-check monitor decisions:

| Fixture state                                                                                                                                                                                                                                                     | Required outcome                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub issue and Linear issue are in the same batch                                                                                                                                                                                                               | Normalize both into provider-tagged batch items; preserve `source_provider: github` and `source_provider: linear`.                                                                                                                |
| Missing `owner_thread_id` for a GitHub item                                                                                                                                                                                                                       | If active, route to `github-issue-priming`, then record the owner-thread mapping before monitoring PR gates.                                                                                                                      |
| Active GitHub source issue with missing `owner_thread_id`                                                                                                                                                                                                         | Route to `github-issue-priming`, then record the owner-thread mapping before monitoring PR gates.                                                                                                                                 |
| Active GitHub source issue `github:owner/repo#123` with missing `owner_thread_id`                                                                                                                                                                                 | Convert to the full issue URL before routing to `github-issue-priming`; use a bare issue number only when current repository context is explicitly proven, and do not pass the prefixed ledger key or `owner/repo#123` shorthand. |
| Active GitHub source issue `github:owner/repo#511` at source-state digest `S1` has missing `owner_thread_id`, provider-native entrypoint argument `https://github.com/owner/repo/issues/511`, and matching `last_routed_issue_priming_route_key` already recorded | Wait, inspect, or report instead of routing another `github-issue-priming` call while `owner_thread_id` remains missing.                                                                                                          |
| Missing source-state digest or provider-native entrypoint argument for an issue-priming route key                                                                                                                                                                 | Report waiting or manual action; do not route source-specific issue priming with an incomplete replay key.                                                                                                                        |
| Missing `owner_thread_id` for a Linear item                                                                                                                                                                                                                       | If active, route to `linear-issue-priming`, then record the owner-thread mapping before monitoring PR gates.                                                                                                                      |
| Active Linear source issue with missing `owner_thread_id`                                                                                                                                                                                                         | Route to `linear-issue-priming`, then record the owner-thread mapping before monitoring PR gates.                                                                                                                                 |
| Active Linear source issue `linear:ENG-123` with missing `owner_thread_id`                                                                                                                                                                                        | Convert to `ENG-123` or a Linear issue URL before routing to `linear-issue-priming`; do not pass the prefixed ledger key.                                                                                                         |
| Closed/completed source issue with missing `owner_thread_id`                                                                                                                                                                                                      | Report waiting or terminal disposition; do not create an owner thread.                                                                                                                                                            |
| Source issue state is unknown to the generic workflow                                                                                                                                                                                                             | Report waiting; do not mutate source issue status and do not coerce provider terminology.                                                                                                                                         |
| PR has active blocking bot signal                                                                                                                                                                                                                                 | Wait for bot review; do not merge.                                                                                                                                                                                                |
| PR has approving bot signal from old head SHA                                                                                                                                                                                                                     | Treat the approval as stale; wait for a fresh review signal for the current head SHA.                                                                                                                                             |
| PR has failing check run `A` at head `H`, source provider `github`, source issue identifier `S`, PR provider `github`, PR `P`, and observable provider-specific GitHub CI-failure repair capability evidence                                                      | Route CI-fix once using that observed capability evidence. Route CI-fix once for check run `A`, keyed by source provider `github`, source issue identifier `S`, PR provider `github`, PR `P`, head SHA `H`, and check run ID `A`. |
| No provider-specific CI-fix workflow is available for failing check run `A`                                                                                                                                                                                       | Report waiting with the missing CI-fix workflow; do not rerun CI directly and do not fall back to `pr-merge` for repair.                                                                                                          |
| The same PR with no observable provider-specific CI-fix capability                                                                                                                                                                                                | Report waiting or manual action with the missing provider-specific CI-fix capability; do not name `github:gh-fix-ci` as a required source workflow.                                                                               |
| PR has unresolved review-thread digest `B` at head `H`, source provider `github`, source issue identifier `S`, PR provider `github`, and PR `P`                                                                                                                   | Route review-response once for the complete key: source provider `github`, source issue identifier `S`, PR provider `github`, PR `P`, head SHA `H`, and unresolved-thread-set digest `B`.                                         |
| PR has unresolved review-thread digest `B` and lacks required human merge approval                                                                                                                                                                                | Route review-response before waiting for human merge approval.                                                                                                                                                                    |
| PR is merge-conflicted at head `C`                                                                                                                                                                                                                                | Route owner thread once by PR, head SHA, and mergeability state, plus proven base branch or base evidence digest.                                                                                                                 |
| PR is merge-conflicted at head `C` against proven base `release/1.x`                                                                                                                                                                                              | Route owner thread once by PR, head SHA, mergeability state, and proven base branch or base evidence digest.                                                                                                                      |
| PR base changes after prior merge-conflict routing                                                                                                                                                                                                                | Treat the changed base evidence as a new `merge-conflict` route key.                                                                                                                                                              |
| Merge-conflicted PR has unknown base evidence                                                                                                                                                                                                                     | Report waiting with missing base evidence; do not assume `origin/main`.                                                                                                                                                           |
| Owner thread reports approval gate `D`                                                                                                                                                                                                                            | Send approval only when parent approval evidence matches the source issue or PR, head SHA/current state, gate kind, route key, and allowed side effect.                                                                           |
| Owner thread reports source-issue reporting gate `E`                                                                                                                                                                                                              | Route only to a provider-specific workflow that owns that source-issue side effect.                                                                                                                                               |
| Owner thread reports source-issue reporting gate `E` at source-state digest `S1` with requested side effect `close-as-completed`                                                                                                                                  | Route source-issue reporting once for the complete `source-issue-reporting` key including source issue, owner thread, gate/report digest, requested side effect, source-state digest `S1`, and head SHA when known.               |
| Owner thread reports source-issue reporting gate `E`, but no provider-specific source-issue reporting workflow is available                                                                                                                                       | Report waiting or manual action with the missing source-issue reporting workflow and next safe action; do not mutate the source issue directly and do not route to a generic fallback workflow.                                   |
| Source issue is verified closed/completed without a PR and owner thread reports terminal state                                                                                                                                                                    | Archive only after verified closed/completed source state, terminal owner-thread state, no active gate, no pending work, no unresolved follow-up, and `last_routed_archival_key` recording.                                       |
| Repository policy requires explicit human merge approval and PR is otherwise merge-ready                                                                                                                                                                          | Wait until matching human merge approval evidence is present.                                                                                                                                                                     |
| PR is otherwise merge-ready but lacks required human merge approval                                                                                                                                                                                               | Wait for matching human merge approval evidence; do not route to `pr-merge`.                                                                                                                                                      |
| PR is non-draft, green, conflict-free, no unresolved threads, required human approval present, and fresh required approval signal present                                                                                                                         | Route `pr-merge` once with `last_routed_merge_routing_key`.                                                                                                                                                                       |
| PR is non-draft, pending CI, conflict-free, no unresolved threads, no active blocking bot signal, branch protection and review state allow waiting for CI, required human approval is present, and fresh required approval signal is present                      | Route `pr-merge` once with `last_routed_merge_routing_key` for CI polling; `pr-merge` may merge only after CI becomes green and protections still pass.                                                                           |
| PR previously routed to `pr-merge` with pending CI later becomes CI-green at the same head SHA                                                                                                                                                                    | Treat the green CI state as a new `merge-routing` route key; do not suppress it with the prior pending-CI merge-routing key.                                                                                                      |
| PR has failing CI that requires repair while non-CI merge gates are otherwise satisfied                                                                                                                                                                           | Route to provider-specific CI-fix when available, or wait/manual action when unavailable; do not treat failing CI as pending `pr-merge` polling.                                                                                  |
| PR merged and owner thread reports terminal state                                                                                                                                                                                                                 | Archive only after terminal PR or source state, no active gate, no pending work, and `last_routed_archival_key` recording.                                                                                                        |

## Owner-Thread Gate Reports

Require owner threads to report back to the parent batch-routing thread when
they reach a gate that needs parent/user approval, source-issue action,
external routing, CI rerun, merge-conflict approval, PR-update approval,
review-response approval, merge approval, or archival confirmation.

Source entrypoints report only pre-handoff fetch, setup, evidence, and handoff
blockers. `issue-priming-workflow` is the producer after source-entrypoint
handoff. If a named delegated workflow does not own a gate family or cannot
produce the route-specific report fields, the router waits or reports manual
action instead of assuming a report exists.
Delegated reports must include the relevant complete route key when known or
applicable. Reports missing the relevant complete route key are incomplete and
fail closed to waiting or manual action.

Each report must include:

- source provider
- source issue identifier
- owner thread ID
- branch
- PR provider and identifier when known
- head SHA when known
- gate kind
- relevant complete route key when known or applicable
- requested parent action
- evidence that the thread is blocked
- source-specific side effects requested
- next safe command or workflow to route

Record a digest of the report before sending approvals or re-routing work. If
the report omits the current head SHA, relevant complete route key, or
route-specific state needed for the gate, ask the owner thread to refetch and
resend rather than approving.

## Parent Approval Evidence

Parent approval is not blanket permission. It applies only when a user or
parent workflow explicitly authorized the same source issue or PR, gate kind,
route key, and allowed side effect. Approval messages must also match the
current owner thread and head SHA when a branch or PR exists.

Contract phrase: same source issue or PR, gate kind, route key, and allowed side effect.

Approval expires when any of these changes:

- PR head changes
- unresolved-thread set changes
- failing CI run/check changes
- mergeability state changes
- source-issue state changes
- owner thread reports a newer gate

When approval evidence is missing, stale, or broader than the requested side
effect, report waiting and request parent/user approval instead of routing the
side effect. Missing, stale, or broad approval evidence may update only
`last_reported_approval_waiting_key`; it must not consume the actual approval
route key that suppresses sending a later matching approval. When matching
approval evidence later arrives, re-evaluate the current owner thread, head,
route key, and allowed side effect before routing approval and updating
`last_routed_approval_gate_key`.

## Safe Approval Templates

Use concise approval messages. Every template must name the source issue or PR,
owner thread, branch, head SHA when known, gate kind, route key, allowed side
effect, and required final report back to the parent. Every template must also
preserve issue scope, require current issue/PR/thread refetch before acting,
preserve branch continuity, forbid force-push, require relevant verification
gates for the delegated workflow, and require final reporting back to the
parent.

### Plan execution approval

Approve only the named owner thread to continue the current plan for the same
source issue, branch, head SHA when known, and route key. Preserve issue scope,
require current issue/PR/thread refetch before acting, preserve branch
continuity, forbid force-push, run the workflow's verification gates, and
report the result back to the parent.

### PR update or review-response closeout

Approve only the named owner thread to run the delegated review-response or PR
update workflow for the same PR, head SHA, and unresolved-thread-set digest.
Preserve issue scope, require current issue/PR/thread refetch before acting,
preserve branch continuity, forbid force-push, require the workflow's
verification gates, and report the updated head and PR state to the parent.

### Merge-conflict resolution

Approve only the named owner thread to merge the PR's current base branch, or
the configured/default base only when no PR base is known, into the branch and
resolve in-scope conflicts for the same PR, head SHA, mergeability state, and
base evidence. Do not assume `origin/main` unless that branch is proven as the
current or configured base. Preserve issue scope, require current
issue/PR/thread refetch before acting, preserve branch continuity, forbid
force-push, require verification gates, and report the new head SHA back to the
parent.

### Narrow CI rerun

Approve a rerun only for the named failing run/check identifier when provider
evidence shows an infrastructure or stale-run condition that does not need code
repair. Preserve issue scope, require current issue/PR/thread refetch before
acting, preserve branch continuity, forbid force-push, require verification of
the rerun evidence through verification gates, and report the rerun result back
to the parent. Code or test failures route to the CI-fix workflow.

### Merge routing

Approve merge routing only for the same PR, head SHA, route key, and required
human approval evidence. Preserve issue scope, require current issue/PR/thread
refetch before acting, preserve branch continuity, forbid force-push, require
`pr-merge` verification gates, and report the merge result back to the parent.
Route to `pr-merge`; do not merge directly from this skill.

### Source-issue reporting

Approve only provider-specific source-issue reporting through the workflow that
owns that provider side effect. If no such provider-specific workflow is
available, report waiting or manual action with the missing workflow and next
safe action instead of approving, mutating directly, or routing to a generic
fallback. Do not mutate source issue status directly from the batch router.
Preserve issue scope, require current issue/PR/thread refetch before acting,
preserve branch continuity, forbid force-push, require the provider workflow's
verification gates, and report the source-issue action back to the parent.

### Archival confirmation

Approve archival only after verified terminal PR or source-issue state,
terminal owner-thread state, no active gate, and no pending user or agent work.
Preserve issue scope, require current issue/PR/thread refetch before acting,
preserve branch continuity, forbid force-push, require terminal-state
verification gates, and report the archived thread back to the parent. Use host
thread-management tools when available.

## Archival Rules

Do not archive an owner thread until all of these are true:

- the PR is verified merged, or the source issue/PR is closed as intentionally
  abandoned, or verified closed/completed source issue state without a PR is
  terminal evidence;
- the owner thread reports terminal owner-thread state;
- the owner thread has no active gate;
- no pending user or agent work remains;
- no unresolved follow-up remains;
- the parent batch-routing thread records the terminal state.

If any terminal-state check is unavailable, report waiting with the missing
evidence. Do not archive based only on a thread's claim that work is complete.

## Monitor Pass Reports

Every monitor pass reports:

- merged or closed items
- routed items
- approval/thread-state actions
- waiting items with reasons
- owner-thread reports received
- source-issue status actions requested
- archived threads
- next check time

Keep reports summary-only. Do not paste raw transcripts, raw logs, raw
validation output, local `.ephemeral` paths, or agent-local decision trails into
shared PR or issue comments.

## Automation And Resume

When the host provides recurring automation or thread-management tools:

- carry known owner-thread mappings;
- discover newly created owner threads;
- update monitor instructions when routing rules change;
- avoid stale routes after resume or context compaction;
- stop or pause monitoring when the batch reaches a terminal state.

On resume, refetch source issue, owner-thread, branch, PR, CI, review-thread,
mergeability, branch-protection, and bot-signal state before sending approvals
or reusing a route. Treat ledger entries as hints until current live state
revalidates their route keys.

## Common Mistakes

- Approving a plausible owner-thread gate without exact approval evidence for
  the same source issue or PR, head SHA/current state, gate kind, route key, and
  side effect.
- Treating GitHub issue numbers as the shared source model and losing Linear
  provider identity.
- Rerunning CI directly when the failure should route to the CI-fix workflow.
- Treating source-issue reporting as generic issue mutation when no
  provider-specific owner workflow exists.
- Waiting for human merge approval before routing current repair gates such as
  merge conflicts, unresolved review threads, or failing CI.
- Routing the same unresolved review threads or failing check more than once
  because the route key omitted the digest or run/check identifier.
- Merging directly instead of routing to `pr-merge`.
- Archiving an owner thread before terminal PR/source state and pending-work
  checks pass.

## Red Flags

Stop and re-route when:

- the batch router is about to edit implementation files;
- approval evidence is broad, stale, or not bound to the route key;
- the PR head SHA changed after approval;
- unknown provider state is being translated into a GitHub or Linear status;
- a route would force-push, replace branch continuity, or bypass an owning
  workflow;
- archival is based on owner-thread text without live terminal-state evidence.
