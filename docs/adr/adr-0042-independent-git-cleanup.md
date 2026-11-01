# ADR-0042: Separate Git cleanup from host attachment reconciliation

## Status

Accepted

## Context

Host-managed worktrees have two owners of state: Git owns checkout registration
and refs, while the host owns chat attachments and recoverable archives. Archive
capabilities can exclude otherwise disposable Git checkouts, including those
with initialized submodules. Requiring attachment reconciliation first leaves
completed resources indefinitely retained despite an authorized safe Git path.

## Decision

Allow guarded Git removal of completed, released worktrees under retained
cleanup authority, independent of attachment reconciliation. Preserve exact
resource identities and report Git and host outcomes separately. A host's
unsupported archive capability is not itself a Git protection rule.

Keep active consumers, explicit retention, mandatory host instructions, actual
Git primary checkouts, locks, unique work and nested-repository guards binding.
Reconcile issued removal operations before selecting another mechanism; an
unknown archive outcome cannot be treated as a terminal refusal.

The [workflow spec](../specs/afds-workflow-routing.md#route-007-cleanup-completed-owner-cleanup)
owns lifecycle requirements and the
[runtime spec](../specs/passive-runtime.md#targeted-local-cleanup) owns Git behavior.

## Consequences

Completed Git cleanup can leave a stale host attachment. The controller retains
that explicit metadata obligation and reconciles it only through supported host
operations. Direct disposal provides no recoverable app snapshot. Cleanup never
uses private app state or claims host reconciliation from filesystem absence.

Explicit generated-output designations permit precise disposal without treating
all ignored files as disposable. Unknown data and active work remain protected.

## Alternatives considered

- Require host archival before all removal: retains completed checkouts when
  archive capabilities are narrower than Git's safe removal capabilities.
- Delete attachments through private host APIs: couples portable cleanup to
  unsupported internals and cannot establish a reliable ownership boundary.
- Force removal of all ignored or nested content: discards the preservation
  guards needed for safe cleanup.
