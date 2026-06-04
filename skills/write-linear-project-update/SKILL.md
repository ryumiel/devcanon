---
name: write-linear-project-update
description: Writes concise Linear project updates from project evidence. Use when asked to draft, dry-run, apply, post, create, revise, or update a stakeholder-readable Linear project update or health report based on project issues, updates, milestones, target date, linked PRs, and repository evidence.
codex_sidecar:
  interface:
    display_name: Write Linear Project Update
    short_description: Write Linear project updates from evidence
    brand_color: "#5e6ad2"
    default_prompt: Use $write-linear-project-update to draft a Linear project update from evidence in dry-run mode.
---

# Write Linear Project Update

Use this skill to write a concise stakeholder-readable Linear project update from evidence.

Default to `DRY_RUN` unless the user explicitly asks to apply. Applying creates a new project update by default. Updating an existing project update is allowed only when the user explicitly asks to revise, edit, update, replace, or modify an existing update.

This skill must not create issues, bulk-edit issues, or change project lifecycle status.

## Workflow

1. Resolve the project.
   - Accept a Linear project URL, ID, slug, or name.
   - Read the project overview/content, latest update, previous updates, members, lead, milestones, target date, project state, and associated issues.
   - Treat the time window as “since the latest project update” unless the user specifies a different window.
   - Accept a project update ID or body as a style/tone reference when the user presents it that way; a style reference is evidence only and is not a mutation target.

2. Inspect evidence.
   - Group issues by state/category and identify completed, active, review, blocked, stale, and newly created work in the time window.
   - Check linked GitHub PRs/branches when Linear attachments indicate implementation status matters.
   - Inspect the repository only when needed to verify whether implementation state differs from Linear.
   - Ignore assignee/owner gaps unless the user says ownership is meaningful; some teams assign owners dynamically.

3. Check risky issues directly.
   - Do not rely only on aggregate counts.
   - For each apparent risk, inspect the issue’s current state, recent comments, attachments, linked PR state, CI status, and whether the work was split or superseded.
   - Distinguish true blockers from normal review/merge queue.

4. Decide health.
   - `On track`: progress matches expectations and no major blocker exists.
   - `At risk`: delivery is plausible but there are unresolved blockers, stale critical work, unclear scope, target-date pressure, failing CI on critical work, or unclosed validation/durability gaps.
   - `Off track`: the current date/plan is no longer credible or core scope is blocked.
   - Prefer `At risk` over `On track` when uncertainty is material.
   - Explain the health reason in one sentence.

5. Draft the update body.
   - Use the template in [references/update-template.md](references/update-template.md).
   - Match the project’s working language; if recent updates are Korean, write the update body in Korean.
   - If the user provides a style/tone reference from another project update, match only the useful style conventions; do not treat that reference ID or body as the update to mutate.
   - Do not use Linear issue IDs in the update body. Describe status in plain product/feature language.
   - Focus on major features and their status, not a changelog dump.
   - Use bullets and line breaks for readability.
   - Put issue IDs, PR links, counts, and raw evidence in a separate evidence appendix file, not in the postable body.

6. Determine action mode.
   - Use `create` mode by default, including normal requests to write, apply, post, or publish a project update.
   - Use `update` mode only when the user explicitly asks to revise, edit, update, replace, or modify an existing project update.
   - In `update` mode, require a target update ID or one single confirmed mutation target from the user/project evidence.
   - If an update ID is ambiguous between a mutation target and a style/tone reference, treat it as non-mutating style evidence unless the user confirms explicit update intent.
   - If explicit `update` mode lacks a target update ID or single confirmed mutation target, stop and ask for the target instead of creating or updating.

7. Dry-run output.
   - Do not modify Linear.
   - Output current latest health, recommended health, proposed update body, evidence used, action mode (`create` or `update`), and the exact write action that would be performed.
   - When useful, write local drafts under `.ephemeral/`.
   - Before writing, apply the canonical `.ephemeral` safety guard: create `.ephemeral/` if it does not exist; refuse to write if `.ephemeral` exists as a symlink; verify the target is a direct child of `.ephemeral/` (no nested paths, `..`, or absolute paths); then inspect the exact target file path before writing, removing it first if it is a symlink and refusing to write if an existing target is not a regular file.
   - Use only these direct-child filenames for draft artifacts:
     - `<project-slug>-project-update-draft.md` for the postable body.
     - `<project-slug>-project-update-evidence.md` for evidence and issue/PR appendix.
   - If those files already exist and the user did not ask to replace them, write timestamped direct-child variants instead of silently overwriting.
   - In `create` mode, the proposed write action must create a new project update.
   - In `update` mode, the proposed write action must update the confirmed target update ID.

8. Apply output.
   - In `create` mode, create a new project update with the recommended health and update body.
   - In `update` mode, update only the confirmed target update ID with the recommended health and update body.
   - Re-read project updates after writing and report final health, the created or updated update ID/URL, and a concise summary.
   - Do not change lifecycle status.

## Evidence Commands

Prefer the Linear CLI and GitHub CLI when available:

```bash
linear-cli p list --output json
linear-cli p get PROJECT_ID --output json
linear-cli pu list "Project Name" --output json
linear-cli i list --project "Project Name" --output json --all --no-cache
linear-cli api query --output json 'query { project(id: "PROJECT_ID") { targetDate issues(first: 250) { nodes { identifier title state { name type } updatedAt completedAt branchName attachments(first: 20) { nodes { title url sourceType createdAt } } comments(first: 5) { nodes { createdAt body user { name } } } } } } }'
gh pr view PR_NUMBER --repo OWNER/REPO --json number,title,state,mergedAt,closedAt,isDraft,reviewDecision,statusCheckRollup,updatedAt,url
```

Use GraphQL when the CLI list view omits fields such as `targetDate`, `completedAt`, comments, attachments, or milestones.
The sample GraphQL query above uses page limits (`issues(first: 250)`,
`attachments(first: 20)`, and `comments(first: 5)`). When a project or issue
can exceed those limits, paginate the relevant connections or use narrower
queries so large projects do not silently omit audit evidence.

For the default `create` action, use a create command against the project:

```bash
linear-cli pu create <PROJECT> --health <HEALTH> --body "$BODY"
```

For the explicit `update` action, use an update command against the confirmed target update ID:

```bash
linear-cli pu update <UPDATE_ID> --health <HEALTH> --body "$BODY"
```

## Writing Rules

- Keep the body under one minute to read.
- Separate confirmed facts from inference in dry-run explanations.
- Do not mention every issue.
- Do not hide blockers or failing checks.
- Do not call normal review activity a blocker unless it blocks the target date or core scope.
- If applying, use the exact body from the draft file or the user-approved revision.
