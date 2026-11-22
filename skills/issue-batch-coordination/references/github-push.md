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
   separate from the ledger. Create `config.json` there using the shape
   below and replace the example values. Obtain the repository ID and
   Connector account ID and login from GitHub. Preserve the state directory
   across receiver restarts while its duplicate guards and unresolved
   deliveries are needed.

```json
{
  "repository": "org/repository",
  "repository_id": 123456789,
  "issues": [123, 124],
  "ledger": "/absolute/path/to/batch/ledger.json",
  "base_branch": "main",
  "connector_id": 123456789,
  "connector_login": "chatgpt-codex-connector[bot]",
  "coordinator_thread": "01234567-89ab-4def-8123-456789abcdef"
}
```

Create `webhook.secret` inside that directory with a unique high-entropy secret
of at least 32 bytes. Keep the secret private. Start the script packaged with
this skill using Python 3.9 or later and the same macOS user as Desktop. If
supervising it with launchd, pass the absolute paths to Python, the packaged
script, `gh`, and `codex`. The GitHub CLI must authenticate and read the
repository from that service context.

```sh
python3 "$SKILL_DIR/scripts/github-push-relay.py" serve \
  --state-dir "$RELAY_STATE_DIR" --port 38762 \
  --gh "$(command -v gh)" --codex "$(command -v codex)"
```

Expose the loopback receiver through a durable HTTPS endpoint with TLS
verification. Register one GitHub repository webhook for `issue_comment` and
`pull_request` with JSON content, the same secret, and the `/github` path.
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

Inspect receipts on demand:

```sh
python3 "$SKILL_DIR/scripts/github-push-relay.py" status \
  --state-dir "$RELAY_STATE_DIR"
```

A `queued` row gives the queue message ID. To verify a wake, match its GitHub
delivery ID, exact PR and head, and recipient UUID to a user input in a new
Desktop turn. Review receipts use the PR head in their identity. Lifecycle
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
