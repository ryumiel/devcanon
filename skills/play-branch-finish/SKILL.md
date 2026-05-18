---
name: play-branch-finish
description: Guides closing out a development branch via squash merge, push and PR, or discard cleanup. Use when implementation is complete, tests pass, and the branch is ready to integrate.
---

# Finishing a Development Branch

## Overview

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Verify tests → Present options → Execute choice → Clean up.

**Announce at start:** "I'm using the play-branch-finish skill to complete this work."

## The Process

### Step 1: Verify Tests

**Before presenting options, verify tests pass:**

```bash
# Run project's test suite
npm test / cargo test / pytest / go test ./...
```

**If tests fail:**

```
Tests failing (<N> failures). Must fix before completing:

[Show failures]

Cannot proceed with merge/PR until tests pass.
```

Stop. Don't proceed to Step 2.

**If tests pass:** Continue to Step 2.

### Step 2: Determine Base Branch

```bash
# Resolve the default branch from the remote, falling back to main then master
# if origin/HEAD is unset (legacy clones).
if symbolic_ref=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null); then
  DEFAULT_BRANCH="${symbolic_ref#origin/}"
elif git show-ref --verify --quiet refs/remotes/origin/main; then
  DEFAULT_BRANCH=main
elif git show-ref --verify --quiet refs/remotes/origin/master; then
  DEFAULT_BRANCH=master
else
  DEFAULT_BRANCH=main
fi
git merge-base HEAD "$DEFAULT_BRANCH"
```

Or ask the user, substituting the resolved value of `$DEFAULT_BRANCH`: "This branch split from `<default-branch>` - is that correct?"

### Step 3: Present Options

Present exactly these 4 options:

```
Implementation complete. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work

Which option?
```

**Don't add explanation** - keep options concise.

### Step 4: Execute Choice

#### Option 1: Merge Locally

Tests must pass on the merged commit before deleting the feature branch or
continuing to cleanup.

```bash
# Switch to base branch
git checkout <base-branch>

# Pull latest
git pull

# Merge feature branch
git merge <feature-branch>

# Verify tests on merged result
WORKTREE_PATH=$(git rev-parse --show-toplevel)
<test command> || {
  echo "Tests failing on merged result. Halting before cleanup." >&2
  echo "Worktree preserved at '$WORKTREE_PATH'. Feature branch preserved at <feature-branch>." >&2
  echo "Base branch remains checked out at the failed merged result. Recover it manually before retrying." >&2
  exit 1
}

# Only reached when tests pass on the merged commit
git branch -d <feature-branch>
```

Then: Cleanup worktree (Step 5) on the green path only.

#### Option 2: Push and Create PR

**Optional input — review nits.** Callers (e.g., `issue-priming-workflow` Phase 8, invoked via `github-issue-priming` or `linear-issue-priming`) may pass a `nits_file` argument: a repo-relative path to a file containing a `play-review/findings/v1` envelope (schema and side-channel transport: `skills/play-review/SKILL.md` § Output). When `nits_file` is set, this skill reads the envelope, iterates `findings[]`, partitions anchorable from unanchorable, and posts them as PR review comments after `gh pr create` succeeds — they MUST NOT be embedded in the PR description body.

