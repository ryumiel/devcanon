# Contributor Workflow

This document is the procedural guide for contributing to the repository. For policies and rules, see [CONTRIBUTING.md](CONTRIBUTING.md). For repository orientation, see [AGENTS.md](AGENTS.md). For autonomy boundaries, see [AGENTS.md](AGENTS.md#decision-matrix).

## Quick Reference Table

| I want to...                 | Go to                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| Pick my next task            | [Picking Work](#picking-work)                                                        |
| Report a bug or propose work | [Creating an Issue](#creating-an-issue)                                              |
| Implement a change           | [Implementing](#implementing)                                                        |
| Open a pull request          | [Opening a PR](#opening-a-pr)                                                        |
| Know what I can do freely    | [AGENTS.md § Decision Matrix](AGENTS.md#decision-matrix)                             |
| Review code                  | [docs/guidelines/code-review-guideline.md](docs/guidelines/code-review-guideline.md) |

## Picking Work

1. Check open issues: `gh issue list --state open`
2. Do not start an issue whose `blocked by` dependencies are still open
3. If no suitable issue exists and you found a problem, create one first (next section)

## Creating an Issue

- **Title**: Use a Conventional Commits-style prefix: `type(scope): short summary` or `type: short summary`
- **Body structure**:
  - Problem statement: what is wrong or missing
  - Expected behavior: what should happen instead
  - Acceptance criteria: observable conditions that mean "done"
  - Reproduction: the minimum safe summary or sanitized excerpt
  - Environment and provenance: install mode, artifact path, revision, and `render` / `sync` reproduction state
  - Affected areas: which source-of-truth paths are involved (`skills/`, `docs/`, `src/`, and `agents/` when that directory exists in the checkout)
  - Dependencies or blockers: related issues and `blocked by` relationships
  - Notes: anything the implementer needs that does not fit above
- **Dependencies**: If this issue cannot start until another closes, set a `blocked by` relationship in GitHub
- **Labels**: `bug` for defects, `enhancement` for features, `tech-debt` for structural debt

## Reporting Shared Skill or Agent Problems from Consumer Repos

- If you discover a reusable shared-skill or shared-agent problem while working in another repository, do not edit the managed installed copy under `~/.agents/skills/` or `~/.claude/skills/`.
- Draft an upstream issue for `agents-manager` first using `report-agents-manager-shared-issue`.
- Use the local retest loop during upstream work: `agents-manager validate -> agents-manager render -> test in the consumer repo -> agents-manager sync` when the change is ready to install.
- For the full playbook, see [`docs/guidelines/shared-skill-reporting-workflow.md`](docs/guidelines/shared-skill-reporting-workflow.md).

## Implementing

1. Branch from `main` using the branch naming convention from [CONTRIBUTING.md](CONTRIBUTING.md#branch-naming): `<type>/<scope>-<short-description>` or `<type>/<short-description>`
2. Read the issue body and any linked docs before writing code
3. Run local validation before committing: `pnpm run check`
4. Commit using Conventional Commits (see [CONTRIBUTING.md § Commit Policy](CONTRIBUTING.md#commit-policy))
5. Keep scope tight: one issue, one PR. Do not bundle unrelated changes.

## Opening a PR

1. Title and description must follow the [PR Guideline](docs/guidelines/pr-guideline.md)
2. Reference the issue: include `Closes #N` or `Resolves #N`
3. Run the self-review checklist from the [code review guideline](docs/guidelines/code-review-guideline.md#5-self-review-checklist)
4. Answer every item in the [CONTRIBUTING.md](CONTRIBUTING.md#pull-request-policy) PR policy checklist

## Post-Merge

1. Verify the issue is closed
2. Create follow-up issues for gaps identified during review -- do not expand the merged PR's scope retroactively
