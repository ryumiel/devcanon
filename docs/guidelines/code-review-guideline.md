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

## 3. Procedure and Workflow Invariant Review

Procedure and workflow invariant review is a cross-cutting review lens for
diffs that change repeatable procedure semantics. It is not a new reviewer
role, automation route, skill, agent, or finding category; findings still use
the severity and category model above.

Apply this lens when a diff changes actor handoffs, ordered phases, required
sequencing, gates, approvals, branch conditions, lifecycle or resource
handling, retry/fix/re-review loops, cleanup rules, escalation paths, failure
classification, failure routing, normative examples, or tests and assertions
for procedural behavior.

For governance or workflow policy changes, reviewers should also use the
Adjacent Governance Policy Set in
`docs/guidelines/documentation-checklists.md` as a review-time backstop. Check
whether the diff introduces contradictions across the named adjacent authority
surfaces, and verify that any missing, inapplicable, or intentionally unchanged
surface is named with a reason instead of inferred from generated output or
issue/comment evidence.

Do not apply this lens to editorial-only documentation cleanup or ordinary
wording changes that do not alter actor handoff, order, resource lifetime,
failure routing, ownership, or target-supported capabilities.

Reviewers should mentally model enough of the changed procedure to identify:

- actors, such as controller, implementer, reviewer, user, or external service
- procedure phases and result states
- owned resources, such as sessions, worktrees, files, locks, tokens, or review
  findings
- target-supported capabilities, such as inventory, close, retry, post, or
  fetch
- transitions, such as dispatch, handoff, review, fix, retry, cleanup, close,
  or escalate
- failure classes, such as task failure, review failure, orchestration or
  resource failure, user-decision blocker, or external-system failure

Findings from this lens should cite the concrete violated invariant,
transition, resource lifetime, failure route, ownership boundary,
target-supported capability, or authoritative example. Use qualified
terminology where ambiguity matters, such as `procedure phase`,
`target-supported capability`, `ledger cleanup state`, `owning artifact`, or
`mutable external system`, instead of bare terms like state, capability, or
resource.

Common failure shapes include:

- resources closed before a later required use
- capability and state conflation
- failure routed to the wrong handler
- retry, fix, or re-review loops broken or skipped
- cleanup or retry rules that discard state needed for recovery
- examples that contradict normative procedure prose
- tests that assert generic wording instead of invariant-specific behavior

Map invariant failures back to existing categories:

- **Logic**: invalid transition, premature terminal state, or broken retry,
  fix, or re-review loop
- **Architecture**: misplaced procedure owner, lifecycle ownership issue,
  duplicated procedure ownership, or capability boundary violation
- **Contracts**: contradiction with a source skill, behavior spec, ADR, target
  capability, schema, or declared workflow contract
- **Documentation**: prose or examples that contradict the normative procedure
- **Tests**: tests that assert wording but miss the procedural invariant

Reviewer-specific prompts:

- **Spec/compliance**: Does the change preserve the stated workflow contract
  and acceptance behavior? Are acceptance criteria still reachable after the
  new transition?
- **Architecture**: Does the right artifact own the procedure? Are capability
  boundaries, source-of-truth boundaries, and lifecycle ownership coherent?
- **Documentation**: Do examples and prose trace valid transitions under the
  same rules as the normative procedure?
- **Tests**: Do assertions bind the trigger, invariant, owner, and expected
  disposition rather than checking incidental word presence?

Compact trace examples:

- Finding: Given a worker session must remain available for a later
  fix/re-review loop, the owning procedure requires preserving that session
  until review disposition is final, but the changed cleanup step closes it
  immediately after implementation handoff.
- Non-finding: Given a procedure's actor handoff, order, resource lifetime,
  failure routing, and ownership are unchanged, a wording edit that clarifies
  a sentence without changing those semantics is not a procedure-invariant
  finding.

## 4. Review Workflow

1. Read the PR description (or diff summary for self-review).
2. Check CI status before detailed review.
3. Present all `Blocking` findings before any `Nit` findings.
4. Within each severity bucket, group findings by category.
5. Within each category, present the strongest evidence first.
6. Approve when only `Nit` findings remain.

## 5. Coupled Unchanged Code

Reviewers may call out unchanged code only when the current diff makes that
code technically incorrect, contractually inconsistent, or semantically
misleading.

- A newly preferred style or pattern by itself is not enough.
- An imagined broader cleanup by itself is not enough.
- The diff must explicitly create or reveal the contradiction.

## 6. What Reviewers Should Not Do

- Request style changes already enforced by Biome or Prettier
- Block on hypothetical future requirements
- Rewrite the PR in comments; name the problem and suggest a direction
- Request changes you would not actually reject the PR over
- Hold approval waiting for nits to be addressed

## 7. Self-Review Checklist

Before opening a PR, the author should verify:

- [ ] `pnpm run check` passes locally
- [ ] No `Blocking` findings remain in changed files
- [ ] Architecture, docs, and contract changes stay aligned where the diff
      touches them
- [ ] Governance or workflow policy changes were checked against the Adjacent
      Governance Policy Set in `docs/guidelines/documentation-checklists.md`
- [ ] Tests exist for new behavior; bug fixes have regression tests
- [ ] PR description follows the PR guideline (see
      `docs/guidelines/pr-guideline.md`)
- [ ] CONTRIBUTING.md PR checklist answered (schema, snapshot, docs updates)

## 8. Agent-Assisted Review

Agent-assisted review follows this contract:

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
