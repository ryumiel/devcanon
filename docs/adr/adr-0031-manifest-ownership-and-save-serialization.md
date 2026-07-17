# ADR-0031: Manifest Ownership and Save Serialization

## Status

Accepted

## Context

Manifest changes can remove records, reconcile legacy state, and authorize
later changes to installed outputs. A pathname by itself cannot safely answer
whether a record is managed: the same destination can be described by
different targets, types, or names, and a destination can belong to a
different configured target-home boundary.

The same transition also needs evidence that it may replace durable manifest
state. A sequence such as reconciliation, stale-record cleanup, and a final
save is one operation, not unrelated opportunities to recreate or discard the
original state. Interleaved cooperating writers and filesystem drift make
unchecked destructive transitions unsafe. Reconciliation has a further
constraint: correcting foreign records must not become authority to mutate the
foreign physical paths they name.

These are one authorization problem: what evidence lets DevCanon treat a
manifest record as owned and destructively transition the manifest that carries
that ownership? The [install and sync policy](../specs/install-and-sync.md)
owns the public behavior, and the [architecture overview](../arch/overview.md)
is the non-normative topology. Runtime source remains the executable authority.

## Decision

Canonical manifest ownership is the normalized tuple of the four configured
target homes together with each record's complete target, type, name, and exact
target-native destination identity. `installedPath` is only one destination
dimension of that identity; it never establishes ownership on its own. Schema
validity and boundary identity are separate gates, so a structurally valid
manifest still fails closed when its configured-home boundary or record
identity is not accepted.

Before migrating an existing legacy manifest or removing existing records,
including through reconciliation, pruning, or stale cleanup, a top-level
operation must establish one operation-scoped authority from the exact original
bytes and one verified original-state backup. Once acquired, that same
authority and backup are reused across the operation's subsequent
reconciliation, cleanup, and final saves. The authority is bound to the
manifest path and operation, and expires when that operation returns or throws.

An ordinary additive or identity-preserving save does not require backup
authority solely because it writes the manifest. It remains subject to boundary
and identity validation, locking, freshness, and atomic-save constraints.

Cooperating DevCanon writers serialize this authority with an exclusive sibling
lock. Before each destructive descendant transition, current state must remain
fresh relative to the authority's accepted state. Backup verification, lock
acquisition, identity validation, or freshness drift fails closed rather than
authorizing a replacement or removal.

Legacy reconciliation is record-only. It may remove foreign records from the
manifest state, but does not authorize deletion, overwrite, or other mutation
of the foreign physical paths. Those paths remain protected for the current
sync invocation, including from otherwise explicit overwrite choices.

## Consequences

- Manifest ownership is not inferred from filesystem appearance, path equality,
  or a missing output; the configured boundary and complete record identity
  must both be accepted.
- When migration or record removal requires backup authority, one verified
  backup preserves recoverable original state without creating independent
  backups for later steps in the same operation.
- Cooperating saves are serialized, and a changed or unverifiable manifest
  aborts the destructive transition instead of continuing on stale evidence.
- Reconciliation can repair manifest records without claiming ownership of
  paths that belonged to foreign records in that invocation.
- The guarantee is bounded to cooperating writers and detected drift. It does
  not provide portable linearizability against an uncooperative external writer
  using the same credentials; that threat needs separately owned hardening.

## Alternatives considered

- **Use `installedPath` as the ownership identity.** Rejected because a
  destination alone cannot distinguish target, type, name, or the configured
  home boundary that makes a record eligible for managed mutation.
- **Delete and rebuild the manifest, or rewrite it without an
  identity-verified original backup.** Rejected because it loses the exact
  recoverable state that makes a destructive transition accountable.
- **Create independent backups for each reconciliation, cleanup, or save
  step.** Rejected because one operation has one original state; repeated
  backups add churn and make authority lifetime ambiguous.
- **Use no lock and accept last-writer-wins saves.** Rejected because
  cooperating operations could interleave backups, removals, and replacements
  without a shared authority or freshness chain.
- **Treat reconciliation or force overwrite as authority to mutate foreign
  paths.** Rejected because classifying a record as foreign removes managed
  ownership rather than expanding physical-path authority.
- **Introduce a generalized filesystem transaction or compare-and-swap
  design here.** Rejected because the present decision records the current
  cooperating-writer boundary. Broader protection against uncooperative
  pathname races requires a separate threat model and owning architecture.
