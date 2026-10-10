---
name: issue-batch-routing
description: Routes provider-tagged issue work across owner tasks, PR gates, approvals, merges, and archival. Use only when the user explicitly invokes issue-batch-routing or an owning workflow explicitly hands off routing work. Ordinary batch-management requests belong to issue-batch-coordination.
requires:
  - github-issue-priming
  - issue-batch-coordination
  - issue-worktree-setup
  - linear-issue-priming
  - play-review-response
  - pr-merge
claude:
  model: "{{model:frontier}}"
codex:
  license: MIT
  metadata:
    short-description: Route mixed issue batches across owner threads and PR gates
codex_sidecar:
  policy:
    allow_implicit_invocation: false
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

## Invocation boundary

Run only on explicit user invocation or an explicit owning-workflow handoff,
including one from `issue-batch-coordination`. Ordinary batch-management intent
selects the companion; do not activate this router implicitly or invoke the
companion back. Direct bounded router use remains available. Invocation itself
grants no effect authority. For a coordinated route, consume the coordinator's
contextual work intent and accepted scope without reasking for generic
orchestration permission; the coordinator owns that interpretation. For a
direct route, interpret the user's bounded request and surrounding decisions
under the same inspect/start-work distinction below. Preserve still-current
prior authority, and validate each requested effect against the current facts
and host restrictions. For accepted concrete execution, select `--auto` for
eligible new provider-owner invocations unless interactive work was selected;
never silently change an already-bound owner's mode. Status-only routing has no
creation, messaging, scheduling or priming effects. Before authorization,
preference or capability inquiries, consume the coordinator's selected effects
or, for direct routing, select them from intent, independent owner/monitor
overrides, bound modes/settings and retained explicit stops. Execution selects
the separate-watchdog/timer default under the companion's watchdog procedure
unless a no-monitor override or retained stop disables it. Disabled
monitoring excludes watcher creation, monitor-specific messaging authorization,
capability/model/cadence inquiries and activation; independently covered owners
continue in their selected mode and generic resume never supersedes a stop.
Consume the initial authorization check and recipient-visible evidence only for
selected creation, messaging directions and timer actions; missing host
permission holds only its affected effect. A direct route applies the same
bounded check. An explicitly requested existing active-timer stop retains only
its necessary host control/permission checks and observed shutdown; it grants no
replacement authority. Preserve unresolved state and resources, and escalate the
concrete conflicting authority or missing evidence before the affected action.
Startup also establishes separately scoped publication, conditional merge and
scoped cleanup authority from actual human decisions; the execution default
itself grants none of these effects or source-status mutation. Select action
prerequisites by publication branch: initial PR publication retains
implementation, validation and independent Phase 7 branch review; a covered
existing-PR correction uses classification, local validation and the concrete
pre-push gate before its plain update, then independent published-current-head
follow-up before readiness or merge, as defined below. Never require that
published-head follow-up before the push that makes the head available.

Codex disables implicit invocation through its sidecar policy. Claude retains
workflow calls and direct user invocation: its manual-only setting would block
owning-workflow calls, so this description and boundary provide invocation
guidance there, not equivalent host enforcement.

## Inputs

Accept a batch of normalized issue references. Each item must preserve the
source provider instead of collapsing all records into a GitHub-only issue
number model:

- GitHub issue: `source_provider: github` plus repository and issue number or URL.
- Linear issue: `source_provider: linear` plus identifier or URL.
- Optional known owner-thread, branch, PR, or head facts from a prior monitor
  pass.
- Current inspect or start-work intent and concrete accepted scope for an
  effectful route, including applicable prior human decisions.
- Optional parent approval evidence, scoped as described below.

For read-only owner discovery, the router needs independently proven expected
repository and canonical provider-prefixed issue identity plus supported
evidence of an exact compatible depth-0 owner and scoped host identity when
task IDs are host-scoped. These identity facts may map an owner for ordinary
monitoring, but they do not manufacture a route key or authorize priming. For
an effectful missing-owner dispatch, the router instead needs one complete
dispatch tuple before it can create or reuse owner work: provider, canonical
issue identifier, current active-eligibility and source-state digest, proven
provider-native entrypoint argument, complete existing issue-priming route key,
work intent, and the applicable effect authority. A known confirmed owner,
branch, PR, or checkout is optional supporting evidence. A supported host
confirmation or discovery may also provide an optional checkout candidate
paired with that exact owner and host; it is unvalidated continuity context, not
repository or identity proof, and is never inferred from the ambient cwd.
Missing or unknown required evidence stops only its boundary for one concrete
decision or manual action; it must not be reconstructed from an owner report, a
provisional host identifier, or a child task.

## Owner dispatch boundary

A separate top-level owner task is an independently managed depth-0 root for
the shared provider and priming workflow, with its own checkout, reports, and
continuation. It is not a label for a nested controller child.

Keep inspect/monitor-only work separate from start-work. Inspect/monitor-only
may refresh, discover, reconcile pending creation, or report; it must not create
an owner task or begin provider priming. Start-work requires contextual
execution intent, concrete accepted scope, and applicable routine effect
authority, subject to the current host's actual task capability and
restrictions. A concrete request to advance the accepted batch supplies
routine authority for eligible owner creation, provisioning through
`issue-worktree-setup`, targeted owner instructions, and dependency-driven
continuation within that scope. Preserve compatible existing authority and
confirmed owner continuity without requesting a generic reapproval. Validate
the complete dispatch tuple, repository and owner/host identity, active source
state, and pending-creation recovery before creation or initial release. Empty
or conflicting intent or scope stops affected effects before dispatch; ask only
for the missing decision. A host denial reports the specific unavailable action
without a workaround. Continue independently eligible siblings. Start-work
authority does not grant publication, merge, recurring scheduling, destructive
cleanup, scope expansion, or a downstream owner gate; evaluate each separately
using its applicable current or previously supplied decision. Keep existing
source-status and archival rules.

When the host provides thread-management or automation tools, use those tools to
start, inspect, message, and archive owner threads. When those tools are absent,
report the needed manual routing action and keep the ledger in the
parent/controller thread.

## Batch Ledger

Maintain one compact current-state ledger with evidence references under
ROUTE-007-STATE. It has no history section, append-only log, execution diary or
coordinator archive. It is monitor state, not a tracker substitute or durable
source authority. Carry the current state across resumes; derive summaries
from its items instead of maintaining independent narrative state.

Before direct or coordinated creation, establish or recover this existing
ledger and the complete dispatch tuple. A fresh accepted route may initialize
current facts from supported evidence. A resumed historical attempt with
unavailable ledger or replay evidence waits or reports; never reconstruct prior
keys, digests, approvals, or bindings.

Allowed values: `source_provider: github | linear`. Additional providers
require an explicit provider boundary.

| Field                                          | Meaning                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `source_provider`                              | Provider family for the source issue record.                                                                                                                       |
| `source_issue_identifier`                      | Provider-native issue identity, such as `github:owner/repo#123` or `linear:ENG-123`.                                                                               |
| `source_issue_title`                           | Latest known source issue title.                                                                                                                                   |
| `owner_thread_id`                              | Delegated owner thread that owns implementation or source-specific follow-up.                                                                                      |
| `branch_name`                                  | Current owner branch, when known.                                                                                                                                  |
| `pr_provider`                                  | PR provider, initially `github`; optional until a PR exists.                                                                                                       |
| `pr_identifier`                                | Provider-native PR identity, optional until a PR exists.                                                                                                           |
| `current_head_sha`                             | Current branch or PR head SHA, optional until known.                                                                                                               |
| `current_gate_kind`                            | Waiting gate such as `issue-priming`, `plan-approval`, `review-response`, `ci-fix`, `merge-conflict`, `merge-routing`, `source-issue-reporting`, or `archival`.    |
| `current_approved_owner_route_identity`        | Current approved owner-route identity required to validate progress receipts.                                                                                      |
| `current_reviewed_plan_handoff_provenance`     | Selected preparation provenance (`reviewed-plan` or `execution-note`); legacy field name retained for receipt compatibility.                                       |
| `source_issue_state_snapshot_digest`           | Digest of the provider-supported source-issue state snapshot used for the last decision.                                                                           |
| `last_owner_thread_report_digest`              | Digest of the last owner-thread gate report integrated by the parent.                                                                                              |
| `consumed_progress_receipt_sequences_by_route` | Bounded map of still-needed owner-route guards to highest accepted positive sequence; retire only under Operational retention, separately from approval/gate keys. |
| `last_routed_issue_priming_route_key`          | Full replay-sensitive issue-priming route key last sent.                                                                                                           |
| `last_routed_review_thread_set_digest`         | Digest for the last unresolved review-thread set routed.                                                                                                           |
| `last_routed_review_response_route_key`        | Full replay-sensitive review-response route key last sent.                                                                                                         |
| `last_routed_ci_run_check_identifier`          | Check run, job, or workflow identifier for the last CI route. Diagnostic only and not authoritative for de-duplication.                                            |
| `last_routed_ci_fix_route_key`                 | Full replay-sensitive CI-fix route key last sent.                                                                                                                  |
| `last_routed_merge_conflict_key`               | Merge-conflict route key last sent.                                                                                                                                |
| `last_routed_bot_review_signal_key`            | Review-bot signal route key last handled.                                                                                                                          |
| `last_routed_source_issue_reporting_route_key` | Full replay-sensitive source-issue reporting route key last sent.                                                                                                  |
| `last_reported_approval_waiting_key`           | Waiting or report-only approval-gate key recorded when approval evidence is missing, stale, or too broad.                                                          |
| `last_routed_approval_gate_key`                | Approval-gate route key last sent after matching approval evidence is present.                                                                                     |
| `last_routed_merge_routing_key`                | Merge-ready route key last sent to `pr-merge`.                                                                                                                     |
| `last_routed_archival_key`                     | Terminal archival route key last confirmed or sent.                                                                                                                |

