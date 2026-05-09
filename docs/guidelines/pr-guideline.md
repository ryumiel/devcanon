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

- **Summary**: 1-3 bullet points describing main outcomes. Summarize by behavior or subsystem, NOT file-by-file.
- **Why**: The problem this PR solves. What was broken, missing, or inadequate.
- **Changes**: One bullet per major behavior change. Group by subsystem (`render`, `install`, `validate`, etc.), not by file. Do not duplicate the diff.
- **Impact**: Four sub-items to evaluate:
  - User-facing impact (CLI output, installed files, behavior changes)
  - Schema impact (config format, skill/agent source format changes)
  - Performance impact (if relevant)
  - Breaking changes (list or "None")
- **Testing**: Checklist of verification performed:
  - `pnpm run check` passes
  - Unit/integration tests added or updated
  - Manual testing performed (describe what was tested)
- **Related Issues**: `Closes #N` or `Related to #N`

**Permitted exceptions to the items above** (forward-looking content, not logbook):

- **Blocking findings the auto-fix declined** — current state the reviewer needs to weigh, not historical chatter.

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
- Call out breaking changes explicitly in both title (`!`) and Impact section
- Answer the CONTRIBUTING.md PR checklist (schema, snapshots, docs)
