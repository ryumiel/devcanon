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

This skill produces three outputs per invocation: two artifacts (a markdown surface for operators and a structured file for consumers) plus a one-line notice that links them.

1. **In-conversation markdown** — a `## Findings` section and (follow-up only) a `## Carry-forward` section, each entry shaped as below. Operators read this surface; downstream tools read the side-channel file (part 3).
2. **Side-channel file** — the `play-review/findings/v1` envelope, written to a deterministic `.ephemeral/` path (described in part 3).
3. **One-line notice** — appended to the markdown above, naming the file path so consumers can locate it without recomputation.

### 1. `## Findings` section

One entry per finding, with stable headers:

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

### 2. `## Carry-forward` section (follow-up only)

Prior threads still open after re-verification, in the same shape as `## Findings` entries.

### 3. Side-channel file (consumer contract)

The structured envelope is written to a deterministic file under `.ephemeral/`. Schema name: `play-review/findings/v1`. Defined as the authoritative output contract for downstream consumers (`branch-review --fix`, `pr-review` Phase 6, `play-branch-finish` `nits_file`, `issue-priming-workflow` Phase 7). The envelope shape and per-field contract are defined in the `#### Envelope shape` and `Per-field contract` subsections below; the side-channel file (rather than an inline JSON fence in conversation) is the contract surface so consumers don't have to re-parse the human-readable findings.

#### Path

```
.ephemeral/<branch_slug>-<head_sha>-findings.json
```

- `<head_sha>` — the required `head_sha` input. Full 40-character SHA, lowercased. MUST match the regex `^[0-9a-f]{40}$`.
- `<branch_slug>` — derived from the current branch with the bash below. `git rev-parse --abbrev-ref HEAD` returns the literal string `HEAD` for detached-HEAD checkouts (e.g., `pr-review` fork PRs that use `gh pr checkout --detach`), so explicit detection is required:

  ```bash
  RAW_BRANCH=$(git -C "$WORKING_DIRECTORY" rev-parse --abbrev-ref HEAD)
  if [ "$RAW_BRANCH" = HEAD ]; then
    BRANCH_SLUG=detached
  else
    BRANCH_SLUG=$(printf '%s' "$RAW_BRANCH" | tr '/' '-' | tr -cd '[:alnum:]._-')
    # Substitute `unnamed` for slugs that would widen the path-interpretation
    # surface: empty after stripping, bare `.` / `..`, or starting with `-` or `.`.
    case "$BRANCH_SLUG" in
      ''|.|..|-*|.*) BRANCH_SLUG=unnamed ;;
    esac
  fi
  ```

The path is computed and written by this skill, not by the wrapper. Wrappers locate the file by reading the notice line below, then **MUST validate the parsed path before opening or overwriting it** — a prompt-injected `play-review` run (e.g., adversarial markdown in the diff under review) could otherwise redirect the path. The validation is a single guard:

```bash
case "$FINDINGS_FILE" in
  .ephemeral/*-findings.json|.ephemeral/*-nits-pending.json) ;;
  *) echo "play-review path validation failed: $FINDINGS_FILE" >&2; exit 1 ;;
esac
[ "${FINDINGS_FILE#*..}" = "$FINDINGS_FILE" ] || { echo "path traversal: $FINDINGS_FILE" >&2; exit 1; }
```

Consumers (`branch-review --fix`, `pr-review` Phase 6, `play-branch-finish`, `issue-priming-workflow` Phase 7) MUST run this guard before opening or overwriting the file.

#### Envelope shape

```json
{
  "schema": "play-review/findings/v1",
  "findings": [
    {
      "path": "skills/play-review/SKILL.md",
      "line": 42,
      "start_line": null,
      "severity": "Blocking",
      "category": "Safety",
      "critic": "VALID",
      "anchor": "natural",
      "why": "<plain why-clause prose>",
      "recommendation": "<concrete suggestion prose>",
      "body": "**Blocking | Safety** — <why>\n\n**Recommendation:** <recommendation>"
    }
  ],
  "carry_forward": []
}
```

Per-field contract:

