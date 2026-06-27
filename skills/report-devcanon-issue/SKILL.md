---
name: report-devcanon-issue
description: Drafts an upstream DevCanon issue for a reusable shared-skill or shared-agent need surfaced from a consumer repo. Use when the user explicitly asks to draft or create an upstream DevCanon issue for a reusable shared skill or shared agent problem, or when a sanitized PR-comment follow-up explicitly requests filing one.
codex:
  license: MIT
  metadata:
    short-description: Draft an upstream shared-work issue for DevCanon from a consumer repository
codex_sidecar:
  interface:
    display_name: Report Shared Issue
    short_description: Draft and post reusable shared-work issues to DevCanon
    icon_small: ./assets/codex-skill-icon-small.png
    icon_large: ./assets/codex-skill-icon-large.png
    brand_color: "#0f766e"
---

# Report Shared Issue

Use this skill when the user explicitly asks to draft or create an upstream
DevCanon issue for a reusable problem or gap in a shared `DevCanon` skill or
shared `DevCanon` agent, or when a sanitized PR-comment follow-up explicitly
requests filing one.

During PR work, default to a sanitized PR comment first unless the user
explicitly requested an upstream DevCanon issue. A sanitized PR-comment
follow-up that explicitly requests a reusable upstream DevCanon issue draft can
also continue through this skill. Do not use this skill for project-local prompt
tweaks, domain-specific wording, or issues that would make the shared skill
worse for general use.

## Goal

Turn a fuzzy cross-repo discovery into a clean upstream GitHub issue draft for `DevCanon` without leaking unsafe material.

The upstream GitHub repository for issue search and posting is `ryumiel/devcanon`.

## Scope: What to Describe

<!-- Canonical safety rule. The playbook (docs/guidelines/shared-skill-reporting-workflow.md § 2) forwards here as the single source of truth. -->

Describe only `DevCanon`-side facts in the issue body:

- the affected shared skill or shared agent
- the expected vs. observed _shared_ behavior — the part that would be wrong on any consumer repo
- relevant `DevCanon` source-of-truth paths (`skills/`, `agents/`, `docs/`, `src/`)
- render, install, or spec context

Consumer-side context is allowed only when necessary for reproduction, and only as a sanitized category (e.g. "pnpm workspace with hoisted deps", "monorepo with two TS rootDirs") — never as identity.

Categories describe shape (workspace layout, target type, install mode); they must not include org names, repo paths, hostnames, registry URLs, internal tool names, or specific tool versions unless the version is itself the bug.

The following are never required and must not appear in the issue body or title:

- consumer repo names, owners, orgs, or codenames
- usernames, hostnames, ticket IDs
- absolute paths like `/Users/...` or `/home/...`; use repo-relative paths or `<install-root>/...`
- customer or end-user identifiers, names, emails, phone numbers
- proprietary code, secrets, internal URLs
- machine and network identifiers: IP addresses, MAC addresses, device IDs, internal hostnames embedded in stack frames or URLs
- account, session, and credential identifiers: cloud account/project/tenant IDs (AWS, GCP, Azure), API tokens in URLs (`?token=...`), `Authorization: Bearer ...` values, session/request/trace/correlation IDs, JWT fragments, signed-URL signatures, DB connection strings

## Interaction Rules

- Ask one question at a time until the minimum payload is complete.
- Apply the `Agent-Local Evidence Reuse Boundary` in
  `docs/specs/afds-workflow-routing.md` for shared issue drafts.
- Use summarized reproductions; do not include verbatim prompt, transcript,
  log, stack, validation-log, or agent-local artifact excerpts in this workflow
  boundary.
- Before showing the final draft for confirmation, sweep the title, body, and labels one last time against the negative list under § Scope: What to Describe, and re-check any quoted material against § Redaction Gate.
- Never post an issue without showing the exact draft first and receiving explicit confirmation.
- If the user declines posting, keep the exact draft available for manual reuse.
- If posting fails, preserve the drafted title and body and explain what failed.
- If GitHub access to `ryumiel/devcanon` is unavailable, return `MODE=draft` and stop without attempting to post.

## Minimum Payload

Capture:

- consumer repository or sanitized project descriptor
- affected shared skill or shared agent, if one exists
- target environment: `codex`, `claude`, or both
- issue type: `bug`, `improvement`, `new skill`, or `new agent`
- observed behavior
- expected behavior
- minimal reproduction summary
- summary-only prompt, transcript, log, stack, or validation context when needed
  to explain the shared problem
- user impact or severity
- install mode: `symlink`, `copy`, or `unknown`
- sanitized artifact path, if known
- Prefer DevCanon version, revision, or commit SHA for shared issue provenance;
  include branch or worktree names only when sanitized and necessary; otherwise
  omit them
- whether the problem still reproduces after `render`: `yes`, `no`, `not-tried`, or `unknown`
- whether the problem still reproduces after `sync`: `yes`, `no`, `not-tried`, or `unknown`
- redaction and safety status for any summarized or omitted material
- blocker issue IDs, if known
- optional proposed direction

