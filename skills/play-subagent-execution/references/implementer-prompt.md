# Implementer Subagent Prompt Template

Use this template when dispatching an implementer subagent.

**Promotion classification:** Workflow-local prompt template paired with the source agent at [`agents/implementer.yaml`](../../../agents/implementer.yaml) — referenced from `skills/play-subagent-execution/SKILL.md` for dispatch-time placeholder substitution. The role identity is already promoted; per [`docs/guidelines/agent-authoring-guide.md`](../../../docs/guidelines/agent-authoring-guide.md) §4, workflow-local prompt assembly stays as a template.

````
Task tool (general-purpose):
  description: "Implement Task N: [task name]"
  prompt: |
    You are implementing Task N: [task name]

    ## Task Description

    [FULL TEXT of task from plan - paste it here, don't make subagent read file]

    ## Context

    [Scene-setting: where this fits, dependencies, architectural context]

    ## Before You Begin

    If you have questions about:
    - The requirements or acceptance criteria
    - The approach or implementation strategy
    - Dependencies or assumptions
    - Anything unclear in the task description

    **Ask them now.** Raise any concerns before starting work.

    ## Your Job

    Once you're clear on requirements:
    1. Capture the pre-task base SHA — run `BASE_SHA=$(git rev-parse HEAD)` and remember the value; the Snapshot Manifest step uses it to enumerate files changed during this task. (If `git rev-parse HEAD` fails for any reason — empty branch, corrupted ref, non-git directory — report BLOCKED. The snapshot contract requires a known base.)
    2. Implement exactly what the task specifies
    3. Write tests (following TDD if task says to)
    4. Verify implementation works
    5. Commit your work (see Committing section below)
    6. Self-review (see below)
    7. Write the snapshot manifest (see Snapshot Manifest section below)
    8. Report back

    Work from: [directory]

    **While you work:** If you encounter something unexpected or unclear, **ask questions**.
    It's always OK to pause and clarify. Don't guess or make assumptions.

    ## Code Organization

    You reason best about code you can hold in context at once, and your edits are more
    reliable when files are focused. Keep this in mind:
    - Follow the file structure defined in the plan
    - Each file should have one clear responsibility with a well-defined interface
    - If a file you're creating is growing beyond the plan's intent, stop and report
      it as DONE_WITH_CONCERNS — don't split files on your own without plan guidance
    - If an existing file you're modifying is already large or tangled, work carefully
      and note it as a concern in your report
    - In existing codebases, follow established patterns. Improve code you're touching
      the way a good developer would, but don't restructure things outside your task.

    ## When You're in Over Your Head

    It is always OK to stop and say "this is too hard for me." Bad work is worse than
    no work. You will not be penalized for escalating.

    **STOP and escalate when:**
    - The task requires architectural decisions with multiple valid approaches
    - You need to understand code beyond what was provided and can't find clarity
    - You feel uncertain about whether your approach is correct
    - The task involves restructuring existing code in ways the plan didn't anticipate
    - You've been reading file after file trying to understand the system without progress

    **How to escalate:** Report back with status BLOCKED or NEEDS_CONTEXT. Describe
    specifically what you're stuck on, what you've tried, and what kind of help you need.
    The controller can provide more context, re-dispatch with a more capable model,
    or break the task into smaller pieces.

    ## Committing

    Before composing commit messages, glob for `**/commit-guideline*.md` in the repository.
    If found, read it and follow its header format, type/scope rules, and body guidelines exactly.
    If no guideline is found, use Conventional Commits: `type(scope): subject` in imperative mood.

    ## Snapshot Manifest

    After committing and self-reviewing, write a side-channel snapshot
    manifest so the controller can verify your work and look up line
    ranges without re-reading every file from disk.

    1. Resolve the post-commit head SHA:

       ```bash
       HEAD_SHA=$(git rev-parse HEAD)
       ```

    2. Resolve the branch slug using the canonical bash from
       `skills/play-review/SKILL.md` § Output → Side-channel file → Path
       (do not invent a new slug rule). `-C "$WORKING_DIRECTORY"` is
       dropped from the canonical form because the implementer runs in
       cwd.

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

    3. Compute the path:

       ```bash
       SNAPSHOT_FILE=".ephemeral/${BRANCH_SLUG}-${HEAD_SHA}-snapshot.json"
       ```

    4. Apply the symlink guard (in case a fork-PR working tree pre-staged a symlink at this path):

       ```bash
       [ -L "$SNAPSHOT_FILE" ] && rm "$SNAPSHOT_FILE"
       mkdir -p .ephemeral
       ```

    5. Build the JSON envelope conforming to schema
       `implementer/snapshot/v1`:

       ```json
       {
         "schema": "implementer/snapshot/v1",
         "task_id": "<task identifier from your task header>",
         "head_sha": "<HEAD_SHA from Snapshot Manifest § Step 1>",
         "files": [
           {
             "path": "<repo-relative path>",
             "status": "added",
             "lines": <integer>,
             "bytes": <integer>,
             "sha256": "<hex>",
             "content": "<verbatim post-commit content>"
           },
           {
             "path": "<repo-relative path>",
             "status": "deleted",
             "lines": 0,
             "bytes": 0,
             "sha256": ""
           }
         ]
       }
       ```

       Note that the `deleted` entry above carries neither `content` nor
       `skipped` — the consumer infers deletion from `status`. See
       per-file rules below.

       Build the envelope with a JSON-aware tool — do NOT hand-assemble
       the `content` strings into a heredoc, and do NOT use `$(cat path)`
       inside a `jq --arg` (command substitution strips trailing
       newlines, so the content will not be byte-faithful). Use
       `jq --rawfile` to read each file's bytes verbatim into the
       `content` field. One canonical recipe for a single file:

       ```bash
       jq -n \
         --arg schema "implementer/snapshot/v1" \
         --arg task_id "<task identifier>" \
         --arg head_sha "$HEAD_SHA" \
         --arg path "<repo-relative-path>" \
         --arg status "added" \
         --argjson lines "$(awk 'END{print NR}' <path>)" \
         --argjson bytes "$(wc -c < <path>)" \
         --arg sha256 "$(shasum -a 256 <path> | awk '{print $1}')" \
         --rawfile content <path> \
         '{schema:$schema,task_id:$task_id,head_sha:$head_sha,
           files:[{path:$path,status:$status,lines:$lines,bytes:$bytes,
                   sha256:$sha256,content:$content}]}' \
         > "$SNAPSHOT_FILE"
       ```

       Extend the `files:` array for multi-file commits. For files where
       `content` is omitted, drop `--rawfile content` and emit
       `skipped: $skipped` instead. Hand-quoting verbatim file bytes will
       mis-escape `"`, `\`, and newlines and silently corrupt the
       snapshot, so always go through a JSON-aware tool.

       Per-file rules:
       - Enumerate every file changed during this task (run
         `git diff --name-status --no-renames ${BASE_SHA}..HEAD` and map letters:
         `A`→added, `M`→modified, `D`→deleted). `--no-renames` decomposes any
         rename into a delete plus an add, so only `A`/`M`/`D` appear.
       - If `${BASE_SHA}..HEAD` is empty (no commits landed during this task),
         the snapshot contract is undefined — report BLOCKED rather than
         emitting a snapshot with an empty `files` array.
       - `lines` = `awk 'END{print NR}' <path>` post-commit (or `0` for deleted).
         This is the visible line count; it equals `wc -l` for newline-terminated
         files and is one greater than `wc -l` for files without a trailing newline.
       - `bytes` = `wc -c < <path>` post-commit (or `0` for deleted).
       - `sha256` = `shasum -a 256 <path> | awk '{print $1}'` (or `""` for deleted).
       - `content` is included when `bytes <= 64000`, `status != "deleted"`,
         and the file is not binary.
       - When `content` is omitted on a non-deleted file, set `"skipped"`
         to `"size>64KB"` or `"binary"`. Mutual exclusion: exactly one of
         `content` / `skipped` present per non-deleted file. Deleted files
         emit neither field.
       - Detect binary via `git diff --numstat --no-renames ${BASE_SHA}..HEAD` —
         a `-\t-\t<path>` row indicates binary; emit `"skipped": "binary"`.
       - Deletion dominates binary detection: when `status == "deleted"`,
         emit neither `content` nor `skipped`, even if numstat reports the
         path as binary.

    6. Persist the envelope to `$SNAPSHOT_FILE`. The Step 5 recipe already
       redirects `jq` output to the path; if you assembled the JSON
       another way, use the `Write` tool (atomic replacement; do not
       append).

    7. Verify the write:

       ```bash
       [ -s "$SNAPSHOT_FILE" ] || { echo "snapshot write failed: $SNAPSHOT_FILE" >&2; exit 1; }
       ```

    8. Note the path — you will reference it in the Report Format as
       `Snapshot written to <repo-relative-path>.` (one literal line, ending
       with a period; the controller parses this exact form).

    ## Before Reporting Back: Self-Review

    Review your work with fresh eyes. Ask yourself:

    **Completeness:**
    - Did I fully implement everything in the spec?
    - Did I miss any requirements?
    - Are there edge cases I didn't handle?

    **Quality:**
    - Is this my best work?
    - Are names clear and accurate (match what things do, not how they work)?
    - Is the code clean and maintainable?

    **Discipline:**
    - Did I avoid overbuilding (YAGNI)?
    - Did I only build what was requested?
    - Did I follow existing patterns in the codebase?

    **Testing:**
    - Do tests actually verify behavior (not just mock behavior)?
    - Did I follow TDD if required?
    - Are tests comprehensive?

    If you find issues during self-review, fix them now before reporting.

    ## Report Format

    When done, report:
    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - What you implemented (or what you attempted, if blocked)
    - What you tested and test results
    - Files changed
    - Self-review findings (if any)
    - Any issues or concerns

    Then, on the final line of the report (DONE / DONE_WITH_CONCERNS only),
    append exactly one literal line naming the snapshot manifest path:

    ```
    Snapshot written to <repo-relative-path>.
    ```

    The controller parses this literal line off the report. Do not reword,
    do not wrap in backticks, do not omit the trailing period. If the
    snapshot write failed (Snapshot Manifest § Step 7 returned non-zero),
    report BLOCKED instead — never emit the notice line for an absent
    file.

    Use DONE_WITH_CONCERNS if you completed the work but have doubts about correctness.
    Use BLOCKED if you cannot complete the task. Use NEEDS_CONTEXT if you need
    information that wasn't provided. Never silently produce work you're unsure about.
````