| Field            | Type                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`         | string literal `"play-review/findings/v1"`                                                                            | Pinned. Additive changes (new optional fields) stay on `v1`. Renames, removals, or type changes require a major bump (`v2`).                                                                                                                                                                                                                                   |
| `findings`       | array                                                                                                                 | One object per finding emitted in this report.                                                                                                                                                                                                                                                                                                                 |
| `carry_forward`  | array (same per-finding shape as `findings`)                                                                          | Follow-up `pr-review` only; otherwise the empty array `[]`.                                                                                                                                                                                                                                                                                                    |
| `path`           | string, repo-relative                                                                                                 | Same shape consumers (`play-branch-finish`, GitHub Reviews API) expect.                                                                                                                                                                                                                                                                                        |
| `line`           | integer, HEAD-side absolute line                                                                                      | Matches `play-branch-finish`'s `line` field and the GitHub Reviews API.                                                                                                                                                                                                                                                                                        |
| `start_line`     | integer or `null`                                                                                                     | `null` when single-line; integer for multi-line ranges (matches GitHub Reviews API).                                                                                                                                                                                                                                                                           |
| `severity`       | `"Blocking"` \| `"Nit"`                                                                                               | Verbatim from the markdown `Severity:` value.                                                                                                                                                                                                                                                                                                                  |
| `category`       | `"Logic"` \| `"Safety"` \| `"Architecture"` \| `"Tests"` \| `"Maintainability"` \| `"Documentation"` \| `"Contracts"` | Verbatim from the markdown `Category:` value.                                                                                                                                                                                                                                                                                                                  |
| `critic`         | `"VALID"` \| `"INVALID"` \| `"DOWNGRADE"` \| `null`                                                                   | `null` for nits — they skip critic verification (see Phase 5: "Nits skip critic verification."). This is the one field where the JSON value is not verbatim from the markdown: the markdown writes `Critic: (skipped — nit)`, the JSON writes `null`.                                                                                                          |
| `anchor`         | `"natural"` \| `"missing-file"` \| `"out-of-diff"`                                                                    | Verbatim from the markdown `Anchor:` value.                                                                                                                                                                                                                                                                                                                    |
| `why`            | string, plain text                                                                                                    | The why-clause from the markdown finding (no markdown wrappers).                                                                                                                                                                                                                                                                                               |
| `recommendation` | string, plain text                                                                                                    | The concrete suggestion from the markdown finding (no markdown wrappers).                                                                                                                                                                                                                                                                                      |
| `body`           | string, ready-to-post markdown                                                                                        | Pre-rendered as `**<severity> \| <category>** — <why>\n\n**Recommendation:** <recommendation>`. Suitable for direct use as `gh api .../reviews` `comments[].body`. Newlines, quotes, and backslashes inside this string follow standard JSON string-escaping (`\n`, `\"`, `\\`); consumers MUST NOT post-process the unescaped form before passing it through. |

The schema omits a `side` field (all findings are HEAD-side; consumers default themselves) and the markdown finding's evidence code (consumers re-read the file using `path` + `line` + `start_line`).

#### Write rules

- Always write the envelope, even when both `findings` and `carry_forward` are empty. The canonical empty form is `{"schema":"play-review/findings/v1","findings":[],"carry_forward":[]}`.
- Overwrite the file on each invocation (deterministic path; the previous content for the same branch + SHA is no longer authoritative).
- Use the `Write` tool for atomic replacement. Do not append.
- **Symlink guard.** `Write` follows symlinks, so a pre-existing symlink at the path (left over from a prior run, or pre-staged in a fork-PR's working tree under `pr-review`'s `gh pr checkout --detach`) would redirect the write to the link's target. Before writing, remove any symlink at the path: `[ -L "$FINDINGS_FILE" ] && rm "$FINDINGS_FILE"`. Apply the same guard wherever `branch-review --fix` overwrites this file or `issue-priming-workflow` Phase 7 derives the sibling `-nits-pending.json` path.

### 4. One-line notice (consumer hook)

After writing the envelope, append exactly one line to the markdown output:

```
Findings written to <repo-relative-path>.
```

This is the only structured surface in conversation. Consumers parse the path off this line; `branch-review`, `pr-review`, and `issue-priming-workflow` all rely on its exact form. Do not reword it.

The wrapper consumes this output and disposes per its surface (present, fix, post). This skill never touches GitHub, never auto-fixes, never creates or removes worktrees. Writing the findings envelope to the deterministic `.ephemeral/` path is part of this skill's output contract.

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

## Phase 2.5: Compose shared review context

