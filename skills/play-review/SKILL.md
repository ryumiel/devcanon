---
name: play-review
description: Internal multi-agent review pipeline shared by `branch-review` and `pr-review`. Use when invoked by one of those wrappers. Do not use directly — call `branch-review` for local diffs or `pr-review` for GitHub PRs.
claude:
  model: "{{model:deep}}"
  user-invocable: false
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# play-review

Multi-agent code review pipeline. Internal — invoked by `branch-review`
(local diffs) or `pr-review` (GitHub PRs). The wrapper gathers inputs,
sets up the working directory, and disposes of findings; this skill runs
the review.

## Inputs

The wrapper composes these into the prose that hands off to this skill.
A missing required input means the wrapper has a bug — stop and report
rather than proceeding with defaults.

**Required:**

| Input                | Type                                       | Used by                                                   |
| -------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `working_directory`  | absolute path                              | Phase 1 guideline glob; Phase 3 agent dispatch            |
| `base_ref`           | string (e.g., `main`, `origin/main`)       | Doc-impact summary; agent briefings                       |
| `active_diff_range`  | git diff spec                              | Phase 3 agents review this                                |
| `full_pr_diff_range` | git diff spec (= `active` for branch case) | Doc-impact summary always uses this                       |
| `head_sha`           | string                                     | Briefings; reused by `pr-review` for `gh api` `commit_id` |
| `mode`               | `"present"` \| `"fix"` \| `"github-post"`  | Activates conditional sub-checks                          |
| `language_hints`     | derived file-extension set                 | Dynamic agent triggers                                    |

**Optional (follow-up / `pr-review` only):**

| Input                | Used by                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `prior_threads`      | array of `{file, line, body, author, status}` — critic carry-forward; "still open" detection |
| `last_reviewed_sha`  | string — incremental vs full-scope semantics                                                 |
| `is_followup_narrow` | bool — Architecture / Documentation agent override                                           |

## Output

A markdown document with two sections:

1. `## Findings` — one entry per finding, with stable headers:

   ````markdown
   ### Finding N

   - **Path:** <repo-relative file path>
   - **Line:** <integer or `start_line-line`>
   - **Severity:** Blocking | Nit
   - **Category:** Logic | Safety | Architecture | Tests | Maintainability | Documentation | Contracts
   - **Critic:** VALID | INVALID | DOWNGRADE | (skipped — nit)
   - **Anchor:** natural | missing-file | out-of-diff

   ```<lang>
   // <file>:<start>-<end>
   <evidence code, 3-7 lines>
   ```

   <Why this is a problem>

   **Recommendation:** <concrete suggestion>
   ````

2. `## Carry-forward` (follow-up only) — prior threads still open after re-verification, in the same shape.

The wrapper consumes this output and disposes per its surface (present
in conversation, auto-fix mechanical findings, post inline comments to
GitHub, etc.). This skill never touches GitHub, never auto-fixes, never
creates or removes worktrees.

## Phase 1: Discover Guidelines

Search the repository (under `working_directory`) for review guidelines —
read them, don't just list paths:

- `**/code-review*.md`, `**/review-*.md` — review checklists
- `**/error-handling*.md` — error discipline
- `**/documentation-standard*.md`, `**/documentation-checklists*.md` — documentation policy and ADR coverage rules
- `AGENTS.md`, `CONTRIBUTING.md` — project conventions

No guidelines found? Proceed with agents' built-in knowledge, note it in
the report.

## Phase 2: Doc-impact summary

Compute a structured summary that the Architecture agent's AFDS v2
ADR-coverage sub-check uses as anchor data. **Always run against
`full_pr_diff_range`** even when `active_diff_range` is narrower (e.g.,
follow-up narrow mode). Rationale: ADR coverage is a PR-scope governance
question, not a delta question.

