# Snapshot Manifest Recipe

This is the canonical construction recipe for the dispatched implementer
`implementer/snapshot/v1` side-channel manifest. Implementer prompts require
this recipe before reporting `DONE` or `DONE_WITH_CONCERNS`.

## Required Inputs

- `BASE_SHA`: pre-task SHA captured before implementation.
- `HEAD_SHA`: post-commit SHA from `git rev-parse HEAD`.
- `TASK_ID`: the task header identifier, such as `Task 3`.

If `git rev-parse HEAD` fails before or after implementation, report
`BLOCKED`. The snapshot contract requires a known base and head.

## Recipe

1. Resolve the post-commit head SHA:

   ```bash
   HEAD_SHA=$(git rev-parse HEAD)
   ```

2. Resolve `BRANCH_SLUG` using the canonical bash from
   `skills/play-review/SKILL.md` section Output -> Side-channel file -> Path.
   Do not invent a new slug rule. `-C "$WORKING_DIRECTORY"` is dropped from the
   canonical form because the implementer runs in cwd.

   ```bash
   RAW_BRANCH=$(git rev-parse --abbrev-ref HEAD)
   if [ "$RAW_BRANCH" = HEAD ]; then
     BRANCH_SLUG=detached
   else
     BRANCH_SLUG=$(printf '%s' "$RAW_BRANCH" | tr '/' '-' | tr -cd '[:alnum:]._-')
     case "$BRANCH_SLUG" in
       ''|.|..|-*|.*) BRANCH_SLUG=unnamed ;;
     esac
   fi
   ```

3. Compute the snapshot path:

   ```bash
   SNAPSHOT_FILE=".ephemeral/${BRANCH_SLUG}-${HEAD_SHA}-snapshot.json"
   ```

4. Apply the canonical `.ephemeral` write guard before writing:

   ```bash
   [ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
   mkdir -p .ephemeral
   [ -L "$SNAPSHOT_FILE" ] && rm "$SNAPSHOT_FILE"
   ```

5. Enumerate every file changed during this task:

   ```bash
   git diff --name-status --no-renames ${BASE_SHA}..HEAD
   ```

   Map letters: `A` -> `added`, `M` -> `modified`, `D` -> `deleted`.
   `--no-renames` decomposes rename/copy detection into delete/add rows, but
   other status letters such as `T` or `U` can still appear. If any row starts
   with an unsupported status letter or multi-letter status, report `BLOCKED`
   with this message:

   ```text
   unsupported git diff status <status> for <path>; implementer/snapshot/v1 only supports added, modified, deleted
   ```

   If `${BASE_SHA}..HEAD` is empty, report `BLOCKED` rather than writing a
   snapshot with an empty `files` array.

6. Detect binary files with:

   ```bash
   git diff --numstat --no-renames ${BASE_SHA}..HEAD
   ```

   A `-\t-\t<path>` row indicates binary; emit `"skipped": "binary"`.