Phase 3 dispatches multiple reviewer agents. Rather than re-paste the
shared briefing material into every agent's prompt, write it once to a
deterministic ephemeral file and let each agent `Read` it. The path
scheme parallels the findings envelope (see § Output) and uses the
same file-based substrate so that agents read content from disk
rather than receiving large inline contexts; this file is internal
phase scaffolding, not a consumer contract. The file lives under
`.ephemeral/`
(git-ignored, same residency as the findings envelope).

### Path

```
.ephemeral/<branch_slug>-<head_sha>-review-context.md
```

`<branch_slug>` is derived identically to the findings envelope —
reuse the `BRANCH_SLUG` shell binding computed in § Output.
`<head_sha>` is the `head_sha` skill input, validated per § Output's
SHA-format constraint (`^[0-9a-f]{40}$`).

### Content

Compose the file with these sections, in order:

1. **Header** — `working_directory`, `base_ref`, `head_sha`,
   `active_diff_range`, `full_pr_diff_range`, `mode`, `language_hints`
   as a key/value list.
2. **Changed files (active diff)** — `git diff --name-status "$ACTIVE_DIFF_RANGE"` output, fenced.
3. **Doc-impact summary** — the `ARCH_FILES`, `NEW_ADRS`, `MODIFIED_ADRS`
   lists from Phase 2 (always computed against `full_pr_diff_range`).
   Emit `(none)` per list when empty so layout is stable.
4. **Discovered guidelines** — for each guideline file matched by
   Phase 1's globs, a `### <repo-relative-path>` heading followed by
   the verbatim file contents. The "actual content, not file paths"
   constraint is satisfied here, in the shared file, rather than per
   agent.
5. **Output format** — the same severity / category / anchor / evidence
   spec every finding must conform to (see Phase 3 prose and
   `## Output` § 1).
6. **Prior review context** — emit only when `prior_threads` is
   provided; the `prior_threads` array verbatim.

### Write rules

- **Symlink guard before write.** `Write` follows symlinks; an attacker
  pre-staging a link at the target would redirect the write (see § Output
  for the fork-PR scenario this guard defends against). Reuse the guard
  pattern from § Output:

  ```bash
  HEAD_SHA="$head_sha"  # validated upstream per § Output's SHA-format check
  CONTEXT_FILE=".ephemeral/${BRANCH_SLUG}-${HEAD_SHA}-review-context.md"
  [ -L "$CONTEXT_FILE" ] && rm "$CONTEXT_FILE"
  ```

- **Use the `Write` tool** for atomic replacement. Do not append.
- **Existence check after write.**

  ```bash
  [ -s "$CONTEXT_FILE" ] || { echo "shared review-context write failed: $CONTEXT_FILE" >&2; exit 1; }
  ```

  A silent write failure would leave dispatched agents reading an
  absent file and emitting findings without guideline awareness — fail
  fast instead.

- **Overwrite on each invocation.** Same `<branch_slug>` + `<head_sha>`
  produces the same path; previous content is no longer authoritative.

### Why no consumer path-validation guard

