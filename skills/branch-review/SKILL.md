---
name: branch-review
description: Multi-agent code review of a local branch's commits against a base ref. Use when reviewing a branch before creating a PR or when the user asks to review changes without a GitHub PR.
---

# Branch Review

Multi-agent code review on a local branch. Same review quality as `pr-review` but works on `git diff` — no GitHub PR required.

## Workflow

```dot
digraph branch_review {
  rankdir=TB;
  gather [label="1. Gather\ngit diff + log"];
  discover [label="2. Discover\nGlob for review guidelines"];
  review [label="3. Review\nSpawn agents"];
  verify [label="4. Verify\nCritic checks blocking findings"];
  present [label="5. Present\nFindings to user or caller"];

  gather -> discover -> review -> verify -> present;
}
```

## Arguments

| Arg      | Effect                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `<base>` | Base branch to diff against (default: the repository's default branch, resolved via `origin/HEAD`, falling back to `main` then `master`) |
| `--fix`  | Auto-fix blocking findings instead of presenting them. Used by `github-issue-priming --auto`.                                            |

## Phase 1: Gather

Detect the base branch and collect the diff:

```bash
# Determine base: explicit argument wins; otherwise resolve from origin/HEAD,
# falling back to main then master if origin/HEAD is unset.
if [[ -n "${1:-}" ]]; then
  BASE="$1"
elif symbolic_ref=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null); then
  BASE="${symbolic_ref#origin/}"
elif git show-ref --verify --quiet refs/remotes/origin/main; then
  BASE=main
elif git show-ref --verify --quiet refs/remotes/origin/master; then
  BASE=master
else
  BASE=main
fi

# Get the diff and commit log
git diff "$BASE"...HEAD
git log "$BASE"...HEAD --oneline
git diff "$BASE"...HEAD --stat
```

If the diff is empty, report "no changes to review" and stop.

Extract from the diff:

- Changed files with +/- line counts
- Total scope (files changed, insertions, deletions)

## Phase 2: Discover Guidelines

Search the repository for review guidelines — read them, don't just list paths:

- `**/code-review*.md`, `**/review-*.md` — review checklists
- `**/error-handling*.md` — error discipline
- `AGENTS.md`, `CONTRIBUTING.md` — project conventions

No guidelines found? Proceed with agents' built-in knowledge, note it in the report.

## Phase 3: Review

**Core agents (always spawned):**

| Agent       | Focus                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Correctness | Logic bugs, panic discipline, error propagation, API contracts                                          |
| Data-safety | Secrets/credentials, injection (path traversal, SQL, XSS, command), PII in logs/errors, untrusted input |

**Dynamic agents (by file types in diff):**

| Trigger                                                                                                     | Agent                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `*.rs`                                                                                                      | Rust — clippy, unsafe, ECS, serde, WASM                                                               |
| `*.ts` / `*.tsx`                                                                                            | TypeScript — types, React patterns, bridge sync                                                       |
| `tests/` or `*_test.*`                                                                                      | Test — coverage, correctness, fixtures                                                                |
| `docs/` or `*.md`                                                                                           | Docs — accuracy, staleness, contract alignment, identifier drift (within-document and cross-document) |
| `Cargo.toml`, `package.json`, `tsconfig.json`, `*.config.*`, `mod.rs`, `index.ts`, or 3+ modules            | Architecture — boundary violations, dependency justification, responsibility drift, contract changes  |
| CLI command handlers, public API surfaces, user-facing config schemas, or files referenced by existing docs | Documentation — missing/stale docs for changed behavior, contract alignment, operator guidance gaps   |

**Agent briefing — each prompt MUST include:**

1. Role — one sentence
2. Context — branch name, base branch, changed files with +/- counts
3. Diff — full `git diff` output
4. Discovered guidelines — actual content, not file paths
5. Output format — file, line, priority P0-P3, blocking/nit, code reference, recommendation

Run all agents in parallel.

**Model selection:** Use `{{model:deep}}` for all review agents and the critic — same rationale as `pr-review`.

**Docs agent identifier-drift checks:**

The Docs agent must perform two consistency checks in addition to its existing accuracy / staleness / contract-alignment review:

**Sub-check A — within-document drift.** For each changed `*.md` file:

- Compare backticked identifiers in prose against identifiers used in adjacent fenced code blocks within the same file.
- Flag any prose identifier whose code-block counterpart uses a different name, or any code-block identifier whose surrounding prose names something else.
- Report as P1, blocking. Auto-fixable via `--fix`.

Example finding (Sub-check A):

> `skills/play-branch-finish/SKILL.md:142` — prose says "the procedure runs `git worktree prune`" but the adjacent code block at line 145 invokes `git worktree remove`. P1, blocking.

**Sub-check B — cross-document pattern drift.** When the diff changes the documented direction of a pattern (e.g., adds prose saying "X is broken / use Y instead", or replaces an example of X with Y while declaring X non-canonical):

- Grep the repository for unchanged occurrences of pattern X.
- Flag any occurrence as P1: "unchanged file still demonstrates pattern X which this diff documents as broken / superseded".
- **Bounding rule:** only grep for patterns the diff explicitly changes the direction of. Do not grep for every backticked identifier in the diff.
- **`--fix` behavior:** report-only. Do not auto-fix files outside the diff. These findings require user judgment about whether the new direction is canonical or whether the unchanged file represents intentional asymmetry.

Example finding (Sub-check B):

> `skills/pr-review/SKILL.md:88, :104` — these examples invoke `gh api` with both `-f` flags and `--input`, the broken pattern that this diff (`skills/play-branch-finish/SKILL.md:202`) now documents as broken because `-f` becomes a URL query parameter when `--input` is supplied. Two unchanged occurrences contradict the new direction. P1, report-only — fix requires user judgment about which direction is canonical.

## Phase 4: Verify

Spawn critic agent with all findings merged. The critic reads actual code in the working directory and tags each **blocking** finding:

- **VALID** — holds up
- **INVALID** — code doesn't match the claim
- **DOWNGRADE** — valid but not blocking

Nits skip critic verification.

## Phase 5: Present

**Without `--fix` (interactive mode):**

Present findings with evidence code, same format as `pr-review`:

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

**With `--fix` (autonomous mode, used by `github-issue-priming --auto`):**

For each blocking finding verified by the critic:

1. Fix the issue
2. Run local CI checks to verify the fix doesn't break anything
3. Commit the fix

**Commit message format:** Before composing fix commit messages, glob for `**/commit-guideline*.md` and follow its format. If no guideline is found, use Conventional Commits: `fix(<scope>): <what was fixed>`. The scope should match the file/module being fixed.

After all blocking findings are fixed, report:

- Number of blocking findings fixed
- Remaining nits (left for user)
- Any blocking findings that couldn't be fixed (requires design changes)

If a blocking finding requires design changes **or requires editing files outside the diff (e.g., Sub-check B cross-document drift)**, **stop and report** — don't attempt architectural fixes or corpus-wide edits. A fix triggers this stop rule if it changes a function's signature, alters control flow structure, touches more than one module, needs context beyond the flagged lines to determine correctness, or requires editing unchanged files.

## Quick Reference

| Situation                                                          | Action                                 |
| ------------------------------------------------------------------ | -------------------------------------- |
| Empty diff                                                         | Report "no changes", stop              |
| No guidelines found                                                | Note in report, proceed                |
| All clean                                                          | Report "no issues found"               |
| Blocking findings + `--fix`                                        | Auto-fix, commit, report               |
| Blocking finding needs design change                               | Stop, report to caller                 |
| Nits + `--fix`                                                     | Leave for user, list in report         |
| Cross-document drift (unchanged files contradict diff's direction) | Report as P1 blocking, do not auto-fix |

## Common Mistakes

### Using `gh pr diff` instead of `git diff`

- **Problem:** No PR exists yet — `gh` commands will fail
- **Fix:** Always use `git diff <base>...HEAD`

### Posting findings to GitHub

- **Problem:** No PR to post to; this is a local review
- **Fix:** Present findings in the conversation or auto-fix with `--fix`

### Skipping the critic

- **Problem:** Review agents sometimes flag code that doesn't match their claim
- **Fix:** Always run critic verification on blocking findings

## Red Flags — You Are Violating This Skill

- You called any `gh` command (`gh pr view`, `gh pr diff`, `gh api`, `gh pr review`) — no PR exists
- You posted a review to GitHub
- You skipped the data-safety agent
- You showed findings without evidence code (3-7 lines)
- You skipped the critic pass
- You used a generic agent prompt without file references and line counts from the diff

**All of these mean: STOP. Go back to the workflow.**

## Integration

**Called by:**

- `github-issue-priming --auto` (Phase 8, with `--fix`)
- Any workflow needing pre-PR review

**Complements:**

- `pr-review` — for reviewing existing GitHub PRs
- `play-review-response` — guidance for responding to review feedback with technical rigor
