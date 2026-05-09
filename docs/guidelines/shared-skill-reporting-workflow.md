# Shared Skill Reporting Workflow

This guide explains how to upstream reusable shared-skill and shared-agent discoveries from consumer repositories into DevCanon.

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

## 2. Scope: What to Describe

The Scope rule — including the positive frame, the categories-vs-identity boundary, and the negative list of items that must never appear in an issue body or title — is canonically defined in [`skills/report-devcanon-shared-issue/SKILL.md` § Scope: What to Describe](../../skills/report-devcanon-shared-issue/SKILL.md#scope-what-to-describe). Apply that rule when filling any body field below.

## 3. Reporting Flow

1. Invoke `report-devcanon-shared-issue` from the consumer repo.
2. Capture the minimum issue payload:
   - consumer repo or sanitized project descriptor
   - affected shared skill or agent
   - target (`codex`, `claude`, or both)
   - issue type (`bug`, `improvement`, `new skill`, `new agent`)
   - observed behavior and expected behavior
   - minimal reproduction summary
   - user impact or severity
   - install mode and sanitized artifact path
   - `devcanon` revision, branch, or version, if known
   - whether the problem still reproduces after `render` and after `sync`
   - excerpt safety and redaction status
   - blocker issue IDs, if known
   - optional proposed direction
3. Apply the § 2 Scope rule to the body. For any quoted material, follow the Redaction Gate in [`skills/report-devcanon-shared-issue/SKILL.md` § Redaction Gate](../../skills/report-devcanon-shared-issue/SKILL.md#redaction-gate). The redaction rules are canonical there.
4. Search open `ryumiel/agent-manager` issues for likely duplicates before opening a new one, using only sanitized shared-component terms rather than raw consumer identifiers or local paths.
5. Confirm the final draft before posting.

If the user declines posting, keep the exact draft available for manual reuse. If posting fails, preserve the drafted title and body and report the failure. If the reproduction is incomplete, draft the issue anyway but mark the missing detail explicitly. If GitHub access to `ryumiel/agent-manager` is unavailable, stop at a reusable draft instead of attempting to post.

## 4. Issue Shape

Use the issue body shape canonically defined in [`../../WORKFLOW.md` § Creating an Issue](../../WORKFLOW.md#creating-an-issue).

For title format and `(scope)` rules, see [`../../skills/report-devcanon-shared-issue/SKILL.md` § Issue Draft Shape](../../skills/report-devcanon-shared-issue/SKILL.md#issue-draft-shape).

When filling WORKFLOW.md's "Environment and provenance" body field for a shared-skill or shared-agent report, include target (`codex`, `claude`, or both), install mode (`symlink`, `copy`, or `unknown`), `devcanon` revision/branch/version, and whether the problem still reproduces after `render` and after `sync`. These fields are gathered per § 3 step 2.

If blocker issue IDs are known, set the actual GitHub `blocked by` relationship after issue creation instead of only mentioning blockers in the body text.

## 5. Upstream Fix Loop

<!-- Canonical home for the retest loop. skills/report-devcanon-shared-issue/SKILL.md § Upstream Fix Loop mirrors these steps in spirit. Update both together when the loop changes. -->

The fix happens only in `devcanon` source files.

Local retest loop:

1. `pnpm run dev -- validate`
2. `pnpm run dev -- render`
3. in `symlink` mode, test again from the consumer repository
4. in `copy` mode, run `pnpm run dev -- sync` before retesting from the consumer repository
5. run `pnpm run dev -- sync` when the change is ready to install and the installed managed outputs should be updated

Install-mode note:

- In `symlink` mode, `render` is usually enough for iteration because installed outputs reflect generated outputs directly.
- In `copy` mode, installed outputs do not refresh from `render` alone, so run `sync` before any consumer-repo retest.

For install ownership and overwrite behavior, see:

- [`../specs/install-and-sync.md`](../specs/install-and-sync.md)
- [`../specs/skills.md`](../specs/skills.md)
- [`../adr/adr-0005-per-target-skill-rendering.md`](../adr/adr-0005-per-target-skill-rendering.md)
