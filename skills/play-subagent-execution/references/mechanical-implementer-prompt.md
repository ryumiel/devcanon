# Mechanical Implementer Subagent Prompt Template

Use this template when dispatching an implementer subagent for a task whose task header includes `**Mode:** mechanical`. For all other tasks, use [`implementer-prompt.md`](implementer-prompt.md).

**Promotion classification:** Workflow-local prompt template paired with the source agent at [`agents/implementer.yaml`](../../../agents/implementer.yaml) — referenced from `skills/play-subagent-execution/SKILL.md` for dispatch-time placeholder substitution. The role identity is already promoted; per [`docs/guidelines/agent-authoring-guide.md`](../../../docs/guidelines/agent-authoring-guide.md) §4, workflow-local prompt assembly stays as a template.

````
Task tool (general-purpose):
  description: "Implement Task N: [task name]"
  prompt: |
    You are implementing Task N: [task name]

    ## Task Description

    [FULL TEXT of task from plan - paste it here, don't make subagent read file]

    ## Context

    [Scene-setting: where this fits, dependencies]

    Work from: [directory]

    ## Your Job

    1. Capture the pre-task base SHA — `BASE_SHA=$(git rev-parse HEAD)`. If `git rev-parse HEAD` fails for any reason, report BLOCKED.
    2. Implement what the task specifies (write/edit files exactly as the plan shows).
    3. Verify the change (run any verify command from the plan).
    4. Commit. Glob for `**/commit-guideline*.md` and follow it; otherwise use Conventional Commits in imperative mood.
    5. Self-review:
       - Did I match the spec verbatim (file paths, content, commit messages)?
       - If naming was up to me, are names clear and accurate?
       - If the task said to follow TDD, did I?
       Fix any issues before reporting.
    6. Write the snapshot manifest (see Snapshot Manifest section below).
    7. Report back (see format below).

    ## Snapshot Manifest

    After committing, write a side-channel snapshot manifest at
    `.ephemeral/<branch_slug>-<head_sha>-snapshot.json` so the
    controller can verify your work without re-reading from disk.

    1. `HEAD_SHA=$(git rev-parse HEAD)`.
    2. Compute `BRANCH_SLUG` using the canonical bash from
       `skills/play-review/SKILL.md` § Output → Side-channel file → Path
       (handle detached HEAD as `detached`; sanitize with the `unnamed`
       fallback for empty / `.` / `..` / leading `-` / leading `.`;
       `-C "$WORKING_DIRECTORY"` is dropped because the implementer runs
       in cwd).
    3. `SNAPSHOT_FILE=".ephemeral/${BRANCH_SLUG}-${HEAD_SHA}-snapshot.json"`.
    4. Symlink guard before writing: `[ -L "$SNAPSHOT_FILE" ] && rm "$SNAPSHOT_FILE"`. `mkdir -p .ephemeral`.
    5. Build a JSON envelope conforming to schema `implementer/snapshot/v1`
       using `jq -n --rawfile content <path> ...` (do NOT hand-quote file
       bytes; do NOT use `$(cat path)` inside `--arg` — command
       substitution strips trailing newlines). Envelope shape:
       `{schema, task_id, head_sha, files: [{path, status, lines, bytes, sha256, content}]}`,
       where `task_id` is the identifier from your task header (e.g.
       `"Task 3"`). Per file: `status` ∈ {added, modified, deleted};
       `lines` from `wc -l`; `bytes` from `wc -c`; `sha256` from
       `shasum -a 256`; `content` is included when `bytes <= 64000`,
       `status != "deleted"`, and the file is not binary. When `content`
       is omitted on a non-deleted file, set `"skipped"` to `"size>64KB"`
       or `"binary"` (drop `--rawfile content` from the jq command and
       emit `skipped: $skipped` instead). Mutual exclusion: exactly one
       of `content` / `skipped` per non-deleted file. Deleted files emit
       neither field. Enumerate files with
       `git diff --name-status ${BASE_SHA}..HEAD` (letters: A→added,
       M→modified, D→deleted; treat R/C as modified); detect binary
       via `git diff --numstat ${BASE_SHA}..HEAD`'s `-\t-\t` rows.
    6. Persist to `$SNAPSHOT_FILE` (jq's `>` redirect, or the `Write`
       tool if you assembled JSON another way; atomic replacement; do
       not append).
    7. Verify: `[ -s "$SNAPSHOT_FILE" ] || exit 1`.

    ## Report Format

    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - What you changed
    - What you verified
    - Files changed

    On the final line of the report (DONE / DONE_WITH_CONCERNS only), append
    exactly one literal line naming the snapshot manifest path:

    ```
    Snapshot written to <repo-relative-path>.
    ```

    The controller parses this literal line. Do not reword, do not wrap in
    backticks, do not omit the trailing period. If the snapshot write failed,
    report BLOCKED instead — never emit the notice line for an absent file.

    Use BLOCKED if you cannot complete the task. Use NEEDS_CONTEXT if information is missing.
````
