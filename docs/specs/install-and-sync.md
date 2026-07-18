# Install and Sync Policy

---

## Breaking Rename From agents-manager

DevCanon does not support legacy `agents-manager` CLI, config, env-var, or
manifest names. Existing users must uninstall with the old CLI before
installing DevCanon:

```sh
agents-manager uninstall
```

After installing DevCanon, use:

```sh
devcanon sync
```

---

## Ownership Model

`devcanon` owns only files and directories it installed as managed
outputs.

---

## Manifest

Manifest is authoritative for tracking installed outputs.

Default path:

```text
~/.devcanon/manifest.json
```

### Required bound manifest record fields

Each bound managed record must include:

- name
- target
- type (`skill` or `agent`)
- source path
- generated path
- installed path
- install mode
- content hash
- timestamp

### Manifest identity and boundary

The canonical manifest boundary is the normalized tuple of all four configured
homes: Claude skills, Claude agents, Codex skills, and Codex agents. `name` is
schema-optional only so legacy manifests remain readable: every bound record
must include it, while an unbound legacy record must omit it. Identity
normalization derives the legacy name from its target-native installed
destination before a manifest is bound.

A managed record is classified by its complete target, type, name, owning home,
and exact target-native destination. Exact installed-path equality is only the
destination dimension of that full identity; path equality, path appearance,
filesystem presence, filesystem absence, and a missing output alone never prove
ownership. Records are not shared across home tuples.

A manifest bound to a different home tuple fails closed before rendering,
generated-output writes, installed-output changes, or manifest mutation. It
cannot be repurposed with reconciliation. A bound manifest with foreign records
also fails closed; restore its matching homes or repair it from a verified
backup.

Only an unbound legacy manifest may be reconciled. `sync --reconcile-manifest`
removes foreign records from that legacy manifest and binds the retained
records; it never deletes, rewrites, or otherwise changes the foreign installed
outputs. Its dry run previews reconciliation and installation work without
writing, deleting, or creating a backup. `diff` and `uninstall` consume the
same classification: they direct an unbound mixed legacy manifest to
reconciliation and reject bound foreign records.

For the current reconciliation invocation only, the physical paths of removed
foreign records are lexically normalized and protected from a later planned
`install`, `update`, `force-overwrite`, or `remove`. This collision protection
does not alter ownership classification and is discarded when sync returns or
throws. Each protected physical mutation reports a reconciliation-specific
`skip-conflict`; `skip-up-to-date`, existing `skip-conflict`, and
`remove-missing` remain unchanged. Explicit force and configured
`overwrite-all` therefore cannot overwrite a protected file or tree; dry run
previews the conflict before any write, and real sync neither changes the
output nor adds a replacement record.

During sync, the resolved manifest path and its exact resolved sibling lock
are reserved persistence control paths. After foreign-record disposition and
record-only reconciliation, every active retained or selected managed
destination is rejected when it equals, contains, or is contained by either
control path. Passive records outside a targeted invocation do not reserve
controls by themselves. Control paths are not managed tuples and receive no
target, type, name, record, or same-tuple allowance. This component-aware
lexical gate completes after read-only output projection and before legacy
binding or save, writable rendering, plan construction or preview, force or
overwrite execution, result success, or final manifest save.

### Inspection and invalid-state recovery

Manifest inspection is pure: it classifies the manifest as `valid`, `absent`,
or `invalid` without creating a lock, backup, replacement, or other mutation.
`absent` is trusted only when both the source and its exact sibling lock return
trusted `ENOENT`. A residual lock, unreadable source, symlink, directory,
unsafe lock, malformed bytes, schema-invalid bytes, or another untrusted
observation is `invalid`; it is not empty-manifest authority.

Only non-dry `sync` and `uninstall` may recover `invalid` state. They must
acquire the exact sibling cooperating lock, allocate and verify a backup of the
exact invalid bytes, verify source freshness, and successfully unlink the
invalid source before recovery commits. Successful invalid-source unlink is the
commit point. There is no rollback, source recreation, or retry against the
same observation.

Before that commit, source-changed, lock-unavailable, source-unavailable or
unsafe, backup-create or verification failure (including suffix exhaustion),
and source-retirement failure are unrecovered. They fail actionably and never
authorize successful-backup wording, empty authority, rendering, installation,
removal, no-op success, or a manifest save.

