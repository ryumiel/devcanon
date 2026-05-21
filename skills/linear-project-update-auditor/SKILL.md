---
name: linear-project-update-auditor
description: Audit and optionally update the latest Linear project update or health report from evidence. Use when asked to check a Linear project status/update, produce a dry-run health recommendation, revise a project health report, or apply a concise Linear project update based on project issues, updates, milestones, target date, linked PRs, and repository evidence.
codex_sidecar:
  interface:
    display_name: Linear Project Update Auditor
    short_description: Audit Linear project updates from evidence
    brand_color: "#5e6ad2"
    default_prompt: Use $linear-project-update-auditor to audit a Linear project update in dry-run mode.
---

# Linear Project Update Auditor

Use this skill to audit the latest Linear project update from evidence and draft or apply a concise stakeholder-readable update.

Default to `DRY_RUN` unless the user explicitly asks to apply. Never change project lifecycle status, bulk-edit issues, or create issues unless the user explicitly asks.

## Workflow

1. Resolve the project.
   - Accept a Linear project URL, ID, slug, or name.
   - Read the project overview/content, latest update, previous updates, members, lead, milestones, target date, project state, and associated issues.
   - Treat the time window as “since the latest project update” unless the user specifies a different window.

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
   - Do not use Linear issue IDs in the update body. Describe status in plain product/feature language.
   - Focus on major features and their status, not a changelog dump.
   - Use bullets and line breaks for readability.
   - Put issue IDs, PR links, counts, and raw evidence in a separate evidence appendix file, not in the postable body.

6. Dry-run output.
   - Do not modify Linear.
   - Output current latest health, recommended health, proposed update body, evidence used, and the exact write action that would be performed.
   - When useful, write local drafts under `.ephemeral/`.
   - Before writing, apply the canonical `.ephemeral` safety guard: create `.ephemeral/` if it does not exist, refuse to write if `.ephemeral` exists as a symlink, and verify the target is a direct child of `.ephemeral/` (no nested paths, `..`, or absolute paths) before writing.
   - Use only these direct-child filenames for draft artifacts:
     - `<project-slug>-project-update-draft.md` for the postable body.
     - `<project-slug>-project-update-evidence.md` for evidence and issue/PR appendix.
   - If those files already exist and the user did not ask to replace them, write timestamped direct-child variants instead of silently overwriting.
   - The proposed write action must update the latest project update ID. Do not propose creating a new project update unless the user explicitly asked for a new update.

7. Apply output.
   - Update only the latest project update unless the user says to create a new one.
   - Set the recommended health and update body.
   - Re-read the project update after writing and report final health plus a concise summary.
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

For the write action, use an update command against the latest update ID:

```bash
linear-cli pu update UPDATE_ID --health atRisk -b "$BODY"
```

## Writing Rules

- Keep the body under one minute to read.
- Separate confirmed facts from inference in dry-run explanations.
- Do not mention every issue.
- Do not hide blockers or failing checks.
- Do not call normal review activity a blocker unless it blocks the target date or core scope.
- If applying, use the exact body from the draft file or the user-approved revision.