This is the data to gather. The body shape it maps into is canonically defined in [`WORKFLOW.md` § Creating an Issue](https://github.com/ryumiel/devcanon/blob/main/WORKFLOW.md#creating-an-issue).

If the reporter cannot provide a complete reproduction, continue with an
incomplete issue draft and explicitly call out what is still missing.

## Redaction Gate

The `Scope` rule above is the primary defense — if the body only describes `DevCanon`-side facts, most leak vectors do not apply. Before posting, sweep any quoted material for these specific risks:

- prompt, transcript, log, stack, validation-log, and agent-local artifact
  content: use summary-only context for this workflow boundary, even when a
  user pasted the original text
- Do not quote sanitized individual stack frames, log lines, prompt excerpts,
  transcript excerpts, validation-log lines, or agent-local artifact excerpts in
  shared issue bodies.
- error messages: strip env vars, request/trace/correlation IDs, internal URLs and hostnames, IP addresses, file paths, tokens (`Bearer …`, `?token=…`), cloud account/project/tenant IDs, customer/user IDs, and any embedded JSON keys ending in `_id`, `_token`, `_secret`, or `_key`; when in doubt, summarize the error class instead of quoting the message

For prompt, transcript, log, stack, validation-log, or agent-local artifact
material, use a summary-only reproduction and say what was omitted.

## Duplicate Check

Before presenting a new draft, search open `ryumiel/devcanon` issues for likely duplicates using the affected skill or agent name plus sanitized summary and reproduction terms.

Never use raw consumer repository names, usernames, hostnames, or local path fragments in duplicate-search queries.

If a likely duplicate exists, offer three paths:

- reuse the existing issue
- create a new issue with a note explaining why it is distinct
- stop without posting

## Issue Draft Shape

Title:

- use `type(scope): short summary` or `type: short summary`
- `bug` -> `fix(...)` title with `bug` label
- `improvement` -> `feat(...)` when behavior changes are user-visible, `refactor(...)` when the work is internal cleanup; default label `enhancement`, optional `tech-debt` for structural cleanup
- `new skill` -> `feat(skill): ...` with `enhancement`
- `new agent` -> `feat(agent): ...` with `enhancement`
- the `(scope)` slot must reference an upstream `DevCanon` component (`skill`, `agent`, `render`, `install`, `docs`, `cli`) — never a consumer repo, customer, codename, or ticket ID

Body sections: use the body shape canonically defined in [`WORKFLOW.md` § Creating an Issue](https://github.com/ryumiel/devcanon/blob/main/WORKFLOW.md#creating-an-issue).

If blocker issue IDs are known, apply the GitHub `blocked by` relationship after issue creation instead of only mentioning blockers in the body text.

## Upstream Fix Loop

<!-- Mirrors docs/guidelines/shared-skill-reporting-workflow.md § Upstream Fix Loop in spirit; canonical retest steps live there. Update both together when the loop changes. -->

When the discovery is confirmed to be reusable, tell the user that the fix
happens only in `DevCanon` source files.

Recommend this local retest loop:

1. `pnpm run dev -- validate`
2. `pnpm run dev -- render`
3. in `symlink` mode, test again from the consumer repository
4. in `copy` mode, run `pnpm run dev -- sync` before retesting from the consumer repository
5. run `pnpm run dev -- sync` when the change is ready to install and the managed outputs should be updated

Install-mode note:

- in `symlink` mode, `render` is usually enough for most iterations because
  installed outputs reflect generated outputs directly
- in `copy` mode, installed outputs do not refresh from `render` alone, so run
  `sync` before any consumer-repo retest

## Output Contract

At the end of every invocation, surface exactly one of these `MODE=...` tokens to the user, indicating outcome:

- `MODE=local`
  - the issue is project-local
  - explain why and recommend keeping the change in the consumer repo
- `MODE=needs-input`
  - more information is required
  - ask the next single question needed to continue
- `MODE=reused`
  - a likely-duplicate upstream issue already exists and the user chose to reuse it
  - return the reused issue URL and number
- `MODE=draft`
  - show likely duplicates first when they exist
  - produce the exact title, body, and labels
  - report the result of the § Interaction Rules sweep, calling out any categories that required active redaction
  - ask for confirmation before posting
  - Never post the issue from a PR-comment follow-up without showing the draft
    and receiving explicit user confirmation
- `MODE=posted`
  - the issue was created successfully
  - return the created issue URL and number
- `MODE=posted-needs-followup`
  - the issue was created, but a follow-up action such as blocker-linking failed
  - return the created issue URL and number plus the remaining action

If the user chooses not to post after seeing `MODE=draft`, keep the exact
title/body draft in the conversation for manual reuse.

## Classification Rules

- Use `MODE=local` when the requested behavior depends on one repository's domain language, private data, or one-off workflow.
- Continue toward `MODE=draft` when the user explicitly requested an upstream
  DevCanon issue and the problem comes from shared instructions, shared render
  or install behavior, or a reusable missing capability.
- Continue toward `MODE=draft` when a sanitized PR-comment follow-up explicitly
  requests an upstream DevCanon issue for a reusable shared-skill or
  shared-agent problem.
- Use `MODE=needs-input` when reusability is plausible but not yet clear.

If the report touches process, policy, schema, or spec behavior, note that
implementation may require additional approval under the repository rules even
when the report itself is reusable and worth filing.
