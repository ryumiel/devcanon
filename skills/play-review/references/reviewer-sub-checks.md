# Reviewer Sub-Checks - `play-review`

Load this reference when composing Phase 4 role-specific sub-checks. The
reviewer routing and hard gates remain in `SKILL.md`.

## Code-quality Reviewer

### Sub-check 1: Substitution Audit

Fires when the active diff replaces one external invocation token with a
sibling at the same call site, such as a CLI flag/subcommand swap, external SDK
method swap, system primitive swap, or flag-set rearrangement on the same call.

Procedure:

1. Identify the replaced primitive (old -> new), citing the diff hunk.
2. Enumerate every safety property, precondition check, or rejection mode the
   old primitive enforced. Pull from `--help` or official docs when needed.
3. For each property, classify the new code as PRESERVES, GUARDS, or SILENTLY
   DROPS.
4. A SILENTLY DROPS finding is `Blocking | Safety` unless the diff or
   surrounding spec explicitly waives the property with rationale.

Bounding rule: apply only to external invocations, not internal-code refactors,
literal renames, or mechanical formatting changes.

Disposition: judgment-required. Wrappers' auto-fix paths must not auto-fix
Sub-check 1 findings.

#### Sub-check 1: Substitution audit — worked example

Worked example: a diff replaces `git branch -d` with `git branch -D` to silence
a spurious squash-merge warning. The old primitive rejects deletion when the
branch has unmerged commits relative to its upstream and HEAD. The new primitive
accepts unconditionally, and the diff adds no surrounding guard. Verdict:
SILENTLY DROPS the unmerged-commit rejection - `Blocking | Safety`.

### Sub-check 2: Documented-Behavior Verification

Fires when the active diff adds a new external invocation or modifies an
existing invocation's flags, body shape, or query parameters. Substitutions are
a subset.

Procedure:

1. Identify the tool and specific invocation pattern.
2. Verify against documented behavior: tool `--help`, official docs, or actual
   runtime behavior. Do not approve based only on prior knowledge.
3. Flag divergence: ignored arguments, wrong defaults, body/query confusion, or
   behavior that will not match surrounding claims.
4. Tag divergence as DOCUMENTED-BEHAVIOR MISMATCH:
   `Blocking | Contracts` unless explicitly waived with rationale.

Disposition: judgment-required. Wrappers' auto-fix paths must not auto-fix
Sub-check 2 findings.

Worked example: `gh api repos/{owner}/{repo}/pulls/<N>/reviews` mixed with
`-f commit_id=...`, `-f event=...`, `-f body=...`, and `--input <file>`.
`gh api --help` shows that with `--input`, sibling `-f` flags become URL query
parameters, not body fields. Verdict: DOCUMENTED-BEHAVIOR MISMATCH -
`Blocking | Contracts`.

### Data-Safety, Language, and Tests

Always include:

- Data-safety: secrets, injection, PII in logs/errors, destructive filesystem
  behavior, and untrusted input handling.
- Language quality: TypeScript type safety, React patterns, Rust
  panic/unsafe/error discipline, serialization boundaries, and
  runtime-specific issues shaped by `language_hints`.
- Tests: assertions, fixtures, failure modes, and whether tests would fail for
  the bug they claim to cover.

## Architecture Reviewer

Use `references/reviewer-routing-policy.md` for ADR coverage. Architecture also
checks boundary violations, dependency justification, responsibility drift,
contract changes, generated/source ownership, and durable decision indicators.

## Spec Reviewer

### Sub-check A: Within-Document Identifier Drift

For each changed `*.md` file, compare backticked identifiers in prose against
identifiers used in adjacent fenced code blocks within the same file. Flag
divergence as `Blocking | Documentation`. Auto-fixable only when the code block
is canonical; if the code block is wrong, route to judgment instead.

Illustrative scenario: prose says "`git worktree prune` removes the directory"
while the adjacent code block invokes `git worktree remove <path>`.

### Sub-check B: Cross-Document Identifier Drift

Fires only when the active diff adds prose explicitly labeling a pattern as
broken, deprecated, superseded, or wrong. Grep the repository for unchanged
occurrences of that pattern. Flag unchanged occurrences as blocking
out-of-diff findings requiring judgment.

Do not grep for every backticked identifier. Only grep for patterns whose
direction the diff explicitly changes.

### Documentation Guidance Checks

When Spec fires, check changed docs/spec/API/user-facing behavior,
CLI/operator guidance, examples, public config schemas, files referenced by
existing docs, and operator workflow prose for missing, stale, or contradictory
documentation. Use `Documentation` for stale/missing docs, `Contracts` for
public behavior mismatches, and `Safety` when stale guidance would lead to
unsafe operation.
