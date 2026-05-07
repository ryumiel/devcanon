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

Fetch a GitHub issue, provision or reuse the issue worktree, write the fetched issue body to `.ephemeral/`, and hand off to the shared `issue-priming-workflow` skill. This entrypoint owns the GitHub-specific fetch, worktree setup, and issue-body persistence; everything after handoff lives in the shared workflow.

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

> Issue 153: refactor(kiki-dcs): replace DcsError::Io #[from] io::Error (tech-debt)

If the issue cannot be fetched (`gh` not authenticated, issue not found), stop and report the error.

### Derive branch and worktree names

- **Branch name:** `<type>/<N>-<title-slug>` (e.g. `refactor/149-patcher-operation-error`). `<type>` is the conventional-commit type that best matches the issue (`feat`, `fix`, `refactor`, `docs`, etc.).
- **Worktree leaf:** `<N>-<title-slug>` (e.g. `149-patcher-operation-error`).

Slug rules apply to the `<title-slug>` segment only: lowercase, kebab-case, alphanumeric-and-hyphen only, max ~40 chars.

### Provision the worktree and persist the issue body

Invoke the `issue-worktree-setup` helper immediately after deriving the
branch/worktree names so the fetched issue body is written inside the
correct checkout before handoff.

```bash
ISSUE_WORKTREE_SETUP_DIR="<issue-worktree-setup-skill-dir>"
HELPER_SCRIPT="$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.sh"

WORKTREE_SETUP_OUTPUT=$(
  BRANCH_NAME="<branch-name>" \
  WORKTREE_LEAF="<worktree-leaf>" \
  bash "$HELPER_SCRIPT"
)
```

Parse `WORKTREE_SETUP_OUTPUT` exactly per the helper skill's output
contract.

- If `MODE=stop`, surface `MESSAGE` and stop before any `.ephemeral/`
  write.
- If `MODE=reuse` or `MODE=new`, continue from `WORKTREE_PATH`.

Compute the issue-body artifact path inside `WORKTREE_PATH`:
`.ephemeral/<YYYY-MM-DD>-<id>-issue-body.md` (today's date; GitHub issue
number without `#`).

Validate the repo-relative path before writing:

```bash
case "$ISSUE_BODY_PATH" in
  .ephemeral/*-issue-body.md) ;;
  *) echo "issue body path validation failed: $ISSUE_BODY_PATH" >&2; exit 1 ;;
esac
[ "${ISSUE_BODY_PATH#*..}" = "$ISSUE_BODY_PATH" ] || { echo "path traversal: $ISSUE_BODY_PATH" >&2; exit 1; }
```

Apply the symlink guard before the write:

```bash
[ -L "$WORKTREE_PATH/.ephemeral" ] && rm "$WORKTREE_PATH/.ephemeral"
mkdir -p "$WORKTREE_PATH/.ephemeral"
[ -L "$WORKTREE_PATH/$ISSUE_BODY_PATH" ] && rm "$WORKTREE_PATH/$ISSUE_BODY_PATH"
```

Write the fetched `gh issue view` `.body` text verbatim to
`$WORKTREE_PATH/$ISSUE_BODY_PATH`.

## Hand off to `issue-priming-workflow`

Invoke the `issue-priming-workflow` skill with the following normalized issue payload:

```
## Issue Payload

- **source**: github
- **identifier**: #<N>
- **title**: <verbatim issue title, single line>
- **issue-body-path**: .ephemeral/<YYYY-MM-DD>-<id>-issue-body.md
- **worktree-path**: <absolute path returned by issue-worktree-setup>
- **mode**: <interactive | auto>
- **research**: <gated | forced>
```

The `mode` field is `auto` when `--auto` was passed and `interactive` otherwise. The `research` field is `forced` when `--research` was passed and `gated` otherwise.

The workflow handles every subsequent phase (gate, research,
brainstorming, planning, implementation, branch review, PR creation). Do
not duplicate workflow logic here.

## Error Handling

| Scenario               | Action                            |
| ---------------------- | --------------------------------- |
| `gh` not authenticated | Stop, suggest `! gh auth login`   |
| Issue not found        | Stop, verify number/URL           |
| Issue already closed   | Warn user, ask whether to proceed |

(Workflow-level errors — gate agent failures, research timeouts, missing `docs/adr/` — are handled inside `issue-priming-workflow`. See its Error Handling section.)