`last_routed_ci_run_check_identifier` is diagnostic, never authoritative for
de-duplication; replay-sensitive review-response and CI-fix use full keys.
`last_routed_approval_gate_key` records sent routes with matching approval;
report-only waiting uses `last_reported_approval_waiting_key`.

Before host creation, retain its original complete route key as controller
recovery evidence. A pending result adds its provisional host identifier only
for supported confirmation or discovery. Neither is an `owner_thread_id`,
route-key replacement, schema field, or durable notice. A source refresh,
including one with a changed digest, must reconcile that pending creation before
another dispatch and must not erase it or treat the provisional identifier as a
confirmed owner mapping.

## Operational retention

Review artifact lifecycle policy remains at its
[review lifecycle owner](../pr-review/references/review-lease-lifecycle-contract.md#target-retention-and-supersession-contract).

This section applies ROUTE-007-STATE to the existing fields above; it introduces
no schema or replacement persistence mechanism. Each retained value must serve
a current decision or one of these operational purposes:

- **Authority:** keep accepted scope and applicable authority references plus
  the current exact action/owner binding. Replace superseded approvals and
  head-dependent readiness; retain an old authority identity/reference only
  when required to reconcile an unresolved effect. A changed head does not
  revoke compatible standing scope. There is no approval history.
- **Pending effects:** keep the original complete route key, owner/host and
  repository binding, provisional creation identifier if any, and supported
  delivery/result reference until the operation is reconciled. Unknown results
  remain pending and prohibit blind retry. Once resolved, replace the pending
  marker with the verified outcome and any still-needed duplicate guard.
- **Route and receipt guards:** keep complete keys and each route's highest
  accepted sequence and acknowledged next sequence while delayed delivery,
  resumed reconciliation or route eligibility still requires them. A binding
  change alone never removes another route's guard. Retire an entry only after
  all its effects/obligations resolve and that route cannot become eligible
  again under retained authority. A retired or unknown route cannot initialize
  authority, reset its sequence or continue from a delayed receipt: hold it for
  authoritative reconciliation. No transcript reconstruction is allowed.
- **Notices and monitors:** retain the event/head/recipient and actual delivery
  outcome needed for duplicate suppression, unresolved delivery, current
  schedule/controller binding and applicable explicit stop. Replace superseded
  observations after delivery reconciliation; remove resolved guards only when
  delayed input cannot repeat notice or recreate a stopped monitor. An explicit
  stop survives until later scheduling authority supersedes it.

Remove resolved waiting keys and completed queued actions after accepting their
verified replacement; never retain them as current work. Replace superseded
model/install observations without treating unknown outcomes as successful.
Terminal items keep identity, disposition/evidence links, remaining accepted
obligations and only still-needed operational markers. Review findings,
diagnostics and recovery records remain at their existing owners; the ledger
links to them and neither copies nor deletes them. Resume compacts legacy
content by these same rules after authoritative reconciliation, then derives
summaries from the items. Missing evidence blocks the affected action.

### Current-state scenarios

These hypothetical cases exercise operational retention; they do not add fields
or replace source/provider verification.

| Input                                                                                                        | Required current result                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verified merge at H; old summary says review wait; merge remains queued; cleanup pending                     | Remove obsolete wait/queue, derive merged summary, retain cleanup obligation and verified merge reference. Do not repeat merge.                              |
| Authorized H2 replaces H; standing scope remains; H2 gates unavailable                                       | Replace head/readiness and exact binding; retain compatible standing scope. H evidence cannot pass H2 gates; unavailable evidence holds the affected action. |
| A receipt 1 consumed, B receipt 33 consumed, delayed A receipt 1; A can still recur                          | Retain A and B high-water guards. Reject duplicate A without continuation or approval-key update.                                                            |
| Owner completion conflicts with provider unresolved review                                                   | Keep conflict/evidence references explicit and refresh affected authority before action; do not claim completion.                                            |
| Legacy resume has stale summary/history, resolved blocker, uncertain creation K and review-owner diagnostics | Remove positively superseded claims/history, derive summary, retain K and provisional result until reconciled; preserve diagnostics at their owner.          |
| Completed C has no obligations and cannot regain eligibility; delayed C receipt arrives after retirement     | Remove unnecessary narrative/receipt state; retain compact terminal evidence. Delayed C cannot initialize authority or restart sequence numbering.           |
| Notice delivery is unknown when the provider event becomes superseded                                        | Keep unresolved delivery identity/outcome until reconciled; do not infer successful delivery, repeat blindly or drop required deduplication state.           |

The coordinator's [ledger reconciliation regression cases](../issue-batch-coordination/references/reporting-scenarios.md#ledger-reconciliation-regression-cases)
provide equivalent source/Claude/Codex inputs and held-out outcomes for verified
cleanup with stale cross-item claims, unresolved cleanup with a mismatched
preserved copy, and delayed reports/receipts. These cases distinguish current
evidence custody from immutable original bindings and check unchanged repeats
for duplicate effects or history entries. The recorded baseline is bounded
agent-driven simulation, not live-host proof or new routing authority.

## Controller-Held Approved-Route Facts

For receipt validation, the router holds controller approval, validated initial
owner-handoff, and resumed-route facts: provider, issue, owner ID, approved
route identity, selected preparation kind/path/digest and its provenance,
refreshed source-state digest, and current head when a branch or PR exists.
`reviewed-plan` retains the actual reviewed digest, real D5 producer and
non-authorizing auto-handoff identity. `execution-note` retains the guarded note
path/digest, current issue-authority validation and existing owner identity,
without D5 or auto-handoff claims. Missing, mixed, stale or fabricated provenance
fails closed; neither variant grants publication or provider-mutation authority.
Before any receipt, record an initial
handoff only from the recorded owner, matching current provider/issue, with the
controller-validated tuple. Only router source refresh supplies the source-state
digest; an owner handoff cannot initialize or refresh it. A receipt cannot
initialize, refresh, authenticate, or validate these controller-local facts;
they are not a receipt artifact, schema, or persistence system.

The confirmed owner/host binding retains independently proven expected
repository, canonical issue, and complete key. Before keyed-route retention,
approved-route derivation, receipt acceptance, or continuation, compare the
current repository to it with supported canonical identity, allowing equivalent
aliases. A missing, ambiguous, or mismatched repository waits or reports,
retaining original owner, key, and binding with no receipt effect. Do not replace
the binding from changed input, checkout, report, or receipt.

`current_approved_owner_route_identity` is the controller-derived current
issue-authority identity: provider, issue, owner ID, issue-authority approval,
selected preparation kind and exact identity/provenance, and refreshed
source-state digest. A changed kind or preparation identity changes route facts.
Record it before a receipt; changed components create a new identity. It is not
owner- or receipt-supplied. Its approval identity is the complete
`last_routed_issue_priming_route_key` recorded before or at source-specific
handoff. An initial report may echo that key only for equality; it cannot create
it. Missing or mismatched keys wait or require manual action.

Unknown provider states are reported as waiting rather than coerced into GitHub
or Linear terminology.

## Provider And Workflow Boundaries

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
- `pr-merge` owns GitHub PR CI polling inside the merge path, final merge execution, scoped post-merge cleanup, and merge-result reporting.
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

## Observation and uncertain-effect recovery

Before routing, acting, or reporting, compare an incoming owner or provider
observation with retained current facts for the same item and
operation. Use supported event or operation identity, applicable revision or
head, and verification evidence to establish comparability and freshness;
delivery and observation timestamps alone cannot order effects. A duplicate
or superseded observation does not replace verified current facts, reopen a
resolved blocker, trigger a notification, or consume or repeat a route key.
For conflicting or incomparable observations, refresh only the affected
authoritative owner or provider state, then classify from the reconciled
current facts. Missing identity, required head, or freshness evidence holds
the affected action. Replace obsolete claims and apply Operational retention
to the compact authority, route, receipt and pending-effect markers.

On resume after an observation may have been interrupted before its record,
refresh the affected authoritative state before consuming it. If an effect may
have occurred before its route or delivery record was retained, reconcile the
supported owner, host, or provider result and the original route identity
before retrying; an unknown result waits. Authorization, dispatch or delivery,
observed owner start, and verified completion each require their own supported
evidence. None implies the next stage. An absent approval, authority binding,
or replay fact cannot be reconstructed from status or transcript. Apply the
existing creation, approval, receipt, and route-specific safeguards after this
reconciliation; it grants no new effect authority.

## Monitor Loop

This is one bounded reconciliation pass for an explicit request or delivered
report/event, not an unattended owner-progress loop. Apply the coordinator's
[bounded observation boundary](../issue-batch-coordination/SKILL.md#reporting-path-and-bounded-observation)
without invoking it back: repeated owner reads, snapshots, or waits to discover
ordinary progress or a gate are prohibited, regardless of tool or interval.
Initial binding, received-report validation, explicit user status, and recovery
of a concrete uncertain operation end at the named fact/result or its specific
unresolved gap. After routing, yield for owner reports; watchdog external-event
observation does not discover owner progress.

Before unattended owner release, require a supported return-report path with
verified coordinator and sender identities/hosts and recipient-verifiable
actual human reporting authority where required by the sending host. Reuse the
coordinator's initial setup decision. Carry that recipient binding and accessible
host evidence reference into each reporting handoff, alongside the unchanged
route binding; do not invent a new route key or message schema. The receiving
owner must validate the original human evidence once and retain it for compatible
reports and resume. If its sending host demonstrably needs no human messaging
permission, retain the supported policy basis with reporting scope; absence of
an authorization reference alone cannot establish that exception. Creation or
a forwarded controller prompt is not human authorization.
An inaccessible side-chat approval holds release for only the missing supported
recipient-visible human instruction. Unsupported delivery names the transport
gap; unauthorized delivery names the permission gap. Neither permits polling.
Valid authority persists across routine gates/head changes; recheck only actual
missing/unverifiable evidence, revocation, uncovered recipients/effects, or host
requirements.

For compatible-owner reuse, after active start-work/reuse authority and the
existing canonical issue, exact owner/host, repository and route checks pass,
deliver the existing shared Inputs reporting fields and original sender-visible
evidence to that exact owner in an authorized reporting-context-only handoff.
The owner applies shared Inputs validation before the adopted reporting path
is relied on. Establish supported delivery plus owner validation from existing
handoff/host results, ending at confirmation or the specific gap; send success
alone does not establish readiness. If current valid context is verifiably
retained, reuse it without a duplicate message. Missing, unknown, unsupported,
unauthorized or unverifiable delivery/validation holds reporting adoption.
Read-only discovery never sends this handoff or adopts reporting context.
This requirement applies to both mapped-owner reuse and confirmed compatible
reuse found during active dispatch. Do not re-prime, release another initial
continuation, replace original keys, reset receipts, or require a routine
progress acknowledgement; independent authorized local work continues.

For a coordinator-owned successor transition, apply the coordinator's
[Recovery and watchdog](../issue-batch-coordination/SKILL.md#recovery-and-watchdog)
rebinding readiness before dispatch through the successor. Preserve exact
owner/repository/route/receipt guards; a changed controller recipient does not
initialize a new execution route or supply effect authority.

For each affected batch item:

1. Refresh source-issue state through the provider surface when available.
2. Classify source-issue state before deciding whether missing-owner issue
   priming is valid.
3. If `owner_thread_id` is missing, first reconcile any pending owner creation
   through supported host result or supported read-only compatible-owner
   discovery bound to that attempt's retained original complete route key. A
   pending result waits or reports when it cannot yet be confirmed; changed
   source state does not authorize a second dispatch or erase its original key
   and suppression. With no pending result, inspect/monitor-only first proves
   the expected repository and canonical issue identity, then performs
   supported read-only compatible-owner discovery. A
   unique compatible confirmed depth-0 owner maps to that exact owner/host and
   continues ordinary monitoring without provider priming. No match, unknown
   discovery capability, or unknown or ambiguous owner identity waits or reports
   without effects. This discovery requires neither creation nor start-work
   authority and records no dispatch key. Inspect/monitor-only ends after that
   reconciliation, mapping, or report. Independently of that missing-owner
   branch, a monitor-only discovery mapping has an `owner_thread_id` but no
   approved route key; it remains mapping-only until a later active start-work
   pass. That later pass enters the compatible-owner reuse transition below,
   not missing-owner discovery or creation. Before it can reuse the mapped
   owner, reconcile any pending original creation first and retain its original
   key unchanged. Then prove the provider-native argument and expected
   repository from controller-held source/project context, independently of any
   candidate checkout, and compute the complete issue-priming route key from
   the actual observed missing-owner/discovery state. Missing expected
   repository context is one missing decision: wait or report before dispatch.
   Before retaining an already bound recorded matching key, compare the current
   independently proven expected repository to its retained confirmed-owner/host
   binding. A missing, ambiguous, or mismatched comparison waits or reports and
   retains the original owner, key, and binding; do not initialize or replace
   it. For an unkeyed discovered mapping, validate the
   complete controller tuple and current active start-work authority, then
   revalidate the exact supported owner/host as a compatible **top-level owner
   task**. The complete tuple includes provider, canonical provider-prefixed
   issue identity, current active eligibility and source-state digest,
   independently proven provider-native argument and expected repository,
   complete route key, work intent, and applicable effect authority. Missing,
   stale, conflicting, unauthorized, or incompatible facts retain the mapping
   and wait or report. A compatible mapped owner records that existing complete
   key while retaining its binding; it does not create an owner, begin provider
   priming, or release an initial continuation. It proceeds through the existing
   validated owner-handoff, selected preparation provenance, controller-held approved
   route identity, and sequence-acknowledgement prerequisites before any receipt
   consumption. Only for an item whose `owner_thread_id` remains missing after
   that reconciliation, use this owner-dispatch sequence: validate the complete
   dispatch tuple and current effect authority; discover a compatible existing
   **top-level owner task** using that key; and, only when no compatible owner
   exists, preflight host task-creation capability before retaining an in-flight
   attempt and creating one separate top-level owner task with the
   source-specific priming prompt as its initial work. Missing or unknown
   creation capability waits or reports before creation; do not invent an
   identity from a checkout. Host confirmation must identify the actual depth-0
   owner and scoped host before the binding is released.
   A nested controller child is never an owner substitute. Reuse a confirmed
   compatible owner and its branch or checkout continuity without re-priming
   it. When supported confirmation or discovery provides an optional checkout
   candidate, retain it only with its exact confirmed owner/host and expected
   repository context; it remains optional, unvalidated, and non-authorizing.
   Record
   `last_routed_issue_priming_route_key` only for compatible confirmed reuse or
   host acceptance with a pending or confirmed creation result. A definitive
   host denial that proves no creation occurred clears only that attempt's
   in-flight suppression and leaves no routed key, so a later authorized
   same-key retry is eligible. An unknown result remains pending for
   reconciliation before any retry, including after a source-digest refresh;
   never clear it or record it as an accepted denial. Record an
   `owner_thread_id` only from supported host evidence that confirms the
   mapping; report host denial separately from missing user authority. The
   controller binds that confirmation to the expected repository, canonical
   provider-prefixed source issue identifier, and exact route key, and includes
   the actual owner ID plus host identity when task IDs are host-scoped. A host
   confirmation establishes that mapping but does not authorize work. An initial
   creation prompt may arrive before confirmation, but it must wait without
   artifact writes or research until a controller continuation delivers the
   binding. GitHub items use
   `github-issue-priming`; Linear items use `linear-issue-priming`.
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
   routing another source-specific priming entrypoint or owner task. Missing
   route-key evidence fails closed to waiting or manual action. For an eligible
   initial binding/release only, supply the recorded complete key, canonical
   provider-prefixed
   `source_issue_identifier`, independently proven expected repository, and
   host-confirmed owner binding, plus the optional paired checkout candidate
   when present, as non-authorizing controller handoff context to the
   source-specific issue-priming prompt. Alongside those unchanged bindings,
   supply the shared Inputs reporting fields: `batch-reporting-recipient-id`,
   `batch-reporting-recipient-host-identity` when host-scoped,
   `batch-reporting-scope`, and `batch-reporting-authorization-reference` when
   the sending host requires human authorization. Supply the original
   sender-accessible actual-human evidence locator, or retain a demonstrably
   supported no-human-authorization policy basis with scope. Validate recipient,
   sender/host, scope and evidence before unattended release; missing required,
   inaccessible, unverifiable or mismatched context holds only that affected
   boundary with its concrete gap. Both GitHub and Linear entrypoints preserve
   these facts and any supported exception basis unchanged into normalized
   shared Inputs; they cannot drop facts or fabricate permission. The source
   entrypoint must preserve the
   received complete key, canonical source issue identifier, independently
   proven expected repository, and host-confirmed owner binding unchanged into
   the shared issue-priming workflow, and pass the optional paired checkout
   candidate to `issue-worktree-setup` for its existing validation. It must not
   derive expected repository identity from the candidate checkout or derive,
   replace, or shorten the canonical source issue identifier. The shared
   issue-priming workflow may only forward that received route key unchanged
   into its initial owner-handoff report for equality comparison and must use
   the received canonical identifier for batch reports. Missing, provisional,
   changed, or mismatched binding context must wait or report before artifact
   writes or research. Record the host-confirmed
   created or located owner-thread mapping before continuing the item. Only active source issues
   with missing owner threads route to source-specific issue priming. Terminal,
   duplicate, abandoned, blocked, or unknown no-owner states wait or report
   instead of creating owner work.
4. After missing-owner reconciliation, independently of whether
   `owner_thread_id` is now present, use the retained pending-creation recovery
   facts to identify a confirmed owner still waiting for its initial binding
   continuation. Before that continuation, refresh that exact owner's supported
   host state. A waiting or resumable idle owner is eligible for the ordinary
   initial-release-once gate. Unknown state waits; definitively unavailable,
   cancelled, archived, failed, or non-resumable state reports unavailable for
   the existing controller/manual reconciliation. In every unavailable case,
   retain the confirmed mapping and pending recovery without release,
   replacement, unarchive, deletion, or clearing suppression. For an eligible
   owner, compare the current source digest, provider-native argument,
   repository, canonical issue, owner/host identity, intent, and authority to
   the retained dispatch facts. The expected missing-to-confirmed mapping alone
   keeps the original complete route key unchanged; any other drift waits or
   reports. An optional checkout candidate stays paired to that owner/host and
   expected repository but is not repository proof or an initial-release fact.
   Only when every retained fact remains current and compatible, release that
   waiting top-level owner once to the matching provider entrypoint with the
   original key and confirmed owner binding unchanged, explicitly including the
   optional candidate when present. Its absence uses the existing no-candidate
   path, and an existing active compatible owner is never re-primed only to
   transport one. When the
   recovery facts show that the initial continuation was already sent, continue
   the existing owner lifecycle without another initial release.
   Host-confirmed depth-0 creation followed by direct delivery of that complete
   binding to the same owner suffices for the fresh consumer handoff; no
   separate owner-discovery or current-task identity operation is required.
   An intact continuation of that binding needs no repeated identity discovery.
   Pending or provisional creation, unknown delivery, or conflicting evidence
   does not qualify. For ambiguous or recovered binding, compare supported
   current host evidence with the retained owner and scoped host; on Codex use
   the actual executing host-provided `CODEX_THREAD_ID`, never an expected ID
   assigned to that variable. Missing recovery evidence waits or reports the
   unresolved fact, and a mismatch stops the affected route. Keep repository,
   checkout, and action-permission gates before effects.
5. After an initial binding, yield for the required delivered initial owner
   handoff or gate report, then validate it through supported evidence before
   consumption. Creation, a worktree, a queued task, or a sent continuation is
   not readiness. A concrete uncertain delivery uses bounded result recovery;
   retain an unresolved outcome and expose its gap when recovery is exhausted.
   Do not repeatedly refresh owner state or wait to discover progress, blindly
   resend, or infer readiness from silence.
6. Refresh current source and PR state, and reconcile incoming observations
   under the observation and uncertain-effect recovery rule before replacing
   current facts or routing. Apply the canonical
   `issue-priming-workflow` genuine-gate classification while preserving the
   router's PR, source-issue, publication, and terminal precedence before any
   non-gate receipt continuation: when current evidence identifies a canonical
   genuine gate, use its gate path and do not consume a receipt. Stale gate
   evidence remains a gate and cannot be bypassed by a receipt.
   An active owner already authorized on an intact route continues its
   non-gate work without routine acknowledgement or a new receipt exchange.
   Receipt validation below applies when an interrupted or resumable idle
   owner needs continuation; it does not turn ordinary active progress into
   a new gate or user notice.
7. At initial approval, validated initial owner handoff, and on a resumed route,
   use the router's existing controller-held approved-route facts to first
   compare the current independently proven expected repository to the retained
   confirmed-owner/host binding, then derive and record
   `current_approved_owner_route_identity`, including the refreshed
   source-issue state snapshot digest. Keep the refreshed current head SHA as a
   separate mandatory receipt comparison whenever a branch or PR exists. Record
   `current_reviewed_plan_handoff_provenance` from the explicit preparation
   variant defined above. This legacy-named controller-local slot accepts an
   Execution Note identity, never fabricated planning approval; no ledger
   schema or durable field is renamed. Only the router records or refreshes
   these bindings from those controller-held facts. A receipt must not
   initialize, refresh, authenticate, or validate either current binding.
   Missing controller-held facts fail closed rather than being inferred from a
   receipt. Retain the highest accepted progress sequence for every route still
   required under Operational retention; a changed binding selects a different
   map entry and cannot by itself clear an earlier guard. This
   controller-local replay state is not a generalized event store or new
   persistence system. Before the first receipt on a route, the
   controller's continuation dispatch acknowledges that route's initial
   required positive sequence and refreshed source-issue state snapshot digest
   to the same owner.
8. Before remaining gate classification, compare the current independently
   proven expected repository to the retained confirmed-owner/host binding, then
   validate every unfinished non-gate progress receipt fact against the current
   item: the same approved route
   (`current_approved_owner_route_identity`), selected preparation provenance
   (`current_reviewed_plan_handoff_provenance`), refreshed source-issue state
   snapshot digest, current head when required (the receipt must carry the
   current head SHA and it must match the refreshed controller-held head), and
   unfinished non-gate evidence. A missing current binding, missing required
   source-state digest or head, or stale route/provenance/source-state/head
   mismatch fails closed to waiting or manual action.
   Only after those checks pass, require a positive progress sequence equal to
   the controller-acknowledged next required sequence, then record the highest
   accepted sequence in the matching per-route map entry, separately
   from approval and gate-report keys, before continuing the same owner route.
   The continuation dispatch acknowledges that route's next required sequence
   and refreshed source-issue state snapshot digest to the same owner; the
   producer must echo both acknowledged values rather than infer sequence or
   source-state from a resumed or compacted thread. If that record or
   acknowledgement cannot be retained, fail closed to waiting or manual action;
   only after it succeeds may the router consume the verified new receipt by
   continuing. A receipt A at sequence 1, receipt B at sequence 33, then receipt A again at
   sequence 1 is older than A's retained map entry and is a repeat: do not
   continue the route again or update any approval key. Missing, repeated,
   non-positive, or non-increasing progress sequences fail closed; route
   changes alone must not evict still-needed guards. Retired or unknown routes
   cannot restart from a delayed receipt. Missing identity, route
   provenance, or unfinished non-gate evidence fails closed to waiting or
   manual action. A genuine gate does not qualify as progress.
9. For an item without receipt continuation, classify any remaining gate using
   PR gate precedence, source-issue state, and any owner-thread report.
10. Compare the gate's duplicate-route key with the ledger.
11. Route only when the route key is new or the current state invalidates the
    prior route.
12. Record the route, approval, waiting reason, or terminal state in the ledger.
13. Report the monitor pass.

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
`issue-priming` route keys suppress duplicate owner dispatch and source-specific
priming while `owner_thread_id` remains missing for the same complete key.
Pending creation must be reconciled before a changed key is treated as a new
dispatch opportunity. Missing
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
2. Reconcile supported current PR/head review evidence under the accepted
   conditional policy in ROUTE-007-REVIEW for both initial and corrected
   published heads. Applicable completed passing/thumbs-up Connector evidence
   may satisfy its review condition after findings/nits disposition; eyes blocks only while
   genuinely pending. A completed current provider result overrides lingering
   reactions. Active blocking results still block merge. Missing, ambiguous,
   stale, or incomplete required evidence waits; without accepted policy,
   preserve configured gates.
3. Stale approval signals tied to an older head SHA do not count.
4. Merge conflicts route to the owner thread for the PR's current base branch when a PR exists, or for configured/default base evidence when no PR base is known. Unknown base evidence waits instead of assuming `origin/main`; do not assume `origin/main` unless it is proven as the current or configured base.
5. Unresolved inline review threads route to the review-response workflow unless already routed for the same complete review-response route key, including source provider, source issue identifier, PR provider, PR identifier, head SHA, and unresolved-thread-set digest.
6. Failing CI routes to the CI-fix workflow only when the current failing run/check requires repair work outside PR-merge's normal polling scope. CI-fix routing also requires a provider-specific CI-fix workflow to be available. When that workflow is unavailable, report waiting with the missing workflow.
7. Otherwise merge-ready PRs that require explicit human merge approval wait until matching human merge approval evidence is present.
8. Merge-ready PRs route to `pr-merge` only when all configured gates pass:
   non-draft, CI-green or pending CI, conflict-free, no unresolved review
   threads, no active blocking bot signal, branch protection permits merge or
   is compatible with waiting for CI, any required human merge approval is
   present, and the configured review condition is satisfied by fresh current-head
   evidence, including an accepted conditional result when applicable.

Pending CI that is already inside the merge path belongs to `pr-merge` polling,
not a separate CI-fix route. A provider that does not expose one signal should
record `unknown` for that signal and continue only when the remaining gates
make the route safe; unknown required merge evidence means wait.
Pending CI routes to `pr-merge` for polling only after every non-CI merge gate
is satisfied. Non-CI merge gates include non-draft status, conflict-free or
mergeable state, no unresolved review threads, no active blocking bot signal,
branch protection and review state compatible with waiting for CI, required
human merge approval when policy requires it, and the configured review
condition satisfied by fresh current-head evidence under the applicable policy.
`pr-merge` may merge only after pending CI becomes green and current merge protections still pass. Failing CI that
requires repair is not pending merge-path polling.

Use Connector-first published-head selection under the accepted conditional
policy, including after corrections. A changed commit alone does not add
`pr-review` when applicable completed passing/thumbs-up current-head Connector
evidence satisfies the condition.
Pending review waits; slow review, lingering reactions, or missing/ambiguous head
association cannot independently establish confirmed quota/unavailability.

Confirmed Connector quota/unavailability routes observation to the coordinator
for one dedicated independent ordinary host task invoking `pr-review`.
Retain the existing complete `bot-review-signal` key and context; reconcile and
reuse or suppress the unchanged fallback rather than duplicate tasks or review
requests. Reuse compatible registered ownership before creation. Register the
supported task identity, repository/PR/reviewed head and coordinator recipient/host
with authorized reporting and independence from the implementation owner in
existing state. A coordinator child agent cannot replace the top-level workflow
owner; internal review delegation, scope, artifacts, posting and lifecycle belong
to `pr-review`. Missing ordinary-task dispatch or messaging capability reports its
specific limitation without a silent alternative execution mechanism.
Only a complete current passing review with required verification references
received through that bound reporting path passes the
review condition, never task creation, completion status alone, partial evidence,
or same-account GitHub APPROVE. Findings return to the implementation owner;
missing authority, control, bindings or verdict waits or reports. Dispatch does
not imply GitHub posting authority.

Returning or concurrent Connector evidence is reconciled with that owner and
current PR/head without duplicate dispatch, lost findings or conflicting
readiness. Restoration does not silently cancel the task or discard retained
result, disposition or cleanup obligations. Receive verdict readiness separately
from retained resources and outstanding cleanup. The dedicated owner keeps
review-resource custody under `pr-review` until consumer release and lifecycle
gates permit retirement; ordinary-task archival still requires terminal and
pending-work checks. Verdict readiness alone cannot clear cleanup obligations.

For authorized in-scope corrections, preserve covered fix/publication authority
without a generic renewed request, while requiring the review-response concrete
pre-push summary of exact changes/commit, verification, classified dispositions
and intended actions. Validate the local candidate and refresh the exact
branch/head binding for the covered plain update before its publication. After
successful publication, apply the same Connector-first selection to the current
published head before review readiness or merge. Applicable completed
passing/thumbs-up Connector evidence satisfies the accepted condition without an extra automatic `pr-review`;
when that workflow is selected, its existing full-versus-narrow follow-up scope
and required verification remain required. A changed local or remote head invalidates old-head approval;
carry applicable prior coverage only as context. Refresh the existing affected
action/route binding against the new head before each effect. A failed push
leaves the candidate unpublished; neither the summary nor a follow-up request
establishes publication success. Scope expansion, new choices, exceptions, or missing authority use
the existing owner/approval gate. This does not change report-only reviewer nits,
thread permissions/refetches, feedback, CI, or protection requirements.

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

### Standing delivery scope and current actions

These semantic cases use the existing keys and handoffs, without live effects.
The valid family has accepted human scope for publication, conditional merge,
and scoped cleanup; exact owner O/host T; current PR P/head H; and all required
review, CI, protection, route and owner evidence. Invalid variants change only
the named dimension; other facts remain consistent.

| Case                                                                                      | Required outcome                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid family progresses from reviewed H publication to merge readiness                    | Coordination issues current concrete instructions within retained scope; router validates each binding and routes merge/cleanup to `pr-merge` once under existing keys. Priming finishes mandatory phases at the reviewed PR/head report.                                                                                                                                                                                           |
| An authorized correction produces H2, with H2 gates and a new exact instruction refreshed | Reject H bindings, retain delivery scope and O/T; after classification, local validation and the concrete pre-push gate, bind and perform the covered plain update, then Connector-first current published-H2 review (with scope-selected `pr-review` follow-up when selected) before readiness/merge. Refresh genuine H2 gates and exact instructions without generic human reapproval; retain needed recovery/deduplication keys. |
| H2 is current but only H readiness and binding exist                                      | Hold the action for H2 evidence and instruction refresh, without revoking scope or consuming its approval route key.                                                                                                                                                                                                                                                                                                                |
| Human scope is PR-only                                                                    | Stop at publication; merge requires the missing delivery decision.                                                                                                                                                                                                                                                                                                                                                                  |
| Human explicitly revokes the accepted scope                                               | Hold further effects for the owning decision; current green evidence does not restore authority.                                                                                                                                                                                                                                                                                                                                    |
| Human reserves the merge decision and has not supplied it                                 | Wait for that specific human decision; conditional readiness cannot replace it.                                                                                                                                                                                                                                                                                                                                                     |
| Requested effect expands beyond the accepted scope                                        | Escalate only that expansion before its effect.                                                                                                                                                                                                                                                                                                                                                                                     |
| Host denies the otherwise eligible action                                                 | Report the specific unavailable action; no alternate host or workflow workaround.                                                                                                                                                                                                                                                                                                                                                   |
| Verified merge has unrelated unfinished work present during scoped cleanup                | Existing cleanup guards retain that work and report the remaining obligation; merge success does not authorize deletion or terminal archival.                                                                                                                                                                                                                                                                                       |

### Owner dispatch and checkout adoption

The following bounded fixture families are the self-check surface for the owner
route. Each yields one eligible action or an explicit wait/manual outcome;
they do not authorize live task creation during fixture evaluation.

| Family                                                                                                                                                                                                                                                                       | Required outcome                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct router invocation has active start-work intent, a complete tuple including independently proven expected repository, applicable creation authority, required task-creation capability, and no compatible owner                                                        | Retain an in-flight attempt, dispatch exactly one separate depth-0 owner task carrying the provider priming prompt, retain pending host output, record the route key only after accepted pending/confirmed output, and record the mapping only after host confirmation bound to repository, issue, route, owner, and host identity when scoped. |
| Coordination handoff has the same accepted scope, authority, and active start-work facts                                                                                                                                                                                     | Forward them unchanged to the router and obtain the same owner-dispatch procedure and outcome as direct invocation; coordination creates no second procedure.                                                                                                                                                                                   |
| Direct or coordinated item is inspect/monitor-only                                                                                                                                                                                                                           | Refresh, discover, reconcile, or report only; do not create an owner task or begin provider priming.                                                                                                                                                                                                                                            |
| Inspect/monitor-only item has no pending creation or local owner mapping, independently proven repository and canonical issue, and one uniquely compatible supported confirmed depth-0 owner/host mapping                                                                    | Record that mapping and continue ordinary monitoring with zero creation, start-work, route-key, or priming effect.                                                                                                                                                                                                                              |
| The same monitor-only item has no compatible owner                                                                                                                                                                                                                           | Report without creation, start-work, route-key, or priming effect.                                                                                                                                                                                                                                                                              |
| The same monitor-only item has unknown discovery capability                                                                                                                                                                                                                  | Wait or report without creation, start-work, route-key, or priming effect.                                                                                                                                                                                                                                                                      |
| The same monitor-only item has unknown or ambiguous owner identity                                                                                                                                                                                                           | Wait or report without creation, start-work, route-key, or priming effect.                                                                                                                                                                                                                                                                      |
| A later active start-work pass has that discovery-only mapping for owner O on host H, no pending creation or recorded key, a complete current controller tuple including the observed missing-owner/discovery state, applicable effect authority, and O/H remains compatible | Record the existing complete key while retaining O/H's mapping; do not create, prime, or initially release O. Use the existing validated owner-handoff, selected preparation provenance, approved-route identity, and sequence acknowledgement before consuming a receipt.                                                                      |
| The same discovered mapping has exactly one absent active effect-authority fact                                                                                                                                                                                              | Retain the mapping and wait or report with no key, creation, priming, or release.                                                                                                                                                                                                                                                               |
| The same discovered mapping has active authority but exactly one missing or stale complete-tuple fact                                                                                                                                                                        | Retain the mapping and wait or report with no key, creation, priming, or release.                                                                                                                                                                                                                                                               |
| The same discovered mapping has a complete authorized tuple but O/H is incompatible                                                                                                                                                                                          | Retain the mapping and wait or report with no key, creation, priming, or release.                                                                                                                                                                                                                                                               |
| The same discovered mapping has a pending original creation attempt                                                                                                                                                                                                          | Reconcile that attempt first and retain its original key unchanged; do not replace it with compatible-owner reuse.                                                                                                                                                                                                                              |
| The same discovered mapping already has a bound matching key                                                                                                                                                                                                                 | Continue the existing owner route; do not initialize or replace the key, re-prime, or release an initial continuation.                                                                                                                                                                                                                          |
| Existing compatible confirmed owner, branch, checkout, and authority match the complete key                                                                                                                                                                                  | Reuse the same depth-0 owner and continuity evidence without a generic reapproval or re-priming.                                                                                                                                                                                                                                                |
| A confirmed Linear owner/host binding retains repository A, while the same issue, digest, provider-native argument, and complete key now have repository B                                                                                                                   | Wait or report before keyed retention, approved-route derivation, receipt acceptance, or continuation; retain the original owner, key, and repository binding with no receipt effect.                                                                                                                                                           |
| The same retained binding is absent while every current route fact remains otherwise compatible                                                                                                                                                                              | Wait or report before keyed retention, approved-route derivation, receipt acceptance, or continuation; retain the original owner and key, with no receipt effect.                                                                                                                                                                               |
| The same retained binding has repository A and current repository is a supported canonical alias of A                                                                                                                                                                        | The alias passes only this repository comparison; every existing retention, derivation, receipt, and continuation gate still applies.                                                                                                                                                                                                           |
| Active start-work item is missing creation authority                                                                                                                                                                                                                         | Ask for that one authority decision before any host creation or provider priming.                                                                                                                                                                                                                                                               |
| With no compatible owner, host-resolution variants each change one fact from valid start-work: task-creation capability is unavailable, definitive denial with no creation, only a provisional creation identifier, or an unknown result                                     | Respectively report the manual owner-dispatch action before creation; release only the denied attempt so a later authorized equal-key retry can run; retain and reconcile pending creation without a provisional `owner_thread_id`; or retain unknown recovery state and reconcile before any retry.                                            |
| Pending creation confirms while the source remains active, intent remains start-work, effect authority remains applicable, the original complete key remains compatible, and the current owner is waiting or resumable idle                                                  | Retain the original key and confirmed mapping, refresh the owner state, then release exactly one waiting owner continuation to the matching provider priming entrypoint.                                                                                                                                                                        |
| Pending creation confirms after exactly one current release fact changes: source becomes terminal, intent becomes inspect/monitor-only, effect authority is revoked or unknown, or the exact route becomes incompatible                                                      | Retain the confirmed mapping and recovery evidence, then wait or report; do not release provider priming, duplicate creation, or re-prime the owner.                                                                                                                                                                                            |
| A confirmed owner awaiting initial release has unknown supported state                                                                                                                                                                                                       | Wait while retaining the mapping and recovery; do not release or clear suppression.                                                                                                                                                                                                                                                             |
| A confirmed owner awaiting initial release is definitively unavailable, cancelled, archived, failed, or non-resumable                                                                                                                                                        | Report unavailable for existing controller/manual reconciliation while retaining the mapping and recovery; do not release, replace, unarchive, delete, or clear suppression.                                                                                                                                                                    |
| Batch binding has expected repository A, no explicit adoption candidate, an invocation in canonical repository A, and a native or fallback result with an equivalent canonical repository identity                                                                           | Validate the invocation before provisioning, validate the selected result before evidence writes, then continue through the existing provisioning path.                                                                                                                                                                                         |
| Batch binding has expected repository A and exactly one repository fact changes: the no-candidate invocation is repository B, or a valid invocation selects repository B or an ambiguous result                                                                              | Respectively stop before native or fallback provisioning effects, or stop before evidence writes; do not infer A from B, switch checkout, reset, delete, or provision an alternate result.                                                                                                                                                      |
| Checkout-adoption variants each hold all other facts fixed: direct primary invocation without an explicit candidate, a validated root-task checkout with existing issue work, or an explicit unrelated/mismatched/ambiguous checkout                                         | Respectively provision through the current native-first/fallback path; adopt and preserve the work before artifact guards without fallback or nested worktree; or block before writes, branch repurposing, or fallback provisioning.                                                                                                            |
| An eligible initial binding for confirmed owner O on host H has expected repository A and an optional host-confirmed checkout candidate P paired to O/H                                                                                                                      | Include P explicitly in that one provider handoff; the existing provider/setup path validates and adopts it before writes. P is not repository or owner proof.                                                                                                                                                                                  |
| Host confirms depth-0 owner O on host H and directly delivers the complete retained binding to O; repository, checkout, and action authority are valid, with no conflicting evidence or separate identity operation                                                          | Accept the fresh provider and shared handoff. An ordinary intact continuation of that same binding also proceeds without repeated identity discovery.                                                                                                                                                                                           |
| The same handoff has provisional creation or unknown delivery, or recovery lacks supported actual current host identity                                                                                                                                                      | Retain the original key and suppression; wait or report the concrete unresolved fact without artifact writes, research, blind resend, or replacement.                                                                                                                                                                                           |
| Recovered Codex handoff has an actual executing host-provided `CODEX_THREAD_ID` different from retained owner O, or scoped host evidence conflicts                                                                                                                           | Stop the affected route before artifact writes or research; never set `CODEX_THREAD_ID` from O to manufacture a match.                                                                                                                                                                                                                          |

Use these concrete fixture outcomes to self-check monitor decisions:

| Fixture state                                                                                                                                                                                                                                                     | Required outcome                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub issue and Linear issue are in the same batch                                                                                                                                                                                                               | Normalize both into provider-tagged batch items; preserve `source_provider: github` and `source_provider: linear`.                                                                                                                                       |
| Missing `owner_thread_id` for a GitHub item                                                                                                                                                                                                                       | If active and dispatch-eligible, retain the original key through owner dispatch, confirm and record the owner-thread mapping, refresh that owner's supported state, then release `github-issue-priming` once only when the release facts remain current. |
| Active GitHub source issue with missing `owner_thread_id`                                                                                                                                                                                                         | Reuse a compatible owner without re-priming. For a newly created owner, confirm and record its mapping, then use Monitor Loop step 4 to release `github-issue-priming` once from retained pending-creation recovery.                                     |
| Active GitHub source issue `github:owner/repo#123` with missing `owner_thread_id`                                                                                                                                                                                 | Convert to the full issue URL before routing to `github-issue-priming`; use a bare issue number only when current repository context is explicitly proven, and do not pass the prefixed ledger key or `owner/repo#123` shorthand.                        |
| Active GitHub source issue `github:owner/repo#511` at source-state digest `S1` has missing `owner_thread_id`, provider-native entrypoint argument `https://github.com/owner/repo/issues/511`, and matching `last_routed_issue_priming_route_key` already recorded | Wait, inspect, or report instead of routing another `github-issue-priming` call while `owner_thread_id` remains missing.                                                                                                                                 |
| Host definitively denies a same-key creation and later receives applicable creation authority without any issue change                                                                                                                                            | Release the denied attempt without a `last_routed_issue_priming_route_key`, then allow exactly one later owner-dispatch attempt.                                                                                                                         |
| Host result for a same-key creation is unknown                                                                                                                                                                                                                    | Retain recovery state and reconcile before another owner-dispatch attempt; do not clear it or record a denial.                                                                                                                                           |
| Missing source-state digest or provider-native entrypoint argument for an issue-priming route key                                                                                                                                                                 | Report waiting or manual action; do not route source-specific issue priming with an incomplete replay key.                                                                                                                                               |
| Missing `owner_thread_id` for a Linear item                                                                                                                                                                                                                       | If active and dispatch-eligible, retain the original key through owner dispatch, confirm and record the owner-thread mapping, refresh that owner's supported state, then release `linear-issue-priming` once only when the release facts remain current. |
| Active Linear source issue with missing `owner_thread_id`                                                                                                                                                                                                         | Reuse a compatible owner without re-priming. For a newly created owner, confirm and record its mapping, then use Monitor Loop step 4 to release `linear-issue-priming` once from retained pending-creation recovery.                                     |
| Active Linear source issue `linear:ENG-123` with missing `owner_thread_id`                                                                                                                                                                                        | Convert to `ENG-123` or a Linear issue URL before routing to `linear-issue-priming`; do not pass the prefixed ledger key.                                                                                                                                |
| GitHub or Linear item lacks independently proven expected repository, or its confirmed owner binding has a changed repository, issue, route, owner, or scoped host identity                                                                                       | Wait or report before owner artifact writes or research; no consumer derives expected repository from its checkout.                                                                                                                                      |
| Closed/completed source issue with missing `owner_thread_id`                                                                                                                                                                                                      | Report waiting or terminal disposition; do not create an owner thread.                                                                                                                                                                                   |
| Source issue state is unknown to the generic workflow                                                                                                                                                                                                             | Report waiting; do not mutate source issue status and do not coerce provider terminology.                                                                                                                                                                |
| PR has active blocking bot signal                                                                                                                                                                                                                                 | Wait for bot review; do not merge.                                                                                                                                                                                                                       |
| PR has approving bot signal from old head SHA                                                                                                                                                                                                                     | Treat the approval as stale; wait for a fresh review signal for the current head SHA.                                                                                                                                                                    |
| PR has failing check run `A` at head `H`, source provider `github`, source issue identifier `S`, PR provider `github`, PR `P`, and observable provider-specific GitHub CI-failure repair capability evidence                                                      | Route CI-fix once using that observed capability evidence. Route CI-fix once for check run `A`, keyed by source provider `github`, source issue identifier `S`, PR provider `github`, PR `P`, head SHA `H`, and check run ID `A`.                        |
| No provider-specific CI-fix workflow is available for failing check run `A`                                                                                                                                                                                       | Report waiting with the missing CI-fix workflow; do not rerun CI directly and do not fall back to `pr-merge` for repair.                                                                                                                                 |
| The same PR with no observable provider-specific CI-fix capability                                                                                                                                                                                                | Report waiting or manual action with the missing provider-specific CI-fix capability; do not name `github:gh-fix-ci` as a required source workflow.                                                                                                      |
| PR has unresolved review-thread digest `B` at head `H`, source provider `github`, source issue identifier `S`, PR provider `github`, and PR `P`                                                                                                                   | Route review-response once for the complete key: source provider `github`, source issue identifier `S`, PR provider `github`, PR `P`, head SHA `H`, and unresolved-thread-set digest `B`.                                                                |
| PR has unresolved review-thread digest `B` and lacks required human merge approval                                                                                                                                                                                | Route review-response before waiting for human merge approval.                                                                                                                                                                                           |
| PR is merge-conflicted at head `C`                                                                                                                                                                                                                                | Route owner thread once by PR, head SHA, and mergeability state, plus proven base branch or base evidence digest.                                                                                                                                        |
| PR is merge-conflicted at head `C` against proven base `release/1.x`                                                                                                                                                                                              | Route owner thread once by PR, head SHA, mergeability state, and proven base branch or base evidence digest.                                                                                                                                             |
| PR base changes after prior merge-conflict routing                                                                                                                                                                                                                | Treat the changed base evidence as a new `merge-conflict` route key.                                                                                                                                                                                     |
| Merge-conflicted PR has unknown base evidence                                                                                                                                                                                                                     | Report waiting with missing base evidence; do not assume `origin/main`.                                                                                                                                                                                  |
| Owner thread reports approval gate `D`                                                                                                                                                                                                                            | Send approval only when parent approval evidence matches the source issue or PR, head SHA/current state, gate kind, route key, and allowed side effect.                                                                                                  |
| Owner thread reports source-issue reporting gate `E`                                                                                                                                                                                                              | Route only to a provider-specific workflow that owns that source-issue side effect.                                                                                                                                                                      |
| Owner thread reports source-issue reporting gate `E` at source-state digest `S1` with requested side effect `close-as-completed`                                                                                                                                  | Route source-issue reporting once for the complete `source-issue-reporting` key including source issue, owner thread, gate/report digest, requested side effect, source-state digest `S1`, and head SHA when known.                                      |
| Owner thread reports source-issue reporting gate `E`, but no provider-specific source-issue reporting workflow is available                                                                                                                                       | Report waiting or manual action with the missing source-issue reporting workflow and next safe action; do not mutate the source issue directly and do not route to a generic fallback workflow.                                                          |
| Source issue is verified closed/completed without a PR and owner thread reports terminal state                                                                                                                                                                    | Archive only after verified closed/completed source state, terminal owner-thread state, no active gate, no pending work, no unresolved follow-up, and `last_routed_archival_key` recording.                                                              |
| Repository policy requires explicit human merge approval and PR is otherwise merge-ready                                                                                                                                                                          | Wait until matching human merge approval evidence is present.                                                                                                                                                                                            |
| PR is otherwise merge-ready but lacks required human merge approval                                                                                                                                                                                               | Wait for matching human merge approval evidence; do not route to `pr-merge`.                                                                                                                                                                             |
| PR is non-draft, green, conflict-free, no unresolved threads, required human approval present, and fresh required approval signal present                                                                                                                         | Route `pr-merge` once with `last_routed_merge_routing_key`.                                                                                                                                                                                              |
| PR is non-draft, pending CI, conflict-free, no unresolved threads, no active blocking bot signal, branch protection and review state allow waiting for CI, required human approval is present, and fresh required approval signal is present                      | Route `pr-merge` once with `last_routed_merge_routing_key` for CI polling; `pr-merge` may merge only after CI becomes green and protections still pass.                                                                                                  |
| PR previously routed to `pr-merge` with pending CI later becomes CI-green at the same head SHA                                                                                                                                                                    | Treat the green CI state as a new `merge-routing` route key; do not suppress it with the prior pending-CI merge-routing key.                                                                                                                             |
| PR has failing CI that requires repair while non-CI merge gates are otherwise satisfied                                                                                                                                                                           | Route to provider-specific CI-fix when available, or wait/manual action when unavailable; do not treat failing CI as pending `pr-merge` polling.                                                                                                         |
| PR merged and owner thread reports terminal state                                                                                                                                                                                                                 | Archive only after terminal PR or source state, no active gate, no pending work, and `last_routed_archival_key` recording.                                                                                                                               |

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

### Delivery and evidence

The active owner is the producer of initial handoff, hard-gate, dependency-ready,
material readiness-invalidation, and verified job-completion reports; its
verified coordinator is the recipient. Use the established supported reporting
path and retained actual human authority under Monitor Loop before delivery.
A skill call or agent-authored instruction cannot fabricate that authority.
The owner sends at the hard gate and holds only its affected action; independent
already-authorized work continues. Successful completion delivery needs no
routine acknowledgement, but the coordinator must validate completion evidence
and all accepted obligations before declaring batch completion. Receivers wake
on supported report delivery, validate referenced current evidence, route at most
the next authorized action per affected item, and yield. If the host cannot
deliver/wake the recipient, expose that specific transport limitation before
relying on unattended continuation; never replace delivery with polling.

A gate whose required conditions pass and whose action is covered by retained
standing delivery authority advances through its effect owner after refreshing
current evidence and exact bindings; it is not another human permission request.
Report only the remaining actionable routing/decision need. Missing or revoked
authority, scope expansion, an unresolved decision, a required-gate exception,
or an actual host restriction holds the affected action under its existing gate.

Keep routine corrections, intermediate checks, review preparation, recoverable
errors and unchanged waits in the owning task. Send the coordinator a delta
only for a required routing/decision action, dependency readiness, exhausted
recovery requiring intervention, a material head/scope/ownership/readiness
change affecting a pending action or invalidating recorded readiness, or one
verified completion, even when no further routing is needed. Initial owner
handoff remains required to establish existing routing facts. Explicit status
requests receive current evidence. An active owner continues authorized work
without a per-step report or acknowledgement wait.

The compact delta carries provider-tagged issue/PR identity, owner, current head
when applicable, changed state, requested coordinator action (or none for
verified completion), and an accessible evidence reference. Retain the complete
supporting report, route key, validators and diagnostics locally under their
existing owners. This is transport, not a new report schema or evidence store.
Before any dependent action, resolve the reference and validate all required
facts against current authoritative state, including route, authority, owner,
head and replay bindings. A reference or summary alone proves none of them.
Missing, unreadable, stale, incomplete or conflicting evidence holds the
dependent action and requests only the missing evidence or intervention.

A changed head invalidates old-head readiness even when routine reporting is
quiet. Report that invalidation promptly when it affects a pending coordinator
action or recorded readiness; do not wait for a later combined completion.
Independent reviewers deliver findings directly to the authorized implementation
owner. Copy the coordinator only for a distinct coordination action; messaging
authority and review independence remain required. Combine related pushed-head,
verification and disposition results into one useful handoff where possible.

The complete supporting gate report must include the relevant complete route
key when known or applicable. Missing required key evidence fails closed to
waiting or manual action; a compact message must not hide that omission.

Each supporting gate report must include:

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

Resolve and record a digest of the complete report before sending approvals or
re-routing work. If required head, route-key or route-specific evidence is
missing, ask the owner to refresh that evidence rather than approving. Do not
require the owner to resend full evidence inline when its reference is valid.

## Unfinished Non-Gate Progress Receipts

Receipts support interrupted-owner continuation and recovery. They are not
per-step reports or acknowledgement checkpoints for an active authorized owner.
Keep ordinary progress local. On actual continuation/recovery, preserve every
existing receipt, provenance, sequence and acknowledgement check below; compact
delivery never replaces validation of the complete referenced receipt.

After the router verifies every receipt fact and records its accepted sequence,
an approved owner route continues when an unfinished non-gate progress
receipt verifies the same source provider, source issue identifier, owner thread
ID, and the same approved route identity already held by the controller. The
receipt must also provide evidence that the work is unfinished and is non-gate continuation under
the canonical `issue-priming-workflow` auto-route boundary. When the route has a branch or PR, its receipt must carry
the refreshed current head SHA; a missing or mismatched head is stale and cannot
continue the route.

Continue the same owner route without requesting approval and without updating
`last_reported_approval_waiting_key` or `last_routed_approval_gate_key`. Use
this bounded receipt state only for verified unfinished non-gate progress; it
is distinct from gate-report and approval-gate de-duplication. Do not create a
generalized event store, schema, or persistence subsystem.

Missing receipt identity or non-gate/unfinished evidence fails closed to waiting
or manual action, and a genuine gate follows the existing gate and approval
path. This receipt is controller-local progress evidence, not a new durable
ledger schema or authorization for provider mutation.

## Parent Approval Evidence

Parent approval is not blanket permission. Consume the coordinator's accepted
human delivery scope and concrete current instruction, or the direct user's
bounded decision. Validate the same source issue or PR, gate kind, route key,
allowed side effect, exact owner/host, and current branch/head when applicable.
Coordination interprets standing scope; the router validates eligibility and
deduplicates dispatch, without becoming a second human approval layer. A
PR-only decision stays PR-only. Neither `--auto` alone, planning PASS, an owner report,
nor tool availability grants publication, merge, or cleanup authority.

This gate-specific check adds no generic approval step for routine targeted
instructions or verified unfinished non-gate continuation already authorized
by accepted execution. A satisfied publication, conditional merge or scoped
cleanup gate covered by retained delivery authority executes through its existing
owner after fresh conditions and exact binding validate; it does not become a
new human permission request. Those actions still require current scope, route,
receipt, owner, and host checks.

Contract phrase: same source issue or PR, gate kind, route key, and allowed side effect.

Changes to PR head, unresolved threads, failing CI run/check, mergeability,
source-issue state, or a newer owner gate invalidate dependent readiness and
current action bindings. They do not automatically revoke an accepted delivery
decision. Reject the stale binding, refresh the affected authoritative facts
and the review, CI, protection and owner gates required for the selected action
under the distinct initial-publication/correction sequence, then consume a new exact
instruction from coordination within retained scope. For direct routing,
derive that instruction only from the user's retained bounded decision and
current facts. Never reuse stale review or approval evidence as current.

Missing or stale readiness waits for refresh; missing or conflicting scope,
revocation, expansion, a materially unresolved choice, an explicitly reserved
human decision, or an exception to a required gate needs its owning decision.
State the specific missing fact or decision instead of requesting generic
reapproval. Missing, stale, or overly broad action evidence may update only
`last_reported_approval_waiting_key`; it must not consume the actual approval
route key. Once a matching current instruction and evidence are available,
re-evaluate the owner/host, head, route key, and allowed effect before routing
and updating `last_routed_approval_gate_key`. Preserve applicable standing
authority, continuity and terminal safeguards, retaining only still-needed
operational markers under [Operational retention](#operational-retention).

## Safe Approval Templates

Use concise approval messages. Every template must name the source issue or PR,
owner thread, branch, head SHA when known, gate kind, route key, allowed side
effect, and required final report back to the parent. Every template must also
preserve issue scope, require current issue/PR/thread refetch before acting,
preserve branch continuity, forbid force-push, require relevant verification
gates for the delegated workflow, and require one verified final report back to
the parent. Apply Delivery and evidence above: keep intermediate work local,
combine related results, and send only actionable deltas with complete evidence
accessible by reference. Required current binding facts in an approval remain
complete; concise reporting never abbreviates approval validation.

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

Every monitor pass derives a complete current summary from reconciled ledger
items; replace the previous summary rather than accumulating pass reports:

- merged or closed items
- routed items
- approval/thread-state actions
- waiting items with reasons
- current owner evidence references
- source-issue status actions requested
- archived threads
- next check time

Keep this derived summary available for coordination and recovery even when no user
notice is selected. On a coordinated handoff, make the complete summary
available by evidence reference to `issue-batch-coordination`; send only the
coordination-relevant delta under Delivery and evidence above. The receiver
resolves required evidence before routing or selecting a user notice. Routine
owner progress stays in the owner, without an unsolicited coordinator copy.
On direct bounded invocation, present the

current requested result from this summary, including a read-only status
answer, actionable decisions or blockers with complete known gate facts, and
verified terminal batch completion without delivery. Apply the coordinator's
same concise notice and duplicate-event rules without invoking it back or
turning presentation into effect authority. A missing route,
gate, or recovery fact follows its existing wait or manual-action path; quiet
reporting cannot establish readiness. Keep reports summary-only. Do not paste
raw transcripts, raw logs, raw validation output, local `.ephemeral` paths, or
agent-local decision trails into shared PR or issue comments.

## Automation And Resume

For default execution watchdog setup or an explicitly selected coordinator
heartbeat, use
the coordinator's [watchdog operation](../issue-batch-coordination/references/watchdog.md)
for supported schedule and notification mechanics. A watcher observation is
non-authorizing evidence; this router retains its complete route, approval,
receipt, and terminal gates after reconciling current owner and provider facts.

When the host provides recurring automation or thread-management tools:

- carry known owner-thread mappings;
- reconcile newly created owner threads only for initial binding or a named
  uncertain creation result;
- update monitor instructions when routing rules change;
- avoid stale routes after resume or context compaction;
- stop or pause monitoring when the batch reaches a terminal state.

On heartbeat or compacted resume, first identify a concrete routing action,
delivered report, explicit user status request, initial binding need or named
uncertain operation. With none, yield without owner progress or gate discovery. For a concrete action, refresh only relevant
provider facts (source issue, branch, PR, CI, review threads, mergeability,
branch protection or bot signals) needed to validate its current route and
effect. Owner-thread reads require one of four bounded purposes: initial
binding, received-report validation, an explicit user status request, or
recovery of a concrete named uncertain operation. Each ends at its named
fact/result or exact unresolved gap; resume alone is not a read purpose.

Missing required freshness holds the affected action for its proper delivered
report or bounded validation, without polling or stale approval reuse. Retain
initial binding safeguards and terminal archival verification through received
terminal-report validation or recovery of a concrete uncertain cleanup
operation. Treat ledger entries as hints until relevant current evidence
revalidates their route keys. Apply Operational retention to remove positively
superseded claims and regenerate summaries, preserving unresolved operations
and evidence references at their owners.

## Common Mistakes

- Approving a plausible owner-thread gate without matching approval evidence for
  the same source issue or PR, head SHA/current state, gate kind, route key, and
  side effect.
- Treating GitHub issue numbers as the shared source model and losing Linear
  provider identity.
- Doing work that `## Provider And Workflow Boundaries` reserves for an owning
  workflow instead of routing to it.
- Treating source-issue reporting as generic issue mutation when no
  provider-specific owner workflow exists.
- Waiting for human merge approval before routing current repair gates such as
  merge conflicts, unresolved review threads, or failing CI.
- Routing the same unresolved review threads or failing check more than once
  because the route key omitted the digest or run/check identifier.
- Archiving an owner thread before terminal PR/source state and pending-work
  checks pass.

## Red Flags

Stop and re-route when:

- the current action instruction is broad, stale, or not bound to the route key;
- the PR head SHA changed without refreshing dependent gates and the action binding;
- unknown provider state is being translated into a GitHub or Linear status;
- a route would force-push, replace branch continuity, or bypass an owning
  workflow;
- archival is based on owner-thread text without live terminal-state evidence.