The file is a `play-review/findings/v1` envelope. This skill iterates every entry of `findings[]` and posts them — anchorable items (path + line inside the PR diff's HEAD-side ranges) as inline review comments and the rest as a top-level review comment — applying the `"side": "RIGHT"` default and dropping `start_line: null` along the way. The partition / `jq` / API logic is unchanged from earlier versions of this skill; only the input form (a file path vs. an inline JSON array) is new. The fields this skill ignores but tolerates (`severity`, `category`, `critic`, `anchor`, `why`, `recommendation`) are harmless to leave in the file. **No filtering inside this skill** — callers that want to post only a subset write a derived envelope with that subset to a file of their choosing (e.g., `issue-priming-workflow` Phase 7 writes `.ephemeral/<branch_slug>-<head_sha>-nits-pending.json` containing only judgment-required nits) and pass that path. (Note: `schema` is the top-level envelope field, not per-finding; consumers iterating `findings[]` will not see it.)

**Optional input — auto-mode assumptions.** Callers may pass an `assumptions_comment_file` argument: a repo-relative `.ephemeral/*-assumptions-comment.md` Markdown file that is a direct child of `.ephemeral/`. When set, this skill posts that file as a regular top-level PR comment after `gh pr create` succeeds. It MUST NOT be embedded in the PR description body, and it is independent of `nits_file`.

```bash
# Push branch
git push -u origin <feature-branch>
```

**Before composing the PR title and description**, glob for project PR guidelines (`**/pr-guideline*.md`) and read them. Follow the project's title format and description template exactly. If no guideline is found, use Conventional Commits for the title and this default structure:

```bash
# Create PR (default format — only if no PR guideline found)
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-3 bullets of what changed>

## Test Plan
- [ ] <verification steps>
EOF
)"
```

**After `gh pr create` succeeds, post caller-supplied assumptions as a top-level PR comment.** Skip this step entirely if the `assumptions_comment_file` input was unset. An `assumptions_comment_file` that is set but missing or unreadable is a contract failure — surface the path and stop.

1. Resolve the new PR number if needed:

   ```bash
   PR_NUMBER=$(gh pr view --json number --jq .number)
   ```

2. Set `$ASSUMPTIONS_COMMENT_FILE` to the caller-supplied `assumptions_comment_file` path, then validate it:

   ```bash
   case "$ASSUMPTIONS_COMMENT_FILE" in
     .ephemeral/*/*) echo "assumptions_comment_file must be a direct child of .ephemeral: $ASSUMPTIONS_COMMENT_FILE" >&2; exit 1 ;;
     .ephemeral/*-assumptions-comment.md) ;;
     *) echo "assumptions_comment_file path validation failed: $ASSUMPTIONS_COMMENT_FILE" >&2; exit 1 ;;
   esac
   [ "${ASSUMPTIONS_COMMENT_FILE#*..}" = "$ASSUMPTIONS_COMMENT_FILE" ] || { echo "path traversal: $ASSUMPTIONS_COMMENT_FILE" >&2; exit 1; }
   [ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
   [ -L "$ASSUMPTIONS_COMMENT_FILE" ] && { echo "assumptions_comment_file must not be a symlink: $ASSUMPTIONS_COMMENT_FILE" >&2; exit 1; }
   [ -r "$ASSUMPTIONS_COMMENT_FILE" ] || { echo "assumptions_comment_file missing or unreadable: $ASSUMPTIONS_COMMENT_FILE" >&2; exit 1; }
   ```

3. Post the comment:

   ```bash
   gh pr comment "$PR_NUMBER" --body-file "$ASSUMPTIONS_COMMENT_FILE"
   ```

4. If `gh pr comment` fails after `gh pr create` succeeded, surface the error and the unposted assumptions to the user, and stop before Step 5 cleanup. Do **not** delete or edit the PR — the PR is authoritative; missing comments are recoverable by re-running posting or pasting the assumptions manually.

**After `gh pr create` succeeds, route caller-supplied nits to PR review comments.** Skip this step entirely if the `nits_file` input was unset. A `nits_file` that is set but missing or unreadable is a contract failure (not a "no nits" signal) — surface the path and stop. If `nits_file` is set, points at a readable file, and the file's `findings[]` array is empty, also skip — posting an empty review is noise.

1. Resolve the new PR number. The most robust form works regardless of whether `gh pr create`'s stdout was captured:

   ```bash
   PR_NUMBER=$(gh pr view --json number --jq .number)
   ```

2. Validate `$NITS_FILE` and read the envelope. With `$NITS_FILE` set to the caller-supplied `nits_file` path, run the canonical `play-review` helper command `validate-nits-file` before partitioning. The helper enforces that the path MUST be a direct child of `.ephemeral/`, MUST NOT contain `..`, MUST end in `-findings.json` or `-nits-pending.json`, MUST NOT be a symlink, MUST be a readable regular file, and MUST carry schema `play-review/findings/v1`. Treat any nonzero exit as a contract failure and stop before posting:

   ```bash
   NITS_FILE="$NITS_FILE" \
     bash "skills/play-review/scripts/review-artifacts.sh" validate-nits-file
   ```

   Then extract `findings[]` (e.g., `jq -c '.findings' "$NITS_FILE"`) and partition the entries against the PR diff's HEAD-side line ranges (derivable from `gh pr diff "$PR_NUMBER"`). "Anchorable" here means `path` + `line` falls inside the PR diff — re-derived now against the current diff, not taken from the schema's `anchor` field, which was determined at review time and may be stale. Hold the anchorable subset as a JSON array in `$ANCHORABLE_NITS` and the unanchorable subset as a JSON array in `$UNANCHORABLE_NITS` (step 4 streams `$UNANCHORABLE_NITS` directly to `gh pr review --body-file -`). The agent running this skill implements the partition; the prose does not prescribe one mechanism because `gh pr diff` parsing varies by environment (awk, python, jq, gh built-ins). Before serialization, validate the anchorable entries expose only the field types needed by GitHub review comments, then build each API comment from an allowlist (`path`, `line`, optional `start_line`, `body`) and force `"side": "RIGHT"`; never pass through unexpected envelope fields such as `side`, `start_side`, or GitHub API keys. Drop any `start_line` key whose value is `null` (the GitHub Reviews API rejects `start_line: null`; the schema permits the field to be `null` for shape uniformity, but consumers MUST omit the key entirely when there is no range). Serialize into `$ANCHORABLE_NITS_JSON`:

   ```bash
   jq -e 'all(.[]; (.path | type == "string") and (.body | type == "string") and (.line | type == "number") and ((has("start_line") | not) or .start_line == null or (.start_line | type == "number")))' <<<"$ANCHORABLE_NITS" >/dev/null || { echo "invalid nits payload fields" >&2; exit 1; }
   ANCHORABLE_NITS_JSON=$(jq -c 'map({path, line, start_line, body, side: "RIGHT"} | if .start_line == null then del(.start_line) else . end)' <<<"$ANCHORABLE_NITS")
   ```

3. Post anchorable nits as a single review with `event: "COMMENT"`. Skip this step entirely if `$ANCHORABLE_NITS_JSON` is empty or `[]` — posting an empty review is noise.

   For the `gh api` flag conventions used here, see [docs/guidelines/gh-api-hygiene.md](../../docs/guidelines/gh-api-hygiene.md).

   `gh api` reads the request body from `--input`; sibling `-f` flags become URL query parameters in that mode, not body fields. Build the entire review payload inside `jq` so `commit_id`, `event`, `body`, and `comments` all land in the JSON body:

   ```bash
   gh api repos/{owner}/{repo}/pulls/"$PR_NUMBER"/reviews \
     --method POST \
     --silent \
     --input <(jq -n \
       --arg commit_id "$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)" \
       --argjson comments "$ANCHORABLE_NITS_JSON" \
       '{commit_id: $commit_id, event: "COMMENT", body: "branch-review nits — see inline comments", comments: $comments}')
   ```

   Each comment object: `{ "path": "<file>", "line": <int>, "side": "RIGHT", "body": "<text>" }`. Add `start_line` for ranges. This pattern matches the review-posting flow in `pr-review/SKILL.md` Phase 6: Post.

4. Post unanchorable nits (file outside the diff or line outside the changed range) as a single top-level review comment so the description body stays clean. A top-level review comment is chosen over `gh pr comment` so all branch-review feedback lives in the Reviews tab.

   Render `$UNANCHORABLE_NITS` directly into a single review-comment body and pipe it to `gh pr review --body-file -`. Each entry produces a `- path:line` header followed by its rendered `body` field, separated by blank lines. The schema's `body` field is multi-line markdown (`**<severity> | <category>** — <why>\n\n**Recommendation:** <recommendation>`), so going through a bash array would split each entry across multiple elements at the embedded `\n\n`; piping `jq -r` directly to `gh` keeps the bytes intact:

   ```bash
   jq -r '.[] | "- \(.path):\(.line)\n\n\(.body)\n"' <<<"$UNANCHORABLE_NITS" \
     | gh pr review "$PR_NUMBER" --comment --body-file -
   ```

   Nit bodies may contain backticks, `$`, embedded newlines, and `"` — passing through `--body-file -` (rather than a `-b` argument) prevents the shell from expanding command substitutions or word-splitting before `gh` sees the bytes.

5. If `gh api` posting fails after `gh pr create` succeeded, surface the error and the unposted nits to the user, and stop before Step 5 cleanup. Do **not** delete or edit the PR — the PR is authoritative; missing comments are recoverable by re-running posting or pasting nits manually.

Then: Cleanup worktree (Step 5)

#### Option 3: Keep As-Is

Report: "Keeping branch <name>. Worktree preserved at <path>."

**Don't cleanup worktree.**

#### Option 4: Discard

**Confirm first:**

```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path>

Type 'discard' to confirm.
```

Wait for exact confirmation.

If confirmed:

```bash
git checkout <base-branch>
git branch -D <feature-branch>
```

Then: Cleanup worktree (Step 5)

### Step 5: Cleanup Worktree

**For Options 1, 2, 4 after their success-only cleanup points:**

- Option 1 reaches Step 5 only after the merged-result test command passes.
- Option 2 reaches Step 5 only after PR creation and any requested
  assumptions-comment or nit-posting steps complete without error.
- Option 4 reaches Step 5 only after discard is confirmed and branch deletion
  succeeds.

Use provenance-aware cleanup. [`skills/issue-worktree-setup/SKILL.md`](../issue-worktree-setup/SKILL.md)
defines repo-managed issue worktrees as `<MAIN_ROOT>/.worktrees/<leaf>`.
Only those worktrees are eligible for automatic removal here.

```bash
WORKTREE_PATH=$(git rev-parse --show-toplevel)
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)

case "$WORKTREE_PATH" in
  "$MAIN_ROOT"/.worktrees/*)
    cd "$MAIN_ROOT" || {
      echo "Failed to leave target worktree: $MAIN_ROOT"
      exit 1
    }
    git worktree remove "$WORKTREE_PATH"
    git worktree prune
    ;;
  *)
    echo "Worktree at $WORKTREE_PATH is harness-managed; leaving it in place."
    ;;
esac
```

**For Option 3:** Keep worktree.

## Quick Reference

| Option           | Merge | Push | Keep Worktree | Cleanup Branch |
| ---------------- | ----- | ---- | ------------- | -------------- |
| 1. Merge locally | ✓     | -    | -             | ✓              |
| 2. Create PR     | -     | ✓    | conditional   | -              |
| 3. Keep as-is    | -     | -    | ✓             | -              |
| 4. Discard       | -     | -    | -             | ✓ (force)      |

Option 2 removes repo-managed `.worktrees/*` checkouts and preserves
harness-managed worktrees in place.

## Common Mistakes

See [`references/common-mistakes.md`](references/common-mistakes.md) for failure modes (skipping test verification, open-ended questions, automatic worktree cleanup, no discard confirmation, ignoring PR guideline, putting nits in description body).

## Red Flags

See [`references/red-flags.md`](references/red-flags.md) for the "Never" and "Always" lists.

## Integration

**Called by:**

- **play-subagent-execution** - After all tasks complete

**Pairs with:**

- **pr-merge** - For CI-gated merge after PR creation (Option 2)
