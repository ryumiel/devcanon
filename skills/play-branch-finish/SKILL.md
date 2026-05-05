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

```bash
# Switch to base branch
git checkout <base-branch>

# Pull latest
git pull

# Merge feature branch
git merge <feature-branch>

# Verify tests on merged result
<test command>

# If tests pass
git branch -d <feature-branch>
```

Then: Cleanup worktree (Step 5)

#### Option 2: Push and Create PR

**Optional input — review nits.** Callers (e.g., `issue-priming-workflow` Phase 8, invoked via `github-issue-priming` or `linear-issue-priming`) may pass a `nits` block in the invocation args. Format: a JSON array where each item has `path` (string, repo-relative), `line` (integer, line in the HEAD version), and `body` (string). Optional fields: `side` (default `"RIGHT"`), `start_line` (for multi-line ranges). When the caller omits `side`, this skill applies the `"RIGHT"` default automatically — callers do not need to supply it. When the caller passes nits, this skill posts them as PR review comments after `gh pr create` succeeds — they MUST NOT be embedded in the PR description body.

The `nits` shape is a strict subset of the `play-review/findings/v1` JSON block (see `skills/play-review/SKILL.md` § Output): callers receive findings as that block's `findings[]` array — emitted as the last fenced `json` code block in `branch-review` and `pr-review` output — and pass the relevant subset directly, with no prose parsing required. The per-finding fields this skill ignores but tolerates (`severity`, `category`, `critic`, `anchor`, `why`, `recommendation`) are harmless to pass through. (Note: `schema` is the top-level envelope field, not per-finding; consumers iterating `findings[]` will not see it.)

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

**After `gh pr create` succeeds, route caller-supplied nits to PR review comments.** Skip this step entirely if the `nits` input was empty or omitted.

1. Resolve the new PR number. The most robust form works regardless of whether `gh pr create`'s stdout was captured:

   ```bash
   PR_NUMBER=$(gh pr view --json number --jq .number)
   ```

2. Partition the nits into anchorable (file/line falls inside the PR diff's HEAD-side line ranges, derivable from `gh pr diff "$PR_NUMBER"`) and unanchorable. Hold the anchorable subset as a JSON array in `$ANCHORABLE_NITS`. Then serialize that subset — applying the `"side": "RIGHT"` default and dropping any `start_line` key whose value is `null` (the GitHub Reviews API rejects `start_line: null`; the schema permits the field to be `null` for shape uniformity, but consumers MUST omit the key entirely when there is no range) — into `$ANCHORABLE_NITS_JSON`:

   ```bash
   ANCHORABLE_NITS_JSON=$(jq -c 'map(. + {side: (.side // "RIGHT")} | if .start_line == null then del(.start_line) else . end)' <<<"$ANCHORABLE_NITS")
   ```

3. Post anchorable nits as a single review with `event: "COMMENT"`. Skip this step entirely if `$ANCHORABLE_NITS_JSON` is empty or `[]` — posting an empty review is noise.

   `gh api` reads the request body from `--input`; sibling `-f` flags become URL query parameters in that mode, not body fields. Build the entire review payload inside `jq` so `commit_id`, `event`, `body`, and `comments` all land in the JSON body:

   ```bash
   gh api repos/{owner}/{repo}/pulls/"$PR_NUMBER"/reviews \
     --method POST \
     --input <(jq -n \
       --arg commit_id "$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)" \
       --argjson comments "$ANCHORABLE_NITS_JSON" \
       '{commit_id: $commit_id, event: "COMMENT", body: "branch-review nits — see inline comments", comments: $comments}')
   ```

   Each comment object: `{ "path": "<file>", "line": <int>, "side": "RIGHT", "body": "<text>" }`. Add `start_line` for ranges. This pattern matches the review-posting flow in `pr-review/SKILL.md` Phase 6: Post.

4. Post unanchorable nits (file outside the diff or line outside the changed range) as a single top-level review comment so the description body stays clean. A top-level review comment is chosen over `gh pr comment` so all branch-review feedback lives in the Reviews tab.

   Nit bodies may contain backticks, `$`, and `"` — never inline them into a double-quoted `-b` argument, since the shell will expand command substitutions and variables before `gh` sees the body. Use `--body-file` instead so the body bytes pass through as a single argument unmolested:

   ```bash
   printf '%s\n' "${UNANCHORABLE_LINES[@]}" | gh pr review "$PR_NUMBER" --comment --body-file -
   ```

   Each line in `UNANCHORABLE_LINES` should be formatted as `path:line — body`.

5. If `gh api` posting fails after `gh pr create` succeeded, surface the error and the unposted nits to the user. Do **not** delete or edit the PR — the PR is authoritative; missing comments are recoverable by re-running posting or pasting nits manually.

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

**For Options 1, 2, 4:**

Check if in worktree:

```bash
git worktree list | grep $(git branch --show-current)
```

If yes:

```bash
git worktree remove <worktree-path>
```

**For Option 3:** Keep worktree.

## Quick Reference

| Option           | Merge | Push | Keep Worktree | Cleanup Branch |
| ---------------- | ----- | ---- | ------------- | -------------- |
| 1. Merge locally | ✓     | -    | -             | ✓              |
| 2. Create PR     | -     | ✓    | ✓             | -              |
| 3. Keep as-is    | -     | -    | ✓             | -              |
| 4. Discard       | -     | -    | -             | ✓ (force)      |

## Common Mistakes

**Skipping test verification**

- **Problem:** Merge broken code, create failing PR
- **Fix:** Always verify tests before offering options

**Open-ended questions**

- **Problem:** "What should I do next?" → ambiguous
- **Fix:** Present exactly 4 structured options

**Automatic worktree cleanup**

- **Problem:** Remove worktree when might need it (Option 2, 3)
- **Fix:** Only cleanup for Options 1 and 4

**No confirmation for discard**

- **Problem:** Accidentally delete work
- **Fix:** Require typed "discard" confirmation

**Ignoring project PR guideline**

- **Problem:** PR uses generic format instead of project's required template
- **Fix:** Always glob for `**/pr-guideline*.md` before composing title/description

**Putting branch-review nits in the description body**

- **Problem:** Nits become locked into the durable description instead of being resolvable line-anchored review comments
- **Fix:** When a caller passes a `nits` block, post via `gh api repos/.../pulls/<N>/reviews` with `event: "COMMENT"`. The description body stays free of review chatter

## Red Flags

**Never:**

- Proceed with failing tests
- Merge without verifying tests on result
- Delete work without confirmation
- Force-push without explicit request
- Embed branch-review nits in the PR description body when the caller passed them as an input

**Always:**

- Verify tests before offering options
- Present exactly 4 options
- Get typed confirmation for Option 4
- Clean up worktree for Options 1 & 4 only

## Integration

**Called by:**

- **play-subagent-execution** - After all tasks complete

**Pairs with:**

- **pr-merge** - For CI-gated merge after PR creation (Option 2)
