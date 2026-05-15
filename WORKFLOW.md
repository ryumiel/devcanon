# Contributor Workflow

This document is the procedural guide for contributing to the repository. For policies and rules, see [CONTRIBUTING.md](CONTRIBUTING.md). For repository orientation, see [AGENTS.md](AGENTS.md). For autonomy boundaries, see [AGENTS.md](AGENTS.md#decision-matrix).

## Quick Reference Table

| I want to...                                | Go to                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Pick my next task                           | [Picking Work](#picking-work)                                                                            |
| Report a bug or propose work                | [Creating an Issue](#creating-an-issue)                                                                  |
| Report a shared-skill or shared-agent issue | [docs/guidelines/shared-skill-reporting-workflow.md](docs/guidelines/shared-skill-reporting-workflow.md) |
| Implement a change                          | [Implementing](#implementing)                                                                            |
| Open a pull request                         | [Opening a PR](#opening-a-pr)                                                                            |
| Know what I can do freely                   | [AGENTS.md § Decision Matrix](AGENTS.md#decision-matrix)                                                 |
| Review code                                 | [docs/guidelines/code-review-guideline.md](docs/guidelines/code-review-guideline.md)                     |

## Picking Work

1. Check open issues in the external issue tracker. For GitHub Issues, run
   `gh issue list --state open`; Linear-backed projects use the team's Linear
   workspace.
2. Do not start an issue whose blocker dependencies are still open
3. If no suitable issue exists and you found a problem, create one first (next section)

## Creating an Issue

- **Title**: Use a Conventional Commits-style prefix: `type(scope): short summary` or `type: short summary`
- **Body structure**:
  - Problem statement: what is wrong or missing
  - Expected behavior: what should happen instead
  - Acceptance criteria: observable conditions that mean "done"
  - Reproduction: the minimum safe summary or sanitized excerpt
  - Environment and provenance: tool version, OS, and install mode if relevant
  - Affected areas: source-of-truth paths involved (e.g. `src/`, `docs/`, `skills/`, `agents/`); if the exact area is unknown, say that explicitly
  - Dependencies or blockers: related issues and blocker relationships
  - Notes: anything the implementer needs that does not fit above
- **Dependencies**: If this issue cannot start until another closes, set the
  equivalent blocker relationship in the external issue tracker.
- **Workflow path**: Use the [AI-assisted product workflow guideline](docs/guidelines/ai-assisted-product-workflow-guideline.md) to choose between shaping an owning durable AFDS artifact first and implementing an already-sliced issue.
- **Labels**: `bug` for defects, `enhancement` for features, `tech-debt` for structural debt

### When the issue is about a shared skill or agent

- Do not edit installed managed outputs under `~/.agents/skills/`, `~/.claude/skills/`, `~/.codex/agents/*.toml`, or `~/.claude/agents/*.md` -- these are disposable outputs.
- Draft an upstream issue for DevCanon in `ryumiel/agent-manager` first using `report-devcanon-shared-issue`.
- For the full playbook including the local retest loop, see [`docs/guidelines/shared-skill-reporting-workflow.md`](docs/guidelines/shared-skill-reporting-workflow.md).

## Implementing

1. Branch from `main` using the branch naming convention from [CONTRIBUTING.md](CONTRIBUTING.md#branch-naming): `<type>/<scope>-<short-description>` or `<type>/<short-description>`
2. Read the issue body and any linked docs before writing code
3. Confirm the workflow path and spec need using [docs/guidelines/ai-assisted-product-workflow-guideline.md](docs/guidelines/ai-assisted-product-workflow-guideline.md). If no spec is needed, record the reason in the PR body or documentation review checklist.
4. Run local validation before committing: `pnpm run check`
5. Commit using Conventional Commits (see [CONTRIBUTING.md § Commit Policy](CONTRIBUTING.md#commit-policy))
6. Keep scope tight: one issue, one PR. Do not bundle unrelated changes.

## Opening a PR

1. Title and description must follow the [PR Guideline](docs/guidelines/pr-guideline.md)
2. Reference the external issue. For GitHub Issues, include `Closes #N`,
   `Resolves #N`, or `Part of #N`; for Linear, include the team issue key or
   link. Use `No issue: <reason>` only when the PR is intentionally not tied to
   an external issue.
3. Run the self-review checklist from the [code review guideline](docs/guidelines/code-review-guideline.md#7-self-review-checklist)
4. Answer every item in the [CONTRIBUTING.md](CONTRIBUTING.md#pull-request-policy) PR policy checklist

## Post-Merge

1. Verify the issue is closed
2. Create follow-up issues for gaps identified during review -- do not expand the merged PR's scope retroactively