7. Build a JSON envelope conforming to schema `implementer/snapshot/v1` using
   a JSON-aware tool. Do not hand-assemble the `content` strings into a heredoc,
   and do not use `$(cat path)` inside `jq --arg`; command substitution strips
   trailing newlines, so the content will not be byte-faithful. Use
   `jq --rawfile` to read each file's bytes verbatim into the `content` field.
   Read file bytes from the post-commit working-tree path, matching ADR-0014's
   original contract. Quote every path variable used by the shell.

   Envelope shape:

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

   Complete general procedure:

   ```bash
   set -e

   STATUS_FILE=$(mktemp)
   NUMSTAT_FILE=$(mktemp)
   BINARY_PATHS_FILE=$(mktemp)
   FILES_JSON=$(mktemp)
   ENTRY_JSON=$(mktemp)
   NEXT_JSON=$(mktemp)
   CONTENT_FILE=$(mktemp)
   trap 'rm -f "$STATUS_FILE" "$NUMSTAT_FILE" "$BINARY_PATHS_FILE" "$FILES_JSON" "$ENTRY_JSON" "$NEXT_JSON" "$CONTENT_FILE"' EXIT

   git diff --name-status --no-renames "${BASE_SHA}..HEAD" > "$STATUS_FILE"
   [ -s "$STATUS_FILE" ] || { echo "snapshot has no changed files" >&2; exit 1; }

   git diff --numstat --no-renames "${BASE_SHA}..HEAD" > "$NUMSTAT_FILE"
   while IFS="$(printf '\t')" read -r added deleted path; do
     if [ "$added" = "-" ] && [ "$deleted" = "-" ]; then
       printf '%s\n' "$path" >> "$BINARY_PATHS_FILE"
     fi
   done < "$NUMSTAT_FILE"

   printf '[]\n' > "$FILES_JSON"

   while IFS="$(printf '\t')" read -r git_status path; do
     case "$git_status" in
       A) status=added ;;
       M) status=modified ;;
       D) status=deleted ;;
       *)
         echo "unsupported git diff status $git_status for $path; implementer/snapshot/v1 only supports added, modified, deleted" >&2
         exit 1
         ;;
     esac

     if [ "$status" = deleted ]; then
       jq -n \
         --arg path "$path" \
         --arg status "$status" \
         '{path:$path,status:$status,lines:0,bytes:0,sha256:""}' \
         > "$ENTRY_JSON"
     else
       lines=$(awk 'END{print NR}' < "$path")
       bytes=$(wc -c < "$path" | tr -d ' ')
       sha256=$(shasum -a 256 < "$path" | awk '{print $1}')

       if grep -Fxq -- "$path" "$BINARY_PATHS_FILE"; then
         jq -n \
           --arg path "$path" \
           --arg status "$status" \
           --argjson lines "$lines" \
           --argjson bytes "$bytes" \
           --arg sha256 "$sha256" \
           '{path:$path,status:$status,lines:$lines,bytes:$bytes,sha256:$sha256,skipped:"binary"}' \
           > "$ENTRY_JSON"
       elif [ "$bytes" -gt 64000 ]; then
         jq -n \
           --arg path "$path" \
           --arg status "$status" \
           --argjson lines "$lines" \
           --argjson bytes "$bytes" \
           --arg sha256 "$sha256" \
           '{path:$path,status:$status,lines:$lines,bytes:$bytes,sha256:$sha256,skipped:"size>64KB"}' \
           > "$ENTRY_JSON"
       else
         cat < "$path" > "$CONTENT_FILE"
         jq -n \
           --arg path "$path" \
           --arg status "$status" \
           --argjson lines "$lines" \
           --argjson bytes "$bytes" \
           --arg sha256 "$sha256" \
           --rawfile content "$CONTENT_FILE" \
           '{path:$path,status:$status,lines:$lines,bytes:$bytes,sha256:$sha256,content:$content}' \
           > "$ENTRY_JSON"
       fi
     fi

     jq -n \
       --slurpfile files "$FILES_JSON" \
       --slurpfile entry "$ENTRY_JSON" \
       '$files[0] + [$entry[0]]' \
       > "$NEXT_JSON"
     mv "$NEXT_JSON" "$FILES_JSON"
   done < "$STATUS_FILE"

   jq -n \
     --arg schema "implementer/snapshot/v1" \
     --arg task_id "$TASK_ID" \
     --arg head_sha "$HEAD_SHA" \
     --slurpfile files "$FILES_JSON" \
     '{schema:$schema,task_id:$task_id,head_sha:$head_sha,files:$files[0]}' \
     > "$SNAPSHOT_FILE"
   ```

   For non-deleted files where `content` is omitted, drop `--rawfile content`
   and emit `skipped: $skipped` instead.
   Hand-quoting verbatim file bytes will mis-escape `"`, `\`, and newlines and
   silently corrupt the snapshot, so always go through a JSON-aware tool.

## Per-File Rules

- `status` is `added`, `modified`, or `deleted`; unsupported git status letters
  block the snapshot.
- For non-deleted files, read the post-commit working-tree path and compute
  `lines`, `bytes`, `sha256`, and included `content` from that path.
- `lines` is `awk 'END{print NR}' < "$path"` post-commit, or `0` for deleted
  files. This is the visible line count; it equals `wc -l` for
  newline-terminated files and is one greater than `wc -l` for files without a
  trailing newline.
- `bytes` is `wc -c < "$path"` post-commit, or `0` for deleted files.
- `sha256` is `shasum -a 256 < "$path" | awk '{print $1}'`, or `""` for deleted
  files.
- `content` is included when `bytes <= 64000`, `status != "deleted"`, and the
  file is not binary.
- When `content` is omitted on a non-deleted file, set `"skipped"` to
  `"size>64KB"` or `"binary"`. Mutual exclusion: exactly one of `content` or
  `skipped` is present per non-deleted file.
- The concrete skip values are `"skipped": "size>64KB"` and
  `"skipped": "binary"`.
- Deleted files emit neither `content` nor `skipped`. Deletion dominates binary
  detection: when `status == "deleted"`, emit neither field even if numstat
  reports the path as binary.

## Persist and Verify

Persist the envelope to `$SNAPSHOT_FILE`. If you assemble the JSON with `jq`,
redirect `jq` output to the path; if you assemble the JSON another way, use the
Write tool. Do not append. Neither `>` redirection nor the Write tool
guarantees atomic replacement, so the post-write size check is the integrity
gate:

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
malformed, missing, unreadable, symlinked, or stale snapshots as non-fatal and
falls back to disk reads.
