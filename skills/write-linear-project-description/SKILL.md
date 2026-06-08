---
name: write-linear-project-description
description: Writes durable Linear project descriptions and content briefs. Use when asked to draft, dry-run, apply, revise, or update a Linear project's short description or detailed content/brief. Do not use when writing time-windowed project updates, health reports, or update history posts.
codex_sidecar:
  interface:
    display_name: Write Linear Project Description
    short_description: Write Linear project descriptions and briefs
    brand_color: "#5e6ad2"
    default_prompt: Use $write-linear-project-description to draft a Linear project description or content brief in draft mode.
---

# Write Linear Project Description

Use this skill for durable Linear project summaries, descriptions, and content briefs.

Do not use this skill for time-windowed project updates, health reports, or update history posts; use `write-linear-project-update` for those.

This skill must not create project updates, mutate project lifecycle status, create issues, bulk-edit issues, or sync installed user-home outputs.

## Workflow

1. Resolve the project.
   - Accept a Linear project URL, ID, slug, or name.
   - Read the current project `description` and `content` before drafting.
   - If either field is empty, report that no prior field content existed.
   - Read project state, lead, members, target date, or milestone context only when useful for stakeholder framing.
   - Inspect issues, project updates, or repository evidence only when needed to make stakeholder framing accurate.

2. Determine the target field.
   - Use `description` for a short stakeholder-facing project summary.
   - Use `content` for a detailed durable project brief when the user explicitly targets the detailed content field.
   - Update both fields only when the user explicitly asks for both.
   - If the target field is ambiguous, stop and ask which field to update before drafting or applying.
   - Do not infer a field from phrases such as "project brief", "project description/content", or "stakeholder summary".

3. Gather style and context evidence.
   - Treat existing project fields as the primary continuity evidence.
   - Treat project update IDs, update bodies, examples, and user-provided references as style evidence only unless the user explicitly names them as mutation targets.
   - Do not mutate a referenced project update when it was provided as a style reference.
   - Keep source evidence separate from the postable field body unless the user asks for an evidence appendix.

4. Draft the requested field body.
   - Default to draft mode.
   - Draft mode must not modify Linear.
   - Call the bundled draft helper before writing draft bodies.
   - Write the short description draft, detailed content draft, or both draft files using the helper-returned paths.
   - Report the exact field or fields that would be applied.

5. Apply only on explicit mutation intent.
   - Use Apply Mode below.
   - Apply only the selected field or fields.
   - Stop before mutation if the project, target field, or approved body is missing or ambiguous.

## Draft Helper

Run the bundled helper from the repository root before writing draft bodies.

```bash
WRITE_LINEAR_PROJECT_DESCRIPTION_DIR="<installed-write-linear-project-description-skill-bundle>"
PROJECT_KEY="$PROJECT_KEY" \
TARGET_FIELDS="$TARGET_FIELDS" \
REPLACE_EXISTING="$REPLACE_EXISTING" \
  bash "$WRITE_LINEAR_PROJECT_DESCRIPTION_DIR/scripts/prepare-project-description-draft.sh"
```

The helper prepares direct-child `.ephemeral/` paths and does not write draft body content. The controller writes draft content only after the helper returns paths successfully.

Inputs:

- `PROJECT_KEY`: safe project key used in draft filenames.
- `TARGET_FIELDS`: `description`, `content`, or `both`.
- `REPLACE_EXISTING`: `true` or `false`.

Outputs:

- `<project-key>-project-description-draft.md` for `description`.
- `<project-key>-project-content-brief-draft.md` for `content`.
- Both paths, one per line, for `both`.

If the helper exits nonzero, stop instead of writing a draft.

## Apply Mode

Apply only when the user explicitly asks to apply or update Linear.

Use the exact approved draft body or user-approved revision. Do not apply a body merely because it was generated in draft mode.

For the short project summary:

```bash
linear-cli p update <PROJECT> --description "$BODY"
```

For the detailed project content or brief:

```bash
linear-cli p update <PROJECT> --content "$BODY"
```

Re-read the project after writing and verify the stored field matches the applied value. Report verification mismatch as a failure instead of inferring success from command exit.

Do not use Linear project-update create or update commands; those commands belong to project updates, not durable project metadata.

## Writing Rules

- Write stakeholder-facing framing, not implementation inventory.
- Prefer durable goal, stakeholder-visible outcomes, current focus, parallel validation tracks, scope boundaries, and completion criteria.
- Avoid issue-ID-heavy implementation inventory in stakeholder-facing descriptions and briefs unless the user asks for it.
- Keep raw issue IDs, PR links, counts, and audit evidence out of the postable field body by default.
- Preserve useful existing framing when revising.
- Match the project's working language when the current fields or user request make it clear.
- Treat project update IDs, update bodies, examples, and user-provided references as style evidence only unless the user explicitly names them as mutation targets.
- Do not mutate a referenced project update when it was provided as a style reference.
- Match user-provided style references only for useful tone, structure, density, and formatting conventions.
- Separate confirmed facts from inference in draft explanations.

## Evidence Commands

Prefer the Linear CLI when available:

```bash
linear-cli p list --output json
linear-cli p get PROJECT_ID --output json
linear-cli api query --output json 'query { project(id: "PROJECT_ID") { id name description content state lead { name } members(first: 50) { nodes { name } } targetDate } }'
```

Use GraphQL when normal project reads omit `description`, `content`, or other fields needed to verify the stored result.

## Common Mistakes

| Mistake                                                                            | Correction                                                                                               |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Reusing `write-linear-project-update` because it has stakeholder writing guidance. | Use this skill for durable `description` and `content` fields; updates are time-windowed status reports. |
| Treating "project brief" as automatically meaning `content`.                       | Ask which field to update when the target field is ambiguous.                                            |
| Applying both fields because both could use improvement.                           | Update both only when explicitly requested.                                                              |
| Putting issue IDs and PR links into the postable brief by default.                 | Keep evidence out of the field body unless requested.                                                    |
| Mutating a referenced project update used as a style example.                      | Treat style references as evidence only.                                                                 |
| Trusting a successful update command without checking the stored field.            | Re-read the project and verify the selected field.                                                       |