```bash
cd "$WORKING_DIRECTORY"
# Architectural-knowledge files touched in the full PR
ARCH_FILES=$(git diff --name-only "$FULL_PR_DIFF_RANGE" \
  | grep -E '^(docs/(adr|arch)/|MAP\.md$|AGENTS\.md$|agents/)' || true)
# New ADRs added in this diff
NEW_ADRS=$(git diff --name-only --diff-filter=A "$FULL_PR_DIFF_RANGE" \
  | grep -E '^docs/adr/adr-[0-9]+' || true)
# Existing ADRs modified in this diff
MODIFIED_ADRS=$(git diff --name-only --diff-filter=M "$FULL_PR_DIFF_RANGE" \
  | grep -E '^docs/adr/adr-[0-9]+' || true)
```

This summary is passed to the Architecture agent's briefing in Phase 3
as anchor data. No findings are emitted at this step.

## Phase 3: Spawn agents

**Core agents (always spawned):**

| Agent       | Focus                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Correctness | Logic bugs, panic discipline, error propagation, API contracts, external-invocation audit (substitution + documented behavior) |
| Data-safety | Secrets/credentials, injection (path traversal, SQL, XSS, command), PII in logs/errors, untrusted input                        |

**Dynamic agents (by file types in the active diff or by `language_hints`):**

| Trigger                                                                                                                                                             | Agent                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `*.rs`                                                                                                                                                              | Rust — clippy, unsafe, ECS, serde, WASM                                                                                    |
| `*.ts` / `*.tsx`                                                                                                                                                    | TypeScript — types, React patterns, bridge sync                                                                            |
| `tests/` or `*_test.*`                                                                                                                                              | Test — coverage, correctness, fixtures                                                                                     |
| `docs/` or `*.md`                                                                                                                                                   | Docs — accuracy, staleness, contract alignment, identifier drift (within-document and cross-document)                      |
| `Cargo.toml`, `package.json`, `tsconfig.json`, `*.config.*`, `mod.rs`, `index.ts`, `docs/adr/**`, `docs/arch/**`, `MAP.md`, `AGENTS.md`, `agents/**`, or 3+ modules | Architecture — boundary violations, dependency justification, responsibility drift, contract changes, AFDS v2 ADR coverage |
| CLI command handlers, public API surfaces, user-facing config schemas, or files referenced by existing docs                                                         | Documentation — missing/stale docs for changed behavior, contract alignment, operator guidance gaps                        |

**Architecture-agent override (full-PR scope on follow-up narrow mode):**
when `is_followup_narrow == true` and `ARCH_FILES` (from the Phase 2
doc-impact summary) is non-empty, **always spawn the Architecture
agent** even when the active diff alone would not trigger it. The
agent's _active_ diff stays incremental (for code-review fidelity), but
its briefing carries the full-PR doc-impact summary plus an explicit
instruction: "the ADR-coverage sub-check applies to the full PR, not
just the incremental diff."

**Documentation-agent override (parallel to the Architecture override):**
when `is_followup_narrow == true` and the doc-impact summary indicates
user-facing changes elsewhere in the PR, the same override applies to
the Documentation agent: always spawn it, briefing carries the full-PR
doc-impact summary, active diff stays incremental.

**Agent briefing — each prompt MUST include:**

1. Role — one sentence
2. Context — `working_directory`, `base_ref`, `head_sha`, changed files with +/- counts
3. Active diff — the diff at `active_diff_range`
4. Full-PR diff scope — equals active for branch-review; may be wider for pr-review follow-up narrow mode
5. Discovered guidelines — actual content, not file paths
6. Prior review context (when `prior_threads` provided) — threads, author replies
7. Output format — file path (repo-relative), line number, severity (`Blocking` or `Nit`), category (`Logic`, `Safety`, `Architecture`, `Tests`, `Maintainability`, `Documentation`, or `Contracts`), code reference, recommendation, anchor classification

Compose review-specific prompts referencing actual files and line counts.
Generic prompts like "review this diff" are prohibited.

Run all agents in parallel.

**Model selection:** Use `{{model:deep}}` for all review agents and the
critic. Review is the final quality gate — the cost of missing a real
bug far outweighs the cost of a more capable model.