Every unrecovered result preserves that primary category and cause alongside
closed, structured artifact custody. Candidate custody is `none-created`,
`owned-removed`, `retained-unverifiable`, `retained-owned`, or
`retained-replacement`; every state other than `none-created` includes the
exact candidate path. Sibling-lock custody is
`not-inspected-or-not-owned`, `pre-existing-blocker`, `owned-removed`, or
`retained-owned`, with the exact sibling-lock path. A pre-stat candidate is
retained as unverifiable and is never unlinked by pathname alone. An
identity-bound candidate may be reported removed only after exact owned
cleanup; cleanup failure retains it as owned, while a changed pathname
identity is retained as an unmanaged replacement. A pre-existing lock is
never reported as owned, and an acquired lock is reported removed only when
its exact path is absent after the unlink attempt.

On each post-I1, pre-I5 exit, recovery attempts real owned lock-handle close
and exact owned lock-path unlink as the reached phase permits. The attempts are
independent, including unlink after close failure. Any secondary cleanup
degradation is recorded and reported without masking or replacing the primary
unrecovered category, and is not a sixth category. Reporting preserves
phase-accurate source/current replacement, occupied sibling, verified or
incomplete candidate, and residual-lock state; it neither promises
unconditional release nor automatically reclaims a lock.

After commit, cleanup independently attempts lock-handle close and exact
lock-path unlink. Recovery is `clean`, `close-degraded`, `unlink-degraded`, or
`both-degraded`. A clean recovery warns with the exact verified allocated backup
path and continues. A degraded recovery warns with that exact committed backup
path, then exits 1 before render, install, remove, no-op, or manifest save.
A close failure followed by successful lock unlink permits a later fresh
source-and-lock absence observation. Failed lock unlink leaves a blocking
residual lock; after the operator establishes inactivity, manual removal of the
exact lock path is required.

Dry `sync`, dry `uninstall`, and `diff` inspect only: they never recover or
mutate, and invalid or residual-lock state fails actionably with exit 1.
`doctor` inspects only and reports manifest invalidity through its existing
warning path rather than a healthy result; its overall exit behavior remains
unchanged unless another check independently reports an error.

### Managed component collisions

An invocation first inspects purely. For a non-dry invalid manifest, explicit
recovery disposition follows, and only recovered-clean state may continue. It
then normalizes and classifies accepted state; applies the ownership disposition
and foreign-record policy; reconciles authorized foreign records record-only;
partitions accepted records and selected outputs into active and passive
invocation scope; and validates installed-path collisions before legacy binding
or save, writable render, plan construction, printing, execution, managed-output
mutation or removal, and the final manifest save. Reconciled-away foreign
records are excluded from this validation, but their invocation-local physical
path protection remains separate and continues to block planned mutation.

Distinct accepted full tuples conflict when installed paths are equal or have a
lexical component ancestor/descendant relationship and at least one identity is
active. The complete tuple, including the configured four-home boundary,
remains the ownership identity described above. The same tuple is allowed.
`foo` and `foobar` are component-prefix siblings, not overlapping paths.
Passive-passive pairs outside the targeted invocation are nonblocking. Target
filtering determines activity and never turns a foreign record into owned
state.

Canonical examples are a same-tuple repeat, a `foo`/`foobar` pair, an active
`foo`/`foo/bar` collision, a passive-passive pair, and a reconciled-away foreign
record whose path remains protected. Invalid examples change one named
dimension unless they are explicitly multi-fault; unsupported or inconsistent
examples fail rather than authorizing a guess. Realpath, inode, case-folding,
and external-writer race families are outside this contract.

### Migration, removal, and backup safety

Before an existing legacy manifest is migrated (including a non-empty legacy
manifest) or records are removed, DevCanon creates exactly one byte-verified
original-state backup for that top-level operation. The backup name appends
`.backup-YYYY-MM-DDTHH-mm-ss.SSSZ` to the manifest filename; if occupied, it
uses the first deterministic numeric suffix (`-1`, `-2`, and so on). That one
original-state backup authorizes every record removal and later manifest save in
the same operation, without duplicate backups.

This authority is scoped to one manifest path and one sync or uninstall
operation. It advances only after accepted descendant saves and expires on both
return and throw. Manifest drift, freshness or verification mismatch, a wrong
path or operation, and persistence failures fail closed rather than permitting
a rewrite.

Missing stale records can be pruned only after target-home containment and
symlink-parent identity validation, with the output itself allowed to be
missing. A missing or temporary-looking path alone never proves ownership.
Matching and repeated runs are idempotent: they do not create unnecessary
backups or manifest churn.

