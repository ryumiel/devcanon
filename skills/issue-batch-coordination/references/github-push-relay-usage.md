# GitHub push relay CLI

## Role

Receive signed GitHub webhook deliveries and queue evidence notices to recipients
bound to one opted-in coordinator ledger. Run an instance per coordinator.

## Invocation

```sh
node "$SKILL_DIR/scripts/github-push-relay.mjs" --help
node "$SKILL_DIR/scripts/github-push-relay.mjs" serve \
  --ledger "$LEDGER_PATH" --state-dir "$RELAY_STATE_DIR" --port 38762 \
  --gh "$(command -v gh)" --codex "$(command -v codex)"
node "$SKILL_DIR/scripts/github-push-relay.mjs" status \
  --ledger "$LEDGER_PATH" --state-dir "$RELAY_STATE_DIR"
```

## Inputs

Use Node.js 24 or later. Both commands require the coordinator's `--ledger`
path and a separate private `--state-dir` for this instance. For `serve`,
`--port` defaults to `38762`. The `--gh` and `--codex` options default to the
executables on `PATH`. The GitHub CLI must authenticate and read the selected
repository in the service's environment.

Place a `config.json` file in the state directory with the following fields.
Replace the examples with the opted-in scope and GitHub IDs. Omit
`ci_workflow_id` to disable CI notices.

```json
{
  "repository": "org/repository",
  "repository_id": 123456789,
  "issues": [123, 124],
  "base_branch": "main",
  "connector_id": 123456789,
  "connector_login": "chatgpt-codex-connector[bot]",
  "coordinator_thread": "01234567-89ab-4def-8123-456789abcdef",
  "ci_workflow_id": 987654321
}
```

For `serve`, store the GitHub webhook secret in `webhook.secret` in the
same directory. Generate at least 32 bytes of unique high-entropy key material
and keep it private. The relay verifies signatures against the trimmed UTF-8
contents of this file.

## Working directory

Run from any directory using absolute ledger, state, and script paths. The CLI
resolves relative arguments against the current working directory.

## Outputs

`serve` binds `POST /github` on loopback and prints the listening address.
`status` prints one JSON row per claimed notice. A `queued` row includes the
message ID returned by Codex. Use the delivery ID and target chat to verify
whether a Desktop turn started.

## Refusal and failures

The CLI refuses an invalid configuration or reuse of receipt state bound to a
different ledger, repository, or coordinator. The listener rejects invalid
signatures before reading the payload. It suppresses stale and ambiguous
routes. A verification error or ambiguous queue attempt returns HTTP 503.
An ambiguous send remains in the receipt database. Inspect it before replaying
the delivery.

## Side effects

`serve` reads the ledger and GitHub on incoming deliveries, writes delivery
receipts to its own SQLite database, and queues notices for matched recipients.
`status` opens the database read-only. Neither command changes the ledger,
registrations, or GitHub data.

## Workflow boundary

The [coordination skill](../SKILL.md) selects the monitor mode and owns recipient
authorization. The [GitHub push operation](github-push.md) covers provisioning,
turn verification, reconciliation, and shutdown.
