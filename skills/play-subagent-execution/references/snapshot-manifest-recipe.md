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

The current-v1 structural contract is descriptive JSON, not a literal manifest:

```json
{
  "schema": "implementer/snapshot/v1",
  "required": ["schema", "task_id", "head_sha", "files"],
  "types": {
    "task_id": "non-empty string",
    "head_sha": "40-character lowercase hexadecimal SHA",
    "files": "non-empty array"
  },
  "files": {
    "added_or_modified": {
      "statuses": ["added", "modified"],
      "required": ["path", "status", "lines", "bytes", "sha256"],
      "types": {
        "path": "repo-relative string",
        "lines": "non-negative integer",
        "bytes": "non-negative integer",
        "sha256": "64-character lowercase hexadecimal SHA"
      },
      "exactly_one_of": [
        { "content": "string" },
        { "skipped": ["binary", "size>64KB"] }
      ]
    },
    "deleted": {
      "status": "deleted",
      "required": ["path", "status", "lines", "bytes", "sha256"],
      "fixed": { "lines": 0, "bytes": 0, "sha256": "" },
      "forbidden": ["content", "skipped"]
    }
  }
}
```

Snapshot content comes from committed head blobs, never the mutable worktree.

The controller treats a malformed, missing, stale, non-regular, or unsafe
snapshot as non-fatal: it uses its own changed-file set and committed-head blob
reads. Snapshot content is bookkeeping only and is never forwarded to a review
prompt.
