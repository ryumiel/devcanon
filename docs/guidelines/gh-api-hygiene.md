# gh CLI Hygiene

## 1. Scope

This guideline applies to every documented `gh api` invocation in `skills/` and any other authored shell snippet that runs in conversation context. The rule scopes or suppresses unfiltered response bodies that would otherwise consume context budget — `gh api` POST and mutation responses are typically 1-2 KB of JSON the caller does not consume. `gh` already supports `--jq <expr>` to extract a specific field and `--silent` to suppress the body entirely; this guideline codifies which to use when.

## 2. Default Rule

| Caller intent                              | Flag                                 | Example                                                                               |
| ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Use one or more fields from the response   | `--jq '<expr>'` (or short form `-q`) | `gh pr view <N> --json headRefOid --jq .headRefOid`                                   |
| Only need to know the call succeeded       | `--silent`                           | `gh api repos/{owner}/{repo}/pulls/<N>/reviews --method POST --silent --input <(...)` |
| Genuinely consume the full body downstream | bare `gh api` + inline annotation    | see § 3                                                                               |

Both `--jq` and `-q` (short form) are accepted; existing snippets in this repo use both.

`--silent` does **not** mask HTTP failures: `gh api --silent` only suppresses stdout. The command still exits non-zero on a 4xx or 5xx response, so any caller that relies on exit status to detect failures (e.g., `pr-review/SKILL.md` Phase 6 step 3) keeps working unchanged.

## 3. When the Full Body Is Justified

Bare `gh api` (no `--jq`, no `--silent`) is acceptable only when the caller genuinely consumes the response body. Qualifying cases:

- A downstream parser reads two or more fields from the response.
- A content-keyed lookup walks a list and selects an item by inner field value.
- The response feeds a fixture or test snapshot.

When bare `gh api` is genuinely required, add an inline comment in the snippet that names what the caller does with the body and links back to this guideline. Without the annotation, reviewers will (correctly) flag the snippet under [`code-review-guideline.md`](code-review-guideline.md) § 2 Documentation.

Worked examples in this repo:

- [`skills/pr-review/SKILL.md`](../../skills/pr-review/SKILL.md) Phase 1 (lines 44-45) — the `gh api .../comments` and `.../reviews` reads feed Phase 4's `prior_threads` parsing on line 100. Multiple fields per entry are consumed.
- [`skills/pr-review/SKILL.md`](../../skills/pr-review/SKILL.md) `## GitHub API Reference` GraphQL query (around line 237) — fetches all review threads with their comments for content-keyed thread-ID lookup. The whole nested response is the data.

## 4. Authoring Checklist for Skill Snippets

- [ ] Every `gh api` POST or GraphQL mutation snippet uses `--jq` or `--silent`.
- [ ] Every bare `gh api` call has an inline comment explaining body consumption and linking to this guideline.
- [ ] Single-field reads use `--jq '.<field>'` (extract just the field), not bare `gh api`.
- [ ] When success is the only signal, prefer `--silent` over `--jq '.id' >/dev/null` — the intent is clearer and the binary smaller.
- [ ] Cross-link this guideline near the first `gh api` invocation in any new skill that uses raw `gh api`.

A mechanical lint enforcing these rules is feasible (`grep -E 'gh api[^|]*POST'` against `skills/**/*.md`) but is currently out of scope; the guideline is enforced at review time.

## 5. See Also

- [`code-review-guideline.md`](code-review-guideline.md) — the Documentation finding category that covers stale or context-bloating example snippets.
- [`../../skills/pr-merge/SKILL.md`](../../skills/pr-merge/SKILL.md) — exemplar implementation; every read uses `gh pr view --json X --jq Y`.
- [`pr-guideline.md`](pr-guideline.md) — related authoring style and PR description discipline.
