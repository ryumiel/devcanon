---
name: pr-review
description: Multi-agent code review of a GitHub pull request, with critic-verified findings and user-gated posting. Use when asked to review a GitHub PR, re-review after author pushes fixes, or check a pull request for issues. Triggers on PR numbers, PR URLs, or phrases like "review PR", "check this PR", "follow-up review".
codex_sidecar:
  interface:
    display_name: PR Review
    short_description: Run a multi-agent review of a GitHub pull request
    brand_color: "#0969da"
---

# PR Review

Multi-agent PR review with critic verification and user-gated posting.

**Nothing touches GitHub without explicit user approval.** No posting reviews, no resolving threads, no approving — until the user says go.

## Workflow

```dot
digraph pr_review {
  rankdir=TB;
  gather [label="1. Gather\nPR metadata + comments + diff"];
  discover [label="2. Discover\nGlob for review guidelines"];
  review [label="3. Review\nSpawn agents in worktree"];
  verify [label="4. Verify\nCritic checks blocking findings"];
  present [label="5. Present\n(USER GATE)", shape=doublecircle];
  post [label="6. Post\nAfter user approval only"];

  gather -> discover -> review -> verify -> present;
  present -> post [label="user approves"];
  present -> present [label="user edits"];
}
```

### Phase 1: Gather

Run in parallel:

- `gh pr view <N> --json title,body,baseRefName,headRefName,commits,files,reviews,comments,url`
- `gh api repos/{owner}/{repo}/pulls/<N>/comments` — inline review threads
- `gh api repos/{owner}/{repo}/pulls/<N>/reviews` — review states

Detect mode:

- **Initial:** No prior review from current user on this PR.
- **Follow-up:** Prior review exists. Find last reviewed commit from review's `commit_id`.

### Phase 2: Discover

Search the repository for review guidelines — read them, don't just list paths:

- `**/code-review*.md`, `**/review-*.md` — review checklists
- `**/error-handling*.md` — error discipline
- `AGENTS.md`, `CONTRIBUTING.md` — project conventions

No guidelines found? Proceed with agents' built-in knowledge, note it in the report.

### Phase 3: Review

**Worktree — always detached HEAD, from repo root:**

```sh
git fetch origin <head-ref>
git worktree add .worktrees/pr-<N>-review origin/<head-ref>
```

If the PR is from a fork and `origin/<head-ref>` doesn't exist, use `gh pr checkout <N> --detach` in a worktree instead, or add the fork remote first.

Use the repo root as the base for `.worktrees/` to avoid cwd issues across bash calls.

**Core agents (always spawned):**

| Agent       | Focus                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Correctness | Logic bugs, panic discipline, error propagation, API contracts                                          |
| Data-safety | Secrets/credentials, injection (path traversal, SQL, XSS, command), PII in logs/errors, untrusted input |

**Dynamic agents (by file types in diff):**

| Trigger                | Agent                                           |
| ---------------------- | ----------------------------------------------- |
| `*.rs`                 | Rust — clippy, unsafe, ECS, serde, WASM         |
| `*.ts` / `*.tsx`       | TypeScript — types, React patterns, bridge sync |
| `tests/` or `*_test.*` | Test — coverage, correctness, fixtures          |
| `docs/` or `*.md`      | Docs — accuracy, staleness, contract alignment  |

**Agent briefing — each prompt MUST include:**

1. Role — one sentence
2. PR context — title, summary, changed files with +/- counts
3. Diff — full or incremental (see follow-up rules)
4. Discovered guidelines — actual content, not file paths
5. Prior review context (follow-up only) — threads, author replies
6. Output format — file path (repo-relative), line number (in HEAD), priority P0-P3, blocking/nit, code reference, recommendation

Compose PR-specific prompts referencing actual files and line counts. Generic prompts like "review this PR" are prohibited.

Run all agents in parallel.

**Model selection:** Use `{{model:deep}}` for all review agents and the critic. PR review is the final quality gate — the cost of missing a real bug far outweighs the cost of a more capable model.

**Follow-up review scoping:**

- **Narrow changes:** Incremental diff (`last_reviewed..HEAD`) + prior thread verification.
- **Broad changes — escalate to full `base...HEAD` diff when ANY of:** >5 files changed since last review, new public API functions/types introduced, or logic restructured beyond flagged lines. When in doubt, prefer full diff. Even on full diff, still verify prior comment threads.
- **Unaddressed prior findings:** If a prior blocking finding was NOT addressed by the new commits (the flagged code is unchanged), carry it forward into the new report as "still open" rather than silently dropping it.

### Phase 4: Verify

Spawn critic agent with all findings merged. The critic reads actual code in the worktree and tags each **blocking** finding:

- **VALID** — holds up
- **INVALID** — code doesn't match the claim
- **DOWNGRADE** — valid but not blocking

Nits skip critic verification.

### Phase 5: Present (USER GATE)

**STOP HERE. Present the report. Wait for user response.**

Format each finding with evidence code:

```
#### 1. <title>
**<file>:<line> | P0 | Blocking | Critic: VALID**

` ` `<lang>
// <file>:<start>-<end>
<3-7 lines of actual code>
` ` `

<Why this is a problem>

**Recommendation:** <concrete suggestion>
```

For follow-up reviews, include thread resolution list:

```
### Previous Threads

| # | File:Line | Author | Action | Evidence |
|---|-----------|--------|--------|----------|
| 1 | entity.rs:153 | user | Resolve | Gate added at L439 |
```

