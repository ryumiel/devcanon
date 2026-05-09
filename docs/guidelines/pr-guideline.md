# PR Guideline

## 1. Title Format

- Format: `<type>(<scope>): <short summary>` or `<type>: <short summary>`
- Use lowercase throughout
- Summary describes the result, not implementation steps
- No period at end
- Keep under 80 characters
- Use `!` only for breaking changes; both `feat(config)!: remove legacy format` and `feat!: remove legacy format` are valid
- Types and scopes match CONTRIBUTING.md Commit Policy

## 2. Description Structure

Expanded PR descriptions are the default. Use this structure unless the PR
qualifies for the minimal PR body exception below:

- **Summary**: 1-3 outcome bullets. Summarize by behavior or subsystem, NOT
  file-by-file.
- **Why**: Why the change is needed. Explain what was broken, missing, risky, or
  inadequate.
- **Implementation Notes / Behavior Changes**: Major implementation notes or
  observable behavior changes, grouped by subsystem (`render`, `install`,
  `validate`, etc.). Do not duplicate the diff.
- **Impact and Risk**: User-facing impact, schema impact, performance impact
  when relevant, risk level, and mitigation.
- **Verification**: Concrete commands, manual checks, or review evidence.
- **Breaking Changes**: `None` or the migration impact and required operator
  action.
- **Related Issues**: One of `Closes #N`, `Part of #N`, or
  `No issue: <reason>`.
- **Reviewer / Assignee Notes**: Author assignment and review-request
  expectations.

### Minimal PR Bodies

A minimal PR body is allowed only for low-risk changes with no behavior, schema,
or workflow impact:

- typo fixes;
- comment-only changes;
- generated-output-only updates;
- dependency metadata-only updates that are not dependency, security, or audit
  remediation;
- mechanical documentation maintenance.

Even a minimal PR body must identify verification performed and use one related
issue form: `Closes #N`, `Part of #N`, or `No issue: <reason>`.
Dependency, security, or audit remediation must follow
[dependency-audit-guideline.md](dependency-audit-guideline.md), including its
evidence and lockfile-scope review expectations.

### Reviewer / Assignee Expectations

- Assign yourself when you are actively responsible for carrying the PR through
  review.
- Request review when the PR is ready for another person or agent to evaluate.
- Leave assignees unset for drive-by, draft, or handoff PRs where ownership is
  not yet claimed.

### Breaking Changes

- Use `!` in the PR title when the PR introduces a breaking change.
- Describe migration impact and required operator action in the
  `Breaking Changes` section.
- If no breaking change exists, write `None`.

## 3. Anti-Patterns

The description body MUST NOT contain:

- **Commit-SHA references or commit-by-commit changelogs.** Describe the final state, not the history.
- **"Originally / now" or "we tried X, then Y" chronology.** The PR is the durable record of what merges, not the path that got there.
- **"Notes from review" or review-history sections.** Review chatter is ephemeral; it does not belong in the permanent record.
- **File-by-file changelogs that just restate the diff.** Group by behavior or subsystem, not by file.
- **Diff restatement.** The description should add context beyond what `gh pr diff` already shows, not re-narrate it.

Unaddressed review feedback belongs in PR review comments anchored to the relevant lines, not in the description body.

## 4. Key Rules

- One PR per issue (keep scope tight)
- Explain rationale and impact, do not restate the diff
- Call out breaking changes explicitly in both title (`!`) and
  `Breaking Changes` section
- Answer the CONTRIBUTING.md PR checklist (schema, snapshots, docs)