See [`references/internal-rationale.md`](references/internal-rationale.md#why-no-consumer-path-validation-guard) for why this file has no consumer-side validation guard.

### Why no notice line

See [`references/internal-rationale.md`](references/internal-rationale.md#why-no-notice-line) for why this file emits no notice line.

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

1. Role — one sentence describing this agent's focus
2. Shared review-context reference — instruct the agent to `Read` `.ephemeral/<branch_slug>-<head_sha>-review-context.md` (composed in Phase 2.5) before reviewing. The file carries header context, changed-file list, doc-impact summary, discovered guidelines, output format, and (when applicable) prior review threads.
3. Active diff invocation — instruct the agent to run `git diff "$ACTIVE_DIFF_RANGE"` from `working_directory`
4. Role-specific sub-checks — composed inline, referencing actual files and line counts visible in the diff

The skeleton lives at [`skills/play-review/references/agent-briefing-template.md`](references/agent-briefing-template.md); follow it when adding a new dynamic agent.

Per-agent role-specific sub-checks (item 4) must reference actual files
and line counts from the diff. Generic prompts like "review this diff"
are prohibited. The shared review-context block is path-referenced (see
Phase 2.5) — that is the deliberate exception; each agent's role-specific
block remains diff-specific.

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

See [`references/sub-check-examples.md`](references/sub-check-examples.md#sub-check-1-substitution-audit--worked-example) for a worked example (`git branch -d` → `-D`).

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

See [`references/sub-check-examples.md`](references/sub-check-examples.md#sub-check-2-documented-behavior-verification--worked-example) for a worked example (`gh api -f` vs `--input`).

### Docs agent — Sub-check A: Within-document identifier drift

For each changed `*.md` file in the active diff:

- Compare backticked identifiers in prose against identifiers used in adjacent fenced code blocks within the same file.
- Flag any prose identifier whose code-block counterpart uses a different name, or any code-block identifier whose surrounding prose names something else.
- Report as `Blocking`, category `Documentation`. Auto-fixable via wrapper `--fix` (the code block is canonical; rewrite prose to match). If the code block is itself wrong, reclassify as judgment-required and route to nits — do not auto-fix.

See [`references/sub-check-examples.md`](references/sub-check-examples.md#docs-sub-check-a-within-document-identifier-drift--illustrative-scenario) for an illustrative scenario (worktree-cleanup prose vs. code drift).

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

See [`references/sub-check-examples.md`](references/sub-check-examples.md#docs-sub-check-b-cross-document-identifier-drift--illustrative-scenario) for an illustrative scenario (hypothetical, modeled on a `gh api -f` vs `--input` mismatch).

## Phase 5: Critic verification

Spawn a critic agent with all findings merged. The critic reads actual
code in `working_directory` and tags each **blocking** finding:

- **VALID** — holds up
- **INVALID** — code doesn't match the claim
- **DOWNGRADE** — valid but not blocking

**Treat every concrete reference as a literal claim, not as illustrative rhetoric.** Verify cited `file:line`, identifiers, commands, commit SHAs, and PR numbers by opening the cited artifact; tag the finding INVALID if the cited artifact does not exist or does not contain the cited text. See [`references/critic-rationale.md`](references/critic-rationale.md) for the full rationale, including why internal consistency is not evidence of literal intent.

**Carry-forward (follow-up only):** when `prior_threads` is provided,
cross-reference each prior blocking finding against the new code in
`working_directory`. If the flagged code is unchanged, carry the finding
forward in the `## Carry-forward` output section as "still open" rather
than silently dropping it.

Nits skip critic verification.

**Model selection:** Use `{{model:deep}}` for the critic.

## Hard Rules

1. **Always spawn the Data-safety agent** regardless of file types.
2. **Always include evidence code** (3-7 lines) in findings.
3. **Cite specific lines.** No generic warnings without code references.
4. **Verify every concrete reference in the critic phase.** No assumptions.
5. **Never invoke `gh` commands.** GitHub interaction is the wrapper's job; this skill operates only on local git state in `working_directory`.
6. **Never auto-fix.** Disposition (present, fix, post) is the wrapper's job; this skill emits findings.
7. **Never create or remove worktrees.** The wrapper sets up `working_directory` and tears it down.
8. **Always write the `play-review/findings/v1` envelope** to the deterministic file path defined in § Output, even when both `findings` and `carry_forward` are empty. Always emit the literal `Findings written to <repo-relative-path>.` notice line in the conversation output. The file is the consumer contract; consumers must never encounter an absent file or a missing notice line.
9. **Always write the shared review-context file (Phase 2.5) before dispatching Phase 3 agents** — agents reference it by path. An absent or empty shared review-context file is a violation.

## Red Flags — You Are Violating This Skill

See [`references/red-flags.md`](references/red-flags.md) for behavioral signals that this skill is being violated.

## Error Handling

| Scenario                                                                              | Action                                                                                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Required input missing                                                                | Stop, report which input the wrapper failed to provide                                 |
| `working_directory` empty or invalid                                                  | Stop, report                                                                           |
| Diff at `active_diff_range` is empty                                                  | Report "no changes to review", emit empty findings                                     |
| No guidelines found                                                                   | Note in the findings preamble, proceed with built-in knowledge                         |
| Agent fails / times out                                                               | Report partial results in findings; mark missing agents                                |
| Critic fails                                                                          | Report findings without critic verdicts; mark them as such                             |
| Phase 2.5 shared review-context write fails (`[ -s "$CONTEXT_FILE" ]` exits non-zero) | Stop, report the path; do NOT dispatch Phase 3 agents — they would read an absent file |
