# Issue Batch Routing Reports

Read this procedure when `issue-batch-routing` or an owning workflow invokes review-response and a review-response approval-gate, blocker, pushed-head, verification, or thread-disposition report is due.

When invoked by `issue-batch-routing` or an owning workflow, this workflow
produces issue-batch-routing reports for review-response plan approval gates,
pre-push approval gates, PR-update or review-response closeout blockers, pushed
head and verification result reports, and review-thread disposition reports.
These are supporting evidence families, not separate message obligations.
Keep routine corrections, intermediate tests, review preparation, recoverable
errors and unchanged waits local. Complete bounded authorized recovery without
an acknowledgement checkpoint; exhausted recovery reports the exact intervention
required. Deliver findings directly to the authorized implementation owner,
preserving reviewer independence and messaging authorization. Do not copy the
coordinator unless it has a distinct action.

Apply `issue-batch-routing`'s Delivery and evidence contract. Send one compact
delta for a required coordinator action, dependency readiness, exhausted
recovery, a material change affecting pending action or recorded readiness, or
verified completion. Combine pushed-head, verification and disposition results
into that useful handoff where possible, but promptly invalidate readiness for
an old head when a pending action or recorded readiness depends on it. Include
provider-tagged issue/PR identity, owner, applicable current head, changed state,
requested action and an accessible evidence reference. Keep full evidence local;
the consumer resolves and validates every required fact before acting. Missing,
stale or inaccessible evidence holds the dependent action, never implies PASS.
Explicit status requests remain answerable from current evidence.

Every complete supporting report should include the source provider, source issue identifier,
current feedback-source state, delegated owner-thread identity when known,
branch, PR provider and identifier, head SHA, gate kind, relevant complete
review-response route key, blocking evidence, intended or completed external
actions, thread disposition, verification result, requested parent action, and
next safe command or workflow.

For a review wait, name the exact expected event, such as a new review result
on the current PR head, or the supported authorized trigger and its owning
workflow. After a no-code reply, the owner decides whether a fresh-review
request is needed and whether current authority and host capability support it.
Report a concrete missing authority or capability when they do not. A posted
reply does not mean a new review is running; do not imply a watcher will repeat
requests or a reviewer will respond. Confirmed Connector quota/unavailability
is forwarded to the coordinator for one reconciled independent fallback under
ROUTE-007-REVIEW; pending eyes alone is insufficient. Report the complete
current verdict or the precise missing evidence, not task creation as approval.
For a changed head, retain classification, retained covered authority, concrete
pre-push summary, validation, local/pushed head, and the needed or completed
independent scope-selected follow-up in the referenced report so the router
refreshes its action binding before acting.
Do not request generic renewed publication/merge permission for a covered
in-scope correction; genuine scope/authority gaps still stop. A thumbs-up is
review evidence for the owner and router to reconcile, not merge authority or proof that current-head,
CI, protection, and unresolved-feedback checks passed. Keep those checks with
the owning merge and routing workflows.

Reports that name only a source issue or PR identity without provider-tagged
source identity are incomplete for mixed-batch reconciliation; the router or
owning workflow should wait or request manual action instead of accepting
PR-only disposition.

This workflow does not own merge, source-issue status mutation, or generic CI
repair outside review-response scope. Those cases become parent/manual-action
reports or routes to the workflow that owns the specific gate.
