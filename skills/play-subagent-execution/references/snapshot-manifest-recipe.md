# Snapshot Manifest Recipe

This is the canonical construction recipe for the dispatched implementer
`implementer/snapshot/v1` side-channel manifest. Implementer prompts require
this recipe before reporting `DONE` or `DONE_WITH_CONCERNS`.

## Required Inputs

- `BASE_SHA`: pre-task SHA captured before implementation.
- `SNAPSHOT_TASK_ID`: the task header identifier, such as `Task 3`.
- `SNAPSHOT_HELPER_SCRIPT`: readable Snapshot Manifest Helper Script path
  supplied by the controller, sourced from
  `skills/play-subagent-execution/scripts/write-snapshot-manifest.sh`.

If `git rev-parse HEAD` fails before or after implementation, report
`BLOCKED`. The snapshot contract requires a known base and head.

Runtime prerequisites: `bash`, `git`, `jq`, `awk`, `wc`, `tr`, `mktemp`, `rm`,
`mkdir`, `mv`, and either `shasum` or `sha256sum`. `jq` is a hard helper
prerequisite; if it is unavailable, the helper exits nonzero and the
implementer reports `BLOCKED`.

## Recipe

Use the readable helper script supplied by the controller. Normal dispatches
must report `BLOCKED` if the helper script is unavailable; do not hand-roll the
snapshot procedure from this recipe.

```bash
BASE_SHA="$BASE_SHA" SNAPSHOT_TASK_ID="$SNAPSHOT_TASK_ID" bash "$SNAPSHOT_HELPER_SCRIPT"
```

The helper script owns the full construction procedure:

- Resolves `HEAD_SHA` with `git rev-parse HEAD`.
- Resolves `BRANCH_SLUG` using the canonical bash from
  `skills/play-review/SKILL.md` section Output -> Side-channel file -> Path.
  The `-C "$WORKING_DIRECTORY"` form is dropped because the implementer runs in
  cwd.
- Computes `SNAPSHOT_FILE` as
  `.ephemeral/${BRANCH_SLUG}-${HEAD_SHA}-snapshot.json`.
- Applies the `.ephemeral` write guard: reject a symlinked `.ephemeral`
  directory, create `.ephemeral` when absent, write JSON to a private temp file
  in `.ephemeral`, then rename that output into the target snapshot path.
- Enumerates changed files with
  `git diff -z --name-status --no-renames "${BASE_SHA}..HEAD"` so Git does
  not quote or escape repo-relative paths.
- Detects binary files with
  `git diff -z --numstat --no-renames "${BASE_SHA}..HEAD"` and NUL-safe path
  parsing.
- Rejects non-deleted symlink paths from committed `HEAD` tree metadata, then
  reads non-deleted file bytes from the committed `HEAD:<path>` blob, never from
  a mutable working-tree file.
- Builds the JSON envelope with `jq` and `jq --rawfile` for UTF-8-safe file
  content, so quotes, backslashes, newlines, and trailing newlines stay
  byte-faithful. Blobs that do not round-trip through JSON string transport are
  skipped as `"binary"`.
- Performs the post-write size check before printing the success notice.

If the helper script is missing, unreadable, or exits nonzero, report `BLOCKED`
instead of emitting the notice line.

The helper emits a JSON envelope conforming to schema `implementer/snapshot/v1`:

```json
{
  "schema": "implementer/snapshot/v1",
  "task_id": "Task 3",
  "head_sha": "0123456789abcdef0123456789abcdef01234567",
  "files": [
    {
      "path": "docs/adr/adr-0007-review-pipeline-delineation.md",
      "status": "added",
      "lines": 167,
      "bytes": 5021,
      "sha256": "<hex>",
      "content": "<verbatim file content>"
    },
    {
      "path": "docs/specs/old-spec.md",
      "status": "deleted",
      "lines": 0,
      "bytes": 0,
      "sha256": ""
    }
  ]
}
```

## Per-File Rules

- `status` is `added`, `modified`, or `deleted`; unsupported git status letters
  block the snapshot.
- Non-deleted symlink paths from committed `HEAD` tree metadata block the
  snapshot before metadata or content reads. Symlinked parent components also
  block the snapshot. The helper must not follow changed symlinks while
  computing metadata or content.
- For non-deleted files, read the committed `HEAD:<path>` blob and compute
  `lines`, `bytes`, `sha256`, and included `content` from that blob.
- `lines` is `awk 'END{print NR}'` over the committed blob, or `0` for deleted
  files. This is the visible line count; it equals `wc -l` for
  newline-terminated files and is one greater than `wc -l` for files without a
  trailing newline.
- `bytes` is `wc -c` over the committed blob, or `0` for deleted files.
- `sha256` is computed from the committed blob with the helper script's
  `sha256_file` function, which uses `shasum -a 256` when available and falls
  back to `sha256sum` when `shasum` is unavailable. For deleted files, it is
  `""`.
- `content` is included when `bytes <= 64000`, `status != "deleted"`, the file
  is not reported as binary by Git, and the blob round-trips byte-for-byte
  through `jq --rawfile` and `jq -rj`.
- When `content` is omitted on a non-deleted file, set `"skipped"` to
  `"size>64KB"` or `"binary"`. Mutual exclusion: exactly one of `content` or
  `skipped` is present per non-deleted file.
- The concrete skip values are `"skipped": "size>64KB"` and
  `"skipped": "binary"`. Use `"binary"` for Git-reported binary files and for
  blobs that cannot be transported byte-faithfully as JSON strings.
- Deleted files emit neither `content` nor `skipped`. Deletion dominates binary
  detection: when `status == "deleted"`, emit neither field even if numstat
  reports the path as binary.

## Persist and Verify

In normal dispatches, the helper owns persistence and verification. It writes
the envelope to a private temp file in `.ephemeral`, rechecks that `.ephemeral`
is not a symlink, renames the temp file to `$SNAPSHOT_FILE`, performs the
post-write size check, and prints the success notice. Do not assemble or write
the snapshot manually.

Because the helper is authoritative for executable snapshot behavior, do not
substitute a dispatch-local fallback contract when the helper is unavailable.
Do not append. The post-write size check is the integrity gate:

```bash
[ -s "$SNAPSHOT_FILE" ] || { echo "snapshot write failed: $SNAPSHOT_FILE" >&2; exit 1; }
```

On success, append exactly one final report line:

```text
Snapshot written to <repo-relative-path>.
```

The controller parses this literal line. Do not reword it, wrap the path in
backticks, or omit the trailing period.

## Consumer Fallback

The producer reports `BLOCKED` if the snapshot cannot be written or verified
and never emits the notice line for an absent file. The controller still treats
malformed, missing, unreadable, symlinked, non-flat, path-traversing, or stale
snapshots as non-fatal and falls back to committed HEAD blob reads using the
controller-computed changed-file list from
`git diff -z --name-status --no-renames BASE..HEAD`, not snapshot-provided
paths or statuses. Fallback content reads must use committed `HEAD:<path>` blobs
with literal pathspec tree checks, not mutable working-tree paths.

Snapshot content is controller bookkeeping only. The controller must not forward
snapshot content or parsed snapshot JSON into reviewer prompts, and reviewers
must continue reading implementation files from disk.
