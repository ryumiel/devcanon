# GitHub push operation

Use this procedure for a new GitHub batch with explicitly authorized push
delivery on local macOS Codex Desktop. The
[workflow routing spec](../../../docs/specs/afds-workflow-routing.md#route-007-push-github-push-delivery)
owns the event and authority rules.

## Set up the receiver

1. Verify authorization for the repository subscription and notices to the
   existing coordinator and registered owners. Verify a supported local
   _queue-to-turn_ test in a disposable loaded Desktop chat on this Mac.
   Confirm the same UUID and a distinct turn. A successful queue command
   establishes submission only.
2. Use the coordinator's live ledger at a stable absolute path on the Mac. It
   must identify the expected repository and local coordinator. Put
   `"mode": "github_push"` into its existing `monitor` object under the
   coordinator's authority. Preserve the other monitor facts and applicable
   decisions. Make the relay's access read-only by contract. The relay
   rereads the ledger on delivery and never changes it. Owners can register
   as the batch progresses.
3. Create a private state directory for the batch outside the checkout,
   separate from the ledger. Run one receiver per coordinator, each with its
   own state directory, ledger path, port, HTTPS route, and secret. For multiple
   coordinators on one repository, configure disjoint issue scopes and
   keep each PR and owner branch bound to one batch item. The relay holds
   PRs that reference multiple issues in the repository. Create
   `config.json` there as described in the
   [relay CLI usage](github-push-relay-usage.md). Keep that state directory
   across receiver restarts. Use a fresh state directory for each new opt-in.

### Ledger fields

Use these fields in the existing ledger. The example shows just the fields
read by the relay. Preserve the coordinator's other records and authority.

```json
{
  "repository": "org/repository",
  "controller": {
    "host": "local",
    "thread_id": "01234567-89ab-4def-8123-456789abcdef"
  },
  "monitor": { "mode": "github_push" },
  "items": [
    {
      "source_issue_identifier": "github:org/repository#123",
      "source_state": "OPEN",
      "owner_thread_id": "12345678-9abc-4def-8123-456789abcdef",
      "owner_host_id": "local",
      "branch_name": "feat/123-example",
      "wait_reason": "external_event",
      "pr_identifier": "github:org/repository#125",
      "current_head_sha": "0123456789abcdef0123456789abcdef01234567"
    }
  ]
}
```

Use the real, distinct owner and coordinator UUIDs. Set the owner fields
after registration and the branch when verified. Record the PR when
associated. Use `OPEN` for an open GitHub issue. For review delivery, the
current wait must be `owner_result` or `external_event`. An absent or
incompatible required ledger field produces an actionable setup or
delivery error.

Create the secret and start the receiver using the
[relay CLI usage](github-push-relay-usage.md). Run it as the same macOS user
as Desktop. For launchd, pass absolute paths to Node.js, the packaged script,
the ledger, the state directory, `gh`, and `codex`.

Expose the loopback receiver through a durable HTTPS endpoint with TLS
verification. Register one GitHub repository webhook per instance for `issue_comment` and
`pull_request` with JSON content, the same secret, and the `/github` path.

To enable CI notices, set the optional numeric `ci_workflow_id` in
`config.json` to the repository's GitHub Actions CI workflow ID and add
`workflow_run` to that subscription. The relay accepts completed
`success` and `failure` outcomes for that workflow's PR runs. It verifies
the current open PR and exact head against the reported run. The owner gets one notice per run attempt. Cancelled, skipped,
stale, and ambiguous outcomes leave no notice. Restart the receiver after changing its
configuration.

Confirm that a signed ping succeeds and an unsigned request is rejected. Record
the accepted scope and the verified endpoint and delivery readiness in the
existing monitor state. A ping verifies ingress, while a matched recipient
turn verifies the wake. This mode uses no scheduled task or recurring GitHub
query.

## Reconcile delivery and stop

The relay queues a compact evidence notice. The owner verifies current-head
review evidence and reports through the existing owner path. For lifecycle
notices, the coordinator checks current provider facts and reconciles its
ledger once, including any result already reported by the owner.

Inspect receipts on demand with the
[relay CLI's `status` command](github-push-relay-usage.md#invocation).

A `queued` row gives the queue message ID. To verify a wake, match its GitHub
delivery ID, exact PR and head, and recipient UUID to a user input in a new
Desktop turn. Review receipts use the PR head and verdict in their identity. CI receipts
include the PR head, workflow ID, run ID, and attempt. Lifecycle
receipts use the PR action and, for closures, its occurrence time.

An `unresolved` or interrupted `received` row requires reconciliation before
any replay. Verify the queue or turn result and current GitHub and ledger
bindings. Keep an unknown result visible and avoid another send while its
delivery is ambiguous. The receipt guard stays in place for these attempts.
A failed ingress delivery with no attempted send can be redelivered once the
endpoint recovers. Use GitHub's delivery record for that bounded recovery.

On an authorized stop or batch closeout, disable the batch subscription and
verify its state, then stop the receiver. Record the outcome in the existing
monitor state. Keep any unresolved receipt needed to settle a delivery. Existing
owner reports continue under their original authority.
