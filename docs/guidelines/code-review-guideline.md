# Code Review Guideline

## 1. Scope

This guideline applies to all code and documentation changes, and covers three
review modes:

- **Self-review**: Author checks their own code before opening a PR
- **Agent-assisted review**: AI agents (Claude Code, Codex) review code using
  the same finding model as human reviewers
- **Peer review**: Human reviewers follow the same finding model when reviewing
  others' code

## 2. Canonical Finding Model

### Severity

- **Blocking**: prevents approval or autonomous continuation until fixed,
  waived with rationale, or explicitly reclassified
- **Nit**: a real issue that should not block approval or autonomous
  continuation

Severity is the merge gate. Review skills, prompts, and human reviewers should
all treat `Blocking` vs `Nit` as the primary decision boundary.

### Categories

- **Logic**: incorrect behavior, missing guards, wrong control flow, bad
  assumptions, or behavior that fails the stated intent
- **Safety**: security, data safety, path handling, injection, secrets, unsafe
  destructive actions, and similar risk-bearing issues
- **Architecture**: boundary violations, misplaced responsibilities, layering
  breaks, dependency direction problems, or structural drift
- **Tests**: missing coverage, incorrect tests, stale fixtures, or verification
  gaps for changed behavior
- **Maintainability**: readability, duplication, naming, extraction, local
  structure, and similar clarity concerns unless elevated by severity
- **Documentation**: prose accuracy, identifier drift in docs, operator
  guidance, examples, and narrative text that misleads readers
- **Contracts**: mismatches between code and enforced or declared interfaces,
  including schemas, public APIs, specs, configuration contracts, and behavior
  that contradicts the repo's authoritative contract sources

Category does not determine whether a finding blocks. Any category can be
either `Blocking` or `Nit`.

## 3. Review Workflow

1. Read the PR description (or diff summary for self-review).
2. Check CI status before detailed review.
3. Present all `Blocking` findings before any `Nit` findings.
4. Within each severity bucket, group findings by category.
5. Within each category, present the strongest evidence first.
6. Approve when only `Nit` findings remain.

## 4. Coupled Unchanged Code

Reviewers may call out unchanged code only when the current diff makes that
code technically incorrect, contractually inconsistent, or semantically
misleading.

- A newly preferred style or pattern by itself is not enough.
- An imagined broader cleanup by itself is not enough.
- The diff must explicitly create or reveal the contradiction.

## 5. What Reviewers Should Not Do

- Request style changes already enforced by Biome or Prettier
- Block on hypothetical future requirements
- Rewrite the PR in comments; name the problem and suggest a direction
- Request changes you would not actually reject the PR over
- Hold approval waiting for nits to be addressed

## 6. Self-Review Checklist

Before opening a PR, the author should verify:

- [ ] `pnpm run check` passes locally
- [ ] No `Blocking` findings remain in changed files
- [ ] Architecture, docs, and contract changes stay aligned where the diff
      touches them
- [ ] Tests exist for new behavior; bug fixes have regression tests
- [ ] PR description follows the PR guideline (see
      `docs/guidelines/pr-guideline.md`)
- [ ] CONTRIBUTING.md PR checklist answered (schema, snapshot, docs updates)

## 7. Agent-Assisted Review

When an AI agent reviews code, it must:

- Lead with one or two short narrative sentences naming what the
  implementation got right before the findings list
- Classify each finding with one severity (`Blocking` or `Nit`) and one
  category (`Logic`, `Safety`, `Architecture`, `Tests`, `Maintainability`,
  `Documentation`, or `Contracts`)
- Never approve its own authored code; a separate review (human or different
  agent session) is required
- Cite specific file paths and line numbers for each finding
- Provide a concrete example or fix suggestion for blocking findings
- Verify CI status rather than assuming correctness
- Check the CONTRIBUTING.md PR checklist items that can be verified
  mechanically (schema alignment, snapshot freshness, MAP.md coverage)
- When dispatching a standalone reviewer agent, the caller must provide
  explicit review scope as a `base..head` ref or unified diff; reviewers
  must not be asked to discover the scope themselves
- When dispatching `spec-compliance-reviewer`, the caller must also provide
  the scoped requirements or task spec it should compare against
