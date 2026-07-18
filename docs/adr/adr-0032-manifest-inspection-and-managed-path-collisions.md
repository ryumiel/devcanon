# ADR-0032: Manifest Inspection and Managed Path Collisions

## Status

Accepted

## Context

The install manifest authorizes management of user-home outputs. A read of its
pathname must therefore not quietly turn invalid bytes into empty authority or
perform recovery as a side effect. Recovery also has two independent results:
the invalid source may be retired successfully while release of the cooperating
lock is degraded. Those results need a durable public policy before later
runtime work chooses private helpers.

Distinct managed identities can also resolve to nested installed paths. Exact
path comparison misses a file-or-directory collision, while a blanket
prohibition on nested configured homes rejects safe invocations. The collision
decision must respect the full manifest identity and the record-only protection
of foreign records established by reconciliation.

[ADR-0031](adr-0031-manifest-ownership-and-save-serialization.md) owns the
four-home, full-tuple identity; exact verified-backup authority; cooperating
locks; freshness; and the external-writer limitation. The [install and sync
policy](../specs/install-and-sync.md) and [CLI command specification](../specs/cli-commands.md)
own public behavior. The [architecture overview](../arch/overview.md) remains
a non-normative consumer. Runtime source remains the executable authority.

## Decision

### Inspect before authorizing work

Manifest inspection is pure and returns exactly one observation:

| Observation | Meaning                                                              | Authority granted            |
| ----------- | -------------------------------------------------------------------- | ---------------------------- |
| `valid`     | A readable regular manifest has valid bytes and schema.              | Its accepted manifest state. |
| `absent`    | The source and its exact sibling lock both produce trusted `ENOENT`. | Empty-manifest authority.    |
| `invalid`   | The source or lock cannot support either earlier observation.        | None.                        |

Path appearance is not ownership, and invalid bytes are not empty authority.
Trusted absence requires a trusted `ENOENT` observation for both the manifest
source and its exact sibling lock. A residual lock, unreadable path, symlink,
directory, unsafe lock, or any other untrusted observation is invalid and fails
actionably. Inspection itself performs no recovery, write, unlink, backup, or
lock mutation.

Only non-dry `sync` and `uninstall` may explicitly recover invalid manifest
state. `diff`, `doctor`, and every dry operation inspect only. The public
outcomes, warnings, and exit behavior are owned by the behavior specifications.

### Recovery has one commit and independent cleanup status

An invalid-state recovery follows these durable states. They name required
authorization boundaries, not a prescribed helper shape or private algorithm.

| State | Required boundary                                                   |
| ----- | ------------------------------------------------------------------- |
| I0    | Invalid observation is retained; it is not interpreted as absence.  |
| I1    | The exact sibling cooperating lock is acquired.                     |
| I2    | A candidate backup is allocated and written exclusively.            |
| I3    | The candidate is verified as the exact invalid bytes.               |
| I4    | The invalid source is freshly verified against that observation.    |
| I5    | The invalid source is successfully unlinked: recovery is committed. |
| I6    | Lock-handle close is attempted.                                     |
| I7    | Lock-path unlink is attempted.                                      |

Before I5, recovery is unrecovered in exactly these categories:

- source changed;
- lock unavailable;
- source unavailable or unsafe;
- backup create or verification failed, including suffix exhaustion; and
- source retirement failed.

An unrecovered category never authorizes successful-backup wording, empty
authority, install, removal, rendering, or a retry against the same
observation. There is no rollback or source recreation after I5.

On every post-I1, pre-I5 exit, recovery attempts real owned lock-handle close
and exact owned lock-path unlink as the reached phase permits. The close and
unlink attempts are independent, including unlink after a close failure.
Secondary cleanup degradation is recorded and reported without masking or
replacing the primary unrecovered category, and does not create a sixth
category. Reporting preserves phase-accurate source/current replacement,
occupied sibling, verified or incomplete candidate, and residual-lock state; it
does not imply unconditional release or automatic lock reclaim.

