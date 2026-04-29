# Shared Skill Reporting Workflow

This guide explains how to upstream reusable shared-skill and shared-agent discoveries from consumer repositories into `agents-manager`.

For the canonical contributor procedure, see [`../../WORKFLOW.md`](../../WORKFLOW.md). For ownership rules about docs versus issues versus PRs, see [`project-management-model.md`](project-management-model.md).

## 1. When to Upstream

Upstream the discovery when it is caused by:

- shared skill or agent instructions
- shared render/install behavior
- a missing reusable capability that would benefit multiple repositories

Keep the change local when it depends on:

- one repository's domain language
- private or customer-specific data
- a one-off local workflow that would make the shared skill worse for general use

## 2. Reporting Flow

1. Invoke `report-agents-manager-shared-issue` from the consumer repo.
2. Capture the minimum issue payload:
   - consumer repo or project
   - affected shared skill or agent
   - target (`codex`, `claude`, or both)
   - issue type (`bug`, `improvement`, `new skill`, `new agent`)
   - observed behavior and expected behavior
   - minimal reproduction summary
   - user impact or severity
   - install mode and artifact provenance
   - `agents-manager` revision, branch, or version, if known
   - whether the problem still reproduces after `render` and after `sync`
   - excerpt safety and redaction status
   - blocker issue IDs, if known
   - optional proposed direction
3. Redact secrets, internal URLs, customer data, and unsafe code excerpts before posting.
4. Search open `agents-manager` issues for likely duplicates before opening a new one.
5. Confirm the final draft before posting.

If the user declines posting, keep the exact draft available for manual reuse. If posting fails, preserve the drafted title and body and report the failure. If the reproduction is incomplete, draft the issue anyway but mark the missing detail explicitly.

## 3. Issue Shape

Use the issue shape documented in [`../../WORKFLOW.md`](../../WORKFLOW.md):

- Conventional-Commits-style title
- Problem statement
- Expected behavior
- Acceptance criteria
- Reproduction
- Environment and provenance
- Affected areas
- Dependencies or blockers
- Notes

If blocker issue IDs are known, set the actual GitHub `blocked by` relationship after issue creation instead of only mentioning blockers in body text.

## 4. Upstream Fix Loop

The fix happens only in `agents-manager` source files.

Local retest loop:

1. `pnpm run dev -- validate`
2. `pnpm run dev -- render`
3. test again from the consumer repository
4. `pnpm run dev -- sync` when the change is ready to install

Install-mode note:

- In `symlink` mode, `render` is usually enough for iteration because installed outputs reflect generated outputs directly.
- In `copy` mode, rerun `sync` to propagate changes before retesting.

For install ownership and overwrite behavior, see:

- [`../specs/install-and-sync.md`](../specs/install-and-sync.md)
- [`../specs/skills.md`](../specs/skills.md)
- [`../adr/adr-0005-per-target-skill-rendering.md`](../adr/adr-0005-per-target-skill-rendering.md)