Include draft review body preview.

**User actions:**

| Action                      | Effect                                 |
| --------------------------- | -------------------------------------- |
| `post`                      | Post review + resolve approved threads |
| `post as comment`           | Comment only, no verdict               |
| `drop #N`                   | Remove finding                         |
| `change #N to blocking/nit` | Reclassify                             |
| `edit`                      | Revise draft text                      |
| `skip threads`              | Post but don't resolve                 |
| `abort`                     | Discard all, clean up                  |

### Phase 6: Post

Only after user approval:

1. **Post review with inline comments** via the REST API. Each finding becomes a line-level comment on the diff:

   ```sh
   gh api repos/{owner}/{repo}/pulls/<N>/reviews \
     --method POST \
     -f commit_id="<HEAD SHA>" \
     -f body="<overall summary>" \
     -f event="<APPROVE|REQUEST_CHANGES|COMMENT>" \
     --input <(jq -n '{comments: $comments}' --argjson comments '<JSON array>')
   ```

   Each comment object in the array:

   ```json
   {
     "path": "relative/file.ts",
     "line": 42,
     "side": "RIGHT",
     "body": "**P0 Blocking** ..."
   }
   ```

   - `path`: file path relative to repo root (from the diff)
   - `line`: the absolute line number in the HEAD version of the file
   - `side`: `"RIGHT"` for lines in the PR head (almost always what you want)
   - `body`: finding text — include priority, blocking/nit tag, and recommendation

   For multi-line comments spanning a range, add `start_line`:

   ```json
   {
     "path": "src/auth.rs",
     "start_line": 10,
     "line": 15,
     "side": "RIGHT",
     "body": "..."
   }
   ```

   **Nits and blocking findings alike become inline comments.** The overall review `body` should contain only a brief summary (1-3 sentences) and the verdict rationale — not duplicate findings.

2. Resolve threads via GraphQL:
   ```sh
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<id>"}) { thread { isResolved } } }'
   ```
3. Verify each API response succeeded. Report failures, stop on error.

**Always clean up:** `git worktree remove .worktrees/pr-<N>-review`

## GitHub API Reference

**Create review with inline comments** (primary posting method):

```sh
gh api repos/{owner}/{repo}/pulls/<N>/reviews \
  --method POST \
  -f commit_id="$(gh pr view <N> --json headRefOid -q .headRefOid)" \
  -f body="Summary" \
  -f event="REQUEST_CHANGES" \
  --input <(cat <<'EOF'
{"comments":[
  {"path":"src/handler.rs","line":42,"side":"RIGHT","body":"**P0 Blocking** — unchecked error\n\n**Recommendation:** propagate with `?`"},
  {"path":"src/handler.rs","start_line":50,"line":55,"side":"RIGHT","body":"**P2 Nit** — consider extracting helper"}
]}
EOF
)
```

Use `line` (absolute file line in HEAD), not `position` (diff offset). `side` is `"RIGHT"` for PR head lines.

**Reply to inline comment** (use correct endpoint):

```sh
gh api repos/{owner}/{repo}/pulls/<N>/comments/<comment-id>/replies -f body="<text>"
```

Verify the response includes the new comment ID. Do not assume success.

**Fetch thread IDs for resolution:**

```sh
gh api graphql -f query='{ repository(owner: "O", name: "R") {
  pullRequest(number: N) { reviewThreads(first: 50) { nodes {
    id isResolved comments(first: 5) { nodes { body author { login } path originalLine } }
} } } } }'
```

## Hard Rules

1. **NEVER post, approve, or resolve without user approval at the Phase 5 gate.**
2. **NEVER auto-approve.** Present verdict recommendation; user decides.
3. **Always spawn data-safety agent** regardless of file types.
4. **Always include evidence code** (3-7 lines) in findings.
5. **Always clean up worktree** after post or abort.
6. **Verify every GitHub API response.** Report non-2xx failures.
7. **Cite specific lines.** No generic warnings without code references.
8. **Never approve your own code.** If PR author = git user, warn and refuse approval.

## Red Flags — You Are Violating This Skill

- You called `gh pr review` or `resolveReviewThread` before presenting findings to the user
- You posted a review "since it looked clean" without the gate
- You skipped the data-safety agent because "there's no security-relevant code"
- You showed findings as a table with file:line but no code snippets
- You resolved threads "since they were obviously addressed"
- You used a generic agent prompt without PR-specific file references
- You skipped the critic pass because "findings were straightforward"
- You posted all findings in the review body instead of as inline comments on specific lines
- You used `gh pr review --body` with findings instead of the reviews API with `comments` array

**All of these mean: STOP. You skipped the user gate or a required step. Go back.**

## Error Handling

| Scenario                         | Action                                               |
| -------------------------------- | ---------------------------------------------------- |
| `gh` not authenticated           | Fail, suggest `gh auth login`                        |
| PR not found                     | Fail, verify number/URL                              |
| PR already merged/closed         | Warn user of state, ask whether to proceed           |
| Fork PR (head ref not on origin) | Use `gh pr checkout <N> --detach` or add fork remote |
| Worktree exists                  | Remove stale, recreate                               |
| Agent fails/times out            | Report partial results                               |
| API returns non-2xx              | Report failure, stop                                 |
| No guidelines found              | Note in report, proceed                              |
| Worktree cleanup fails           | Warn user, suggest manual `git worktree remove`      |
