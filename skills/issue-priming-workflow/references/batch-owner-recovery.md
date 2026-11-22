# Interrupted Batch Owner Recovery

Use receipts for interrupted-owner continuation and recovery, not routine
per-step reporting or acknowledgement checkpoints. An active authorized owner
keeps intermediate evidence local and continues work. When recovery needs a
receipt, all identity, freshness, provenance and sequence requirements below
remain mandatory, including when complete evidence travels by reference.
The [router's receipt validation](../../issue-batch-routing/SKILL.md#unfinished-non-gate-progress-receipts)
owns the controller's acceptance and continuation decision.

Before initial continuation, the controller records the current route binding
from its existing approved-route facts. Before resumed continuation, the
controller refreshes that binding from its current approved-route facts. It
retains the highest accepted progress sequence for each exact route still needed
under issue-batch-routing’s Operational retention rules. A changed binding alone
cannot clear an earlier guard; a delayed receipt for a retired or unknown route
cannot recreate authority or reset its sequence. Only after that may
a producer emit a receipt. An unfinished non-gate progress receipt must identify the exact
approved owner route, the source provider and source issue identifier, the
delegated owner-thread identity, and the selected preparation kind and exact
handoff provenance defined in [Issue Batch Routing Reports](../SKILL.md#issue-batch-routing-reports). A changed kind or identity changes route
facts; missing or mixed provenance uses the incomplete or gate path. It must
also carry a positive, strictly increasing per-route
progress sequence. Before the first receipt and after every accepted receipt,
the controller's continuation dispatch supplies the route's acknowledged next
required sequence and refreshed source-issue state snapshot digest; echo both
values and never infer them from resumed or compacted owner-thread state.
Missing acknowledgement must use the incomplete or gate path rather than
emitting a receipt. It must provide evidence
that the named non-gate work remains unfinished and stays within that route's
current issue authority. Include the current route identity already held by the
controller and the branch, PR, and head facts when known, plus the refreshed
source-issue state snapshot digest acknowledged by the controller, so the router
can match the receipt to the existing owner route. When a branch or PR exists,
include its refreshed current head SHA;
missing or mismatched head evidence is stale and must use the incomplete or
gate path; the receipt cannot establish or self-authenticate that binding.
Missing or mismatched source-state evidence is likewise stale and must use the
incomplete or gate path.
For a batch-routed handoff, the receipt's source issue identifier must be the
unchanged `payload.batch-source-issue-identifier`; never substitute the
provider-native `payload.identifier`. Missing or changed paired batch context
must use the incomplete or gate path rather than emitting a receipt.

This is progress evidence for the existing route, not a new authority gate,
approval request, ledger schema, or authorization for provider mutation. If the
identity, provenance, or unfinished non-gate evidence is absent, report the
condition through the existing incomplete or gate path instead of emitting a
progress receipt.
