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

## Phase 4: Sub-checks

### Architecture agent — AFDS v2 ADR-coverage sub-check

When the Architecture agent fires, include the doc-impact summary from
Phase 2 in its briefing and add this rubric to its prompt:

> Evaluate whether the diff makes a _durable architectural decision_ per
> `docs/guidelines/documentation-standard.md` §3.5 (architecture
> decisions, technology adoption/removal, boundary changes, major
> tradeoffs/rejected alternatives).
>
> - Durable decision + new `docs/adr/adr-NNNN-*.md` added: PASS, no finding.
> - Durable decision + existing covering ADR modified: PASS, no finding.
> - Durable decision + no new/modified ADR: `Blocking | Documentation` —
>   _"diff makes durable decision X but lacks ADR coverage; create
>   `docs/adr/adr-NNNN-<title>.md` per `docs/adr/adr-template.md`."_
> - Implementation detail or refactor without durable decision: no finding.
>
> Apply the same judgment for `MAP.md` (per
> `documentation-standard.md` §5.2: "PR must update docs when it changes
> major file paths or directory layout") and `docs/arch/` (system shape
> changes).

**Anchoring rule for missing-file findings (activates when `mode == "github-post"`):**

When findings will be posted as inline GitHub comments (which require
`path` + `line`), and the recommendation is to _create a new file_ (e.g.,
missing ADR), anchor the inline comment to the most architecturally-
significant line in the diff, in this priority order:

1. `MAP.md` — last changed line (architectural index)
2. `AGENTS.md` — last changed line
3. The line of the most-modified file under `src/`, `agents/`, or `skills/`
4. The last changed line of any file in `ARCH_FILES` (covers PRs whose architectural surface is `docs/adr/**`, `docs/arch/**`, or `agents/**` only)
5. The last changed line of the most-modified file in the diff (any file — covers PRs whose only changes are non-arch files like `package.json`, `Cargo.toml`, `tsconfig.json`, that nonetheless represent a durable architectural decision)

Tag the finding with `Anchor: missing-file`. Begin the comment body with:
_"Missing-file finding (no natural anchor — see body):"_ so the reader
knows the comment refers to a file that should be created, not a flaw
at the anchored line.

When `mode != "github-post"`, do not anchor — tag the finding with
`Anchor: missing-file` anyway and let the wrapper describe the missing
file directly in conversation.

### Correctness agent — Sub-check 1: Substitution audit

Fires when the active diff replaces one external invocation token with a
sibling at the same call site (e.g., `git branch -d` → `git branch -D`,
`fs.writeFileSync` → `fs.writeFile`, `gh pr review --body ...` →
`gh api .../reviews --input ...`). "External invocation" means a CLI
flag/subcommand swap, a method swap on an external SDK, a system
primitive swap (`unlink` ↔ `rm -rf`), or a flag-set rearrangement on
the same call.

Procedure:

1. Identify the replaced primitive (old → new), citing the diff hunk.
2. Enumerate every safety property, precondition check, or rejection mode the OLD primitive enforced. Pull from the tool's documented behavior (`--help` / official docs) when the property isn't obvious from the name alone.
3. For each property, classify what the NEW code does: PRESERVES (same property holds), GUARDS (replaces with an equivalent runtime check), or SILENTLY DROPS (no equivalent guard, no waiver).
4. A SILENTLY DROPS finding is `Blocking`, category `Safety`, unless the diff or surrounding spec explicitly waives the property with a rationale.

**Bounding rule:** apply only to _external_ invocations (CLIs, REST/HTTP APIs, OS primitives, third-party SDK calls). Do not apply to internal-code refactors, literal renames, or mechanical formatting changes. The agent should self-check: "is the named primitive defined inside this repo, or by a tool whose semantics live elsewhere?"

**Disposition:** judgment-required. The fix for a lost safety property is a guard, which is design work — multiple reconstructions are usually possible. Findings surface as `Blocking`, category `Safety`. Wrappers' auto-fix paths (e.g., `branch-review --fix`) must NOT auto-fix Sub-check 1 findings.

