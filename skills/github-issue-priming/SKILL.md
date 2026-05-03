---
name: github-issue-priming
description: Primes a GitHub issue into a research-backed implementation workflow with isolated worktree and brainstorming. Use when starting work on a GitHub issue — triggers on issue numbers, issue URLs, or phrases like "start issue", "work on issue", "prime issue".
claude:
  model: "{{model:deep}}"
codex:
  license: MIT
  metadata:
    short-description: Prime a GitHub issue into a research-backed implementation workflow
codex_sidecar:
  interface:
    display_name: GitHub Issue Priming
    short_description: Research and stage a GitHub issue for implementation
    brand_color: "#24292f"
---

# GitHub Issue Priming

Fetch a GitHub issue and hand off to the shared `issue-priming-workflow` skill, which sets up an isolated worktree, runs the complexity gate, optionally researches, brainstorms, and (in `--auto` mode) plans, implements, reviews, and creates a PR. This entrypoint owns the GitHub-specific fetch and issue-number handling; everything downstream lives in the shared workflow.

## Arguments

| Arg                   | Effect                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<number>` or `<url>` | Issue to work on (required)                                                                                                                         |
| `--research`          | Skip gate, go directly to research                                                                                                                  |
| `--auto`              | Autonomous mode: skip user review gates, pick the architecturally cleanest option, write plan, and execute via `play-subagent-execution` end-to-end |

Examples: `/github-issue-priming 149`, `/github-issue-priming 149 --auto`, `/github-issue-priming --auto --research 149`

## Phase 0: Fetch the Issue

Parse the argument — accept an issue number or a full GitHub URL.

```bash
gh issue view <N> --json title,body,labels,comments,assignees
```

Present a one-line summary to the user:

> Issue #153: refactor(kiki-dcs): replace DcsError::Io #[from] io::Error (tech-debt)

If the issue cannot be fetched (`gh` not authenticated, issue not found), stop and report the error.

### Derive branch and worktree names

- **Branch name:** `<type>/<N>-<title-slug>` (e.g. `refactor/149-patcher-operation-error`). `<type>` is the conventional-commit type that best matches the issue (`feat`, `fix`, `refactor`, `docs`, etc.).
- **Worktree leaf:** `<N>-<title-slug>` (e.g. `149-patcher-operation-error`).

Slug rules apply to the `<title-slug>` segment only: lowercase, kebab-case, alphanumeric-and-hyphen only, max ~40 chars.

## Hand off to `issue-priming-workflow`

Invoke the `issue-priming-workflow` skill with the following normalized issue payload:

```
## Issue Payload

- **source**: github
- **identifier**: #<N>
- **title**: <verbatim issue title, single line>
- **body**: |
    <verbatim issue body, multi-line, indented>
- **mode**: <interactive | auto>
- **research**: <gated | forced>
- **branch-name**: <branch-name from above>
- **worktree-leaf**: <worktree-leaf from above>
```

The `mode` field is `auto` when `--auto` was passed and `interactive` otherwise. The `research` field is `forced` when `--research` was passed and `gated` otherwise.

The workflow handles every subsequent phase (worktree setup, gate, research, brainstorming, planning, implementation, branch review, PR creation). Do not duplicate workflow logic here.

## Error Handling

| Scenario               | Action                            |
| ---------------------- | --------------------------------- |
| `gh` not authenticated | Stop, suggest `! gh auth login`   |
| Issue not found        | Stop, verify number/URL           |
| Issue already closed   | Warn user, ask whether to proceed |

(Workflow-level errors — gate agent failures, research timeouts, missing `docs/adr/` — are handled inside `issue-priming-workflow`. See its Error Handling section.)
