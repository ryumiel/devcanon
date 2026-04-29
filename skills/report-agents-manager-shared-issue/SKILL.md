---
name: report-agents-manager-shared-issue
description: Use when a reusable shared skill or shared agent problem is discovered in a consumer repository and should be drafted as an upstream agents-manager issue. Also use for requests for new shared skills or shared agents when the need is reusable across repositories.
codex:
  license: MIT
  metadata:
    short-description: Draft an upstream shared-work issue for agents-manager from a consumer repository
codex_sidecar:
  interface:
    display_name: Report Shared Issue
    short_description: Draft and post reusable shared-work issues to agents-manager
    brand_color: "#0f766e"
---

# Report Shared Issue

Use this skill when working in a consumer repository and you discover a reusable problem or gap in a shared `agents-manager` skill or shared `agents-manager` agent.

Do not use this skill for project-local prompt tweaks, domain-specific wording, or issues that would make the shared skill worse for general use.

## Goal

Turn a fuzzy cross-repo discovery into a clean upstream GitHub issue draft for `agents-manager` without leaking unsafe material.

The upstream GitHub repository for issue search and posting is `ryumiel/agent-manager`.

## Interaction Rules

- Ask one question at a time until the minimum payload is complete.
- Prefer summarized reproductions over verbatim transcript excerpts.
- Never post an issue without showing the exact draft first and receiving explicit confirmation.
- If the user declines posting, keep the exact draft available for manual reuse.
- If posting fails, preserve the drafted title and body and explain what failed.
- If GitHub access to `ryumiel/agent-manager` is unavailable, stop at `MODE=draft`.

## Minimum Payload

Capture:

- consumer repository or sanitized project descriptor
- affected shared skill or shared agent, if one exists
- target environment: `codex`, `claude`, or both
- issue type: `bug`, `improvement`, `new skill`, or `new agent`
- observed behavior
- expected behavior
- minimal reproduction summary
- optional verbatim prompt or transcript excerpt only after explicit safety confirmation
- user impact or severity
- install mode: `symlink`, `copy`, or `unknown`
- sanitized artifact path, if known
- `agents-manager` revision, branch, or version, if known
- whether the problem still reproduces after `render`: `yes`, `no`, `not-tried`, or `unknown`
- whether the problem still reproduces after `sync`: `yes`, `no`, `not-tried`, or `unknown`
- redaction and safety status for any quoted material
- blocker issue IDs, if known
- optional proposed direction

If the reporter cannot provide a complete reproduction, continue with an
incomplete issue draft and explicitly call out what is still missing.

## Redaction Gate

Before drafting the issue:

- remove or replace secrets, internal URLs, customer identifiers, and proprietary code
- replace private repository names, usernames, hostnames, and workstation-specific path segments when they are not already public
- ask the user to confirm any verbatim excerpt is safe to publish
- prefer repo-relative paths or placeholders over raw local absolute paths
- if a safe verbatim excerpt is not possible, use a summary-only reproduction and say what was omitted

## Duplicate Check

Before presenting a new draft, search open `ryumiel/agent-manager` issues for likely duplicates using the affected skill or agent name plus sanitized summary and reproduction terms.

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

Body sections:

1. Problem statement
2. Expected behavior
3. Acceptance criteria
4. Reproduction
5. Environment and provenance
6. Affected areas
7. Dependencies or blockers
8. Notes

`Affected areas` should name source-of-truth paths such as `skills/`, `agents/`, `docs/`, and `src/`. If the exact area is unknown, say that explicitly.

If blocker issue IDs are known, apply the GitHub `blocked by` relationship after issue creation instead of only mentioning blockers in the body text.

## Upstream Fix Loop

When the discovery is confirmed to be reusable, tell the user that the fix
happens only in `agents-manager` source files.

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

Use one of these explicit outcomes:

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
  - ask for confirmation before posting
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
- Continue toward `MODE=draft` when the problem comes from shared instructions, shared render or install behavior, or a reusable missing capability.
- Use `MODE=needs-input` when reusability is plausible but not yet clear.

If the report touches process, policy, schema, or spec behavior, note that
implementation may require additional approval under the repository rules even
when the report itself is reusable and worth filing.
