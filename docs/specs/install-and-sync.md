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
2. accept the manifest and validate its boundary and record identity
3. perform selected legacy reconciliation and binding as record-only state
4. validate source
5. render outputs
6. compute and adapt the install plan for current-invocation reconciliation protection
7. apply install plan
8. update manifest
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

- [Configuration](configuration.md) -- install mode and overwrite policy defaults
- [Target mapping](target-mapping.md) -- generated output rules
- [CLI commands](cli-commands.md) -- `sync` and `diff` command details
- [Platform](platform.md) -- symlink requirements and path rules
