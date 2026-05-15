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

    After committing and self-reviewing, write the side-channel snapshot
    manifest before reporting `DONE` or `DONE_WITH_CONCERNS`.

    The controller supplies a readable Snapshot Manifest Recipe path with this
    dispatch, sourced from `references/snapshot-manifest-recipe.md`. Before
    writing the snapshot, read that recipe file and follow it exactly. It is the
    canonical construction source for the
    `implementer/snapshot/v1` envelope, including the path rules, `head_sha`,
    file metadata, binary and size behavior, deleted-file behavior, JSON-aware
    construction, `.ephemeral` write guard, and consumer fallback semantics.

    If the dispatch does not include a readable Snapshot Manifest Recipe path,
    report BLOCKED and ask the controller to resend the task with the recipe
    path. If any recipe step fails, report BLOCKED instead of emitting the
    notice line. On success, append exactly one final report line:

    ```text
    Snapshot written to <repo-relative-path>.
    ```

    The controller parses this literal line. Do not reword it, wrap the path in
    backticks, or omit the trailing period.

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