---

## Sync Steps

1. load config
2. inspect the manifest purely
3. for invalid state, stop dry sync without recovery; non-dry sync performs
   explicit recovery, and only recovered-clean state continues. Every
   pre-I5-unrecovered or recovered-cleanup-degraded result stops before each
   later effect.
4. normalize and classify accepted state, apply foreign-record policy,
   reconcile authorized foreign records record-only, then partition accepted
   records and selected outputs into active/passive invocation scope and reject
   component-aware managed and manifest-control collisions
5. perform any required legacy binding or save
6. validate source and perform writable render
7. construct, print, and execute the install plan with reconciliation
   protection as applicable
8. perform the final manifest save
9. print summary

---

## Default Install Mode

- default: `symlink`
- Windows fallback: `copy`

---

## Overwrite Policy

Supported policies:

- `skip-existing`
- `overwrite-managed`
- `overwrite-all`

Default:

- `overwrite-managed`

---

## Conflict Policy

- unmanaged files are never overwritten by default
- managed files may be replaced during sync
- unmanaged conflicts require explicit force behavior to overwrite
- a same-sync path protected by legacy reconciliation remains a conflict even
  with explicit force or `overwrite-all`
- deleted managed outputs may be cleaned up if manifest tracking confirms
  ownership

## Managed Output Identity

Before replacing or removing a manifest-managed output, DevCanon verifies that
the installed path still matches the manifest record for the configured target
home and recorded install mode.

Identity verification checks:

- the installed path is a strict child of the configured target home for the
  record's target and type
- user-controlled ancestors of the target home, the target home itself, and
  parent path components under the target home do not cross symlink escapes
- symlink installs are still symlinks to the expected generated or source path
- copy installs still hash to the manifest record's content hash
- update actions still match the manifest record's target, type, installed
  path, and recorded install mode; source and generated path drift alone does
  not fail identity, because the manifest record verifies the existing
  installed artifact before current rendered paths replace the record

Identity failures skip the destructive update or removal, report an actionable
error, and keep the manifest record intact. Force overwrite behavior does not
turn a managed-output identity failure into an unmanaged overwrite.

When a symlink install falls back to copy, the manifest records the actual copy
install mode. Later updates verify the existing copied output as a copy before
attempting the requested replacement mode again.

Copy-mode skill identity preserves symlink spelling for new copies. Legacy
copies whose mirrored relative symlink targets were rewritten to absolute paths
may still verify when the absolute targets can be traced back under the recorded
generated or source root. If the original symlink spelling can no longer be
reconstructed without unbounded guessing, identity verification fails closed and
keeps the manifest record.

During uninstall, a valid manifest record whose installed path is already
missing is treated as removed only after target-home containment and symlink
escape checks pass. Missing paths outside the configured target home or behind
symlinked parent components remain identity failures and keep the manifest
record intact.

---

## Partial Failure Policy

If multiple targets are requested and one fails:

- report success and failure per target
- exit with non-zero status if any requested target failed

---

## Uninstall

`devcanon uninstall` removes managed outputs recorded in the
manifest. The command is symmetric to `sync` for tool retirement and
target wipes.

Behavior:

- The manifest is the only source of truth for what gets removed.
  Source files under `skills/` and `agents/` are never touched.
- Records are filtered by `--target` when provided; otherwise all
  records are processed.
- `--dry-run` previews the plan without modifying the filesystem or
  manifest.
- Per-record I/O failures are accumulated in the result's `errors[]`
  array; the loop continues. The manifest is still updated with the
  records that were successfully removed.
- An empty manifest (or empty target-filtered set) is a no-op that
  prints `Nothing to remove.` and exits 0.
- After a full uninstall the manifest file remains in place with
  `records: []`. It is not deleted.

The `cleanManagedOutputs` config flag does not affect `uninstall` —
that flag gates _implicit_ cleanup during sync; uninstall is always
explicit.

---

## See also

- [ADR-0032](../adr/adr-0032-manifest-inspection-and-managed-path-collisions.md)
  -- inspection, recovery, and component-collision decision
- [ADR-0031](../adr/adr-0031-manifest-ownership-and-save-serialization.md)
  -- tuple identity, backup authority, locking, and freshness
- [Configuration](configuration.md) -- install mode and overwrite policy defaults
- [Target mapping](target-mapping.md) -- generated output rules
- [CLI commands](cli-commands.md) -- `sync` and `diff` command details
- [Platform](platform.md) -- symlink requirements and path rules
