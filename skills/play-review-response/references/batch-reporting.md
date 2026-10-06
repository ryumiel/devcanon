# Issue Batch Routing Reports

Read this procedure when `issue-batch-routing` or an owning workflow invokes review-response and a review-response approval-gate, blocker, pushed-head, verification, or thread-disposition report is due.

When invoked by `issue-batch-routing` or an owning workflow, this workflow
produces issue-batch-routing reports for review-response plan approval gates,
pre-push approval gates, PR-update or review-response closeout blockers, pushed
head and verification result reports, and review-thread disposition reports.

Every report should include the source provider, source issue identifier,
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
For a changed head, report classification, retained covered authority, concrete
pre-push summary, validation, local/pushed head, and the needed or completed
independent scope-selected follow-up so the router refreshes its action binding.
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