After I5, cleanup status is orthogonal to the commit: `clean`,
`close-degraded`, `unlink-degraded`, or `both-degraded`. A clean recovery may
continue. Any degraded recovery stops the command after its warning and before
render, install, remove, no-op, or manifest save. A failed close with a
successful lock unlink permits a later fresh observation of source and lock
absence. A lock-unlink failure leaves a blocking residual lock; after the
operator establishes inactivity, only manual removal of that exact lock path
can clear it. No same-observation retry is permitted.

### Classify ownership before validating managed path collisions

An invocation first inspects purely. For a non-dry invalid manifest, explicit
recovery disposition follows, and only recovered-clean state may continue.
It then normalizes and classifies accepted state; applies the ownership
disposition and foreign-record policy; reconciles authorized foreign records
record-only; partitions accepted records and selected outputs into active and
passive invocation scope; and validates component-aware installed-path
collisions before legacy binding or save, writable render, plan construction,
printing, execution, managed-output mutation or removal, and the final manifest
save.

Distinct accepted tuples conflict when their installed paths are equal or one
is a lexical component ancestor or descendant of the other, and at least one
identity is active. The same full tuple is allowed. Component-prefix siblings,
such as `foo` and `foobar`, do not overlap. Passive-passive pairs outside the
targeted invocation are nonblocking. Target filtering determines activity; it
does not alter full-tuple identity or ownership.

Reconciled-away foreign records are excluded from collision validation. Their
paths remain invocation-local protected physical paths for reconciliation, so a
planned mutation at an overlapping path is still blocked. Collision validation
and reconciliation protection are separate safeguards; neither expands foreign
record ownership.

### Contract examples and boundary

The canonical examples are: a valid regular manifest; trusted source-and-lock
absence; invalid malformed bytes; an exact verified recovery backup; identical
full tuples; `foo` and `foobar` prefix siblings; an active nested-path
collision; passive-passive identities; and a reconciled-away foreign record
whose physical path remains protected. Each invalid example changes exactly one
named dimension unless explicitly described as multi-fault, and all derived
fields remain consistent with its source state. Unsupported or inconsistent
examples block rather than invite inferred authority.

This decision excludes realpath, inode, case-folding, and external-race example
families. It does not promise protection from an uncooperative external writer
or prescribe filesystem transactions, compare-and-swap architecture, recovery
flags, schema changes, or private helper algorithms.

## Consequences

- Read-only consumers can report invalid state without changing it, and dry
  operations remain dry with respect to manifest recovery.
- A verified allocated backup path is meaningful only after recovery commits;
  cleanup degradation remains visible instead of being mistaken for rollback.
- Operators receive a bounded manual procedure for residual locks rather than
  an automatic stale-lock deletion policy.
- Collision validation catches exact and nested managed destinations while
  allowing same tuples, component-prefix siblings, and irrelevant passive
  pairs.
- Record-only reconciliation continues to protect foreign physical paths during
  the current invocation without treating them as collision-owned records.

## Alternatives considered

- **Use a default-mutating read facade.** Rejected because observation would
  silently change user-home state and make dry consumers unsafe.
- **Treat invalid as absent.** Rejected because malformed or unsafe state is
  not authority to replace a manifest.
- **Give sync and uninstall separate recovery semantics.** Rejected because the
  same invalid state would have contradictory lifecycle guarantees.
- **Validate literal path equality only.** Rejected because nested outputs can
  collide even when their path strings differ.
- **Prohibit all nested configured homes.** Rejected because it is broader than
  the managed identities active in one invocation.
- **Add recovery flags or a manifest schema change.** Rejected because the
  required recovery choice belongs to existing non-dry destructive commands.
- **Adopt a generalized filesystem transaction or compare-and-swap design.**
  Rejected because it would imply a broader external-writer guarantee than the
  cooperating-writer boundary owned by ADR-0031.
