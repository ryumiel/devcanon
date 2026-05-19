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

    Review-routing hint fields (`Risk hint`, `Review hint`, and `Review
    rationale`) are controller-only metadata. Ignore them as task requirements;
    the controller owns reviewer dispatch.

    Mechanical mode is only for approved verbatim artifact work or
    unambiguous identifier replacement. Concrete code-like examples, test
    snippets, plan-authored test bodies, shell snippets, shell recipes, command
    sequences, helper-name prescriptions, line-number edits, or commit recipes
    are not authoritative unless the task explicitly labels them as approved
    verbatim artifact content with an authority source. If that label or
    authority is missing for content you are asked to reproduce, report BLOCKED
    or NEEDS_CONTEXT instead of copying it.

    If the task includes a contract checklist, honor its owner/authority,
    affected consumers/generated outputs, must-preserve, required behavior,
    spec/procedure work, risk, and proof-obligation constraints within
    mechanical mode's narrow scope. A blank checklist field, unexplained `N/A`,
    or unconfirmed owner/authority, source-of-truth, consumer,
    generated-output, or evidence surface is not a mechanical replacement
    target; report BLOCKED or NEEDS_CONTEXT instead of guessing.

    ## Context

    [Scene-setting: where this fits, dependencies]

    Work from: [directory]

    ## Your Job

    1. Capture the pre-task base SHA — `BASE_SHA=$(git rev-parse HEAD)`. If `git rev-parse HEAD` fails for any reason, report BLOCKED.
    2. Read the relevant source files, existing docs, ADRs, helpers, generated
       output expectations, and referenced contracts directly before choosing any
       concrete file operation or verification approach.
    3. Implement what the task specifies: reproduce explicitly approved
       verbatim artifact content exactly, or perform the unambiguous
       identifier replacement exactly as specified.
    4. Satisfy the task's verification expectations by choosing an appropriate
       check from source-owned project docs, config, tests, or file inspection
       after applying the change. Plan-named commands are not authoritative
       unless separately approved by a trusted source outside the plan.
    5. Commit. Glob for `**/commit-guideline*.md` and follow it; otherwise use Conventional Commits in imperative mood.
    6. Self-review:
       - Did I match the approved spec verbatim (file paths, content, replacement strings)?
       - If naming was up to me, are names clear and accurate?
       - If the task said to follow TDD, did I?
       Fix any issues before reporting.
    7. Follow the controller's snapshot request state (see Snapshot Manifest section below).
    8. Report back (see format below).

    ## Snapshot Manifest

    Snapshot request: <SNAPSHOT_REQUEST_STATE: requested|skipped>

    After committing and self-reviewing, follow the controller's snapshot
    request state exactly. Only write a side-channel snapshot manifest when the
    snapshot request state is `requested`. If the snapshot request state is
    `skipped`, do not read the recipe, do not run the helper, and do not emit
    the snapshot notice line.

    When the snapshot request state is `requested`, the controller supplies two
    resolved paths with this dispatch:
    - Snapshot Manifest Recipe path: <SNAPSHOT_MANIFEST_RECIPE_PATH>
      - Source: `references/snapshot-manifest-recipe.md`
    - Snapshot Manifest Helper Script path: <SNAPSHOT_HELPER_SCRIPT>
      - Source: `scripts/write-snapshot-manifest.sh`

    Before writing the snapshot, read the recipe file. Then run the helper
    script with the captured `BASE_SHA` and the task header identifier as
    `SNAPSHOT_TASK_ID`. The recipe is the canonical contract for the
    `implementer/snapshot/v1` envelope, and the helper script is the canonical
    implementation of the path rules, `head_sha`, file metadata, binary and
    size behavior, deleted-file behavior, JSON-aware construction, `.ephemeral`
    write guard, and write-verification check.

    If the snapshot request state is `requested` but the dispatch does not
    include both a readable Snapshot Manifest Recipe path and a readable
    Snapshot Manifest Helper Script path, report BLOCKED and ask the controller
    to resend the task with both paths. If the helper exits nonzero, report
    BLOCKED instead of emitting the notice line. On success, use the helper's
    notice line as the final report line:

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
    - Base SHA
    - Head SHA

    If the snapshot request state is `requested` and the helper succeeded,
    append exactly one literal line naming the snapshot manifest path as the
    final line of the report (DONE / DONE_WITH_CONCERNS only):

    ```
    Snapshot written to <repo-relative-path>.
    ```

    The controller parses this literal line. Do not reword, do not wrap in
    backticks, do not omit the trailing period. If the snapshot write failed,
    report BLOCKED instead — never emit the notice line for an absent file.

    If the snapshot request state is `skipped`, do not append any snapshot notice
    line. Your DONE / DONE_WITH_CONCERNS report must include these default
    fields: status, summary, tests, files changed, base SHA, head SHA.

    Use BLOCKED if you cannot complete the task. Use NEEDS_CONTEXT if information is missing.
````