Worked example (real, PR #117): a diff replaces `git branch -d` with `git branch -D` to silence a spurious squash-merge warning. The OLD primitive's safety properties include rejecting deletion when the branch has unmerged commits relative to its upstream and HEAD. The NEW primitive (`-D`) accepts unconditionally, and the diff adds no surrounding guard. Verdict: SILENTLY DROPS the unmerged-commit rejection — `Blocking | Safety`, with the recommendation to add a tip-equality check (local tip == PR head OID) before `-D` runs.

### Correctness agent — Sub-check 2: Documented-behavior verification

Fires when the active diff adds a new external invocation, or modifies an
existing one's flags / body shape / query parameters. Substitutions
(Sub-check 1's trigger) are a subset; Sub-check 2 is the broader case.
Examples in scope: any new `gh api` / `gh pr` invocation, any `git`
invocation with a non-trivial flag combination, any new `fetch(` /
`axios.` / HTTP-client call, any new child_process / subprocess
invocation, any new file-system primitive (`fs.*`, `unlink`, etc.).
Excluded: pure language-stdlib calls with stable, well-understood
semantics (`Array.map`, `JSON.stringify`).

Procedure:

1. Identify the tool and the specific invocation pattern (subcommand, flags, body shape, query params).
2. Verify the invocation against documented behavior — the tool's `--help` output, official docs, or actual runtime behavior. Do **not** approve based on prior knowledge of flag interactions or default semantics.
3. Flag any divergence: invocation that won't do what the surrounding code claims, silently-ignored arguments, defaults that change between adjacent flag combinations, etc.
4. Tag any divergence as DOCUMENTED-BEHAVIOR MISMATCH; this is `Blocking`, category `Contracts`, unless the diff or surrounding spec explicitly waives the documented behavior with a rationale.

**Bounding rule:** don't re-verify the tool's whole API surface — only the specific invocation pattern in the diff. Don't flag stable, widely-known stdlib behavior. The bar is "could a reasonable reviewer assume the wrong semantics here?" — if yes, verify.

**Disposition:** judgment-required. Even a flag-swap fix is rarely a 1–3 line mechanical change in practice. Findings surface as `Blocking`, category `Contracts`. Wrappers' auto-fix paths must NOT auto-fix Sub-check 2 findings.

Worked example (real, PR #127): a diff adds a `gh api repos/{owner}/{repo}/pulls/<N>/reviews` invocation that mixes `-f commit_id=...`, `-f event=...`, `-f body=...` with `--input <file>`. The Correctness agent reads `gh api --help` and identifies that when `--input` is supplied, sibling `-f` flags become URL query parameters, not body fields — so `commit_id`, `event`, and `body` are silently dropped from the POST body. Verdict: DOCUMENTED-BEHAVIOR MISMATCH — `Blocking | Contracts`, with the recommendation to build the entire payload inside `jq -n` so all fields land in the JSON body.

### Docs agent — Sub-check A: Within-document identifier drift

For each changed `*.md` file in the active diff:

- Compare backticked identifiers in prose against identifiers used in adjacent fenced code blocks within the same file.
- Flag any prose identifier whose code-block counterpart uses a different name, or any code-block identifier whose surrounding prose names something else.
- Report as `Blocking`, category `Documentation`. Auto-fixable via wrapper `--fix` (the code block is canonical; rewrite prose to match). If the code block is itself wrong, reclassify as judgment-required and route to nits — do not auto-fix.

Illustrative scenario (pattern from PR #106): a single `.md` file describes a worktree-cleanup procedure where the prose narrates "`git worktree prune` removes the directory" while the adjacent code block invokes `git worktree remove <path>`. The two identifiers diverged across review rounds — code was updated; prose was not. Sub-check A flags this as `Blocking | Documentation`, with the recommendation "the code block is canonical; rewrite prose to match."

### Docs agent — Sub-check B: Cross-document identifier drift

Fires only when the active diff adds prose explicitly labeling a pattern
as broken, deprecated, superseded, or wrong. A silent example-replacement
(replacing X with Y without adding anti-pattern prose) does NOT trigger
Sub-check B.

**Both `branch-review` and `pr-review` invocations get this sub-check.**
The wrapper handles `Anchor: out-of-diff` findings per its surface (see
output contract).

When the trigger fires:

- Grep the repository for unchanged occurrences of pattern X.
- Flag any occurrence as a blocking finding requiring out-of-diff edits: "unchanged file still demonstrates pattern X which this diff documents as broken / superseded". Tag the finding `Anchor: out-of-diff`.
- **Bounding rule:** only grep for patterns the diff explicitly changes the direction of. Do not grep for every backticked identifier in the diff.
- **Wrapper disposition:** report-only. Wrappers' `--fix` paths do not auto-fix files outside the diff. The new direction may not always be canonical, or the unchanged file may represent intentional asymmetry — Sub-check B findings surface for human judgment.

Illustrative scenario (pattern adapted from PR #127, hypothetical): suppose a diff to one skill adds prose explicitly calling out that `gh api -f <field>=<value>` combined with `--input <file>` is broken because `-f` arguments become URL query parameters when `--input` is supplied. Sub-check B greps the corpus for the broken pattern. Any unchanged sibling files still demonstrating it would each be flagged as a blocking, out-of-diff finding.
