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

### Suggested manifest fields

Each managed record should include:

- target
- type (`skill` or `agent`)
- source path
- generated path
- installed path
- install mode
- content hash
- timestamp

---

## Sync Steps

1. load config
2. validate source
3. render outputs
4. compute install plan
5. apply install plan
6. update manifest
7. print summary

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
