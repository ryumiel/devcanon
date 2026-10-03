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

Reports that name only a source issue or PR identity without provider-tagged
source identity are incomplete for mixed-batch reconciliation; the router or
owning workflow should wait or request manual action instead of accepting
PR-only disposition.

This workflow does not own merge, source-issue status mutation, or generic CI
repair outside review-response scope. Those cases become parent/manual-action
reports or routes to the workflow that owns the specific gate.
