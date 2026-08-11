# Snapshot Manifest Recipe

The [write-snapshot-manifest usage](write-snapshot-manifest-usage.md) is the
sole executable construction, input, and failure contract. This reference owns
the `implementer/snapshot/v1` envelope semantics and report-notice policy.

Snapshot-requesting D12 and D13 tasks report `BLOCKED` when the supplied helper
cannot produce the manifest and never hand-roll a fallback. Snapshot-skipped
tasks do not read the recipe or run the helper. A successful task appends exactly
one final report line:

```text
Snapshot written to <repo-relative-path>.
```

The envelope identifies its task and head and records each changed file as
`added`, `modified`, or `deleted`. Non-deleted entries carry line count, byte
count, and SHA-256, plus either byte-faithful content or a `size>64KB`/`binary`
skip reason. Deleted entries carry neither content nor skip reason. Snapshot
content comes from committed head blobs, never the mutable worktree.

The controller treats a malformed, missing, stale, non-regular, or unsafe
snapshot as non-fatal: it uses its own changed-file set and committed-head blob
reads. Snapshot content is bookkeeping only and is never forwarded to a review
prompt.
