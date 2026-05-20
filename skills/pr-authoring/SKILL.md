---
name: pr-authoring
description: Shared pull request title and body authoring policy for PR creation and pre-merge validation. Use from PR workflow skills that need consistent PR descriptions.
claude:
  user-invocable: false
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# PR Authoring

Author and validate pull request titles and descriptions as final-state durable
records. This skill owns PR title/body policy so PR creation and PR merge
automation do not drift.

Wrappers keep GitHub side effects:

- `play-branch-finish` owns pushing branches, running `gh pr create`, posting
  assumptions comments, posting nits as PR review comments, and preserving the
  branch/worktree after PR creation.
- `pr-merge` owns `gh pr edit`, CI polling, merge, and post-merge cleanup.

## Inputs

Use one of two modes.

### `compose`

Use before creating a PR. The caller provides:

- branch name and base branch;
- issue identifier or `No issue: <reason>` rationale;
- verification evidence for the PR body;
- commit headlines and bodies for the branch range;
- diff file list for the branch range;
- repository PR guideline and PR template content when present.

Return a compliant PR title and body for the caller to pass to `gh pr create`.
Do not create, edit, comment on, merge, or clean up the PR.

### `validate-fix`

Use before polling CI or merging an existing PR. The caller provides:

- PR number;
- current PR title and body;
- commit headlines and bodies from the PR;
- diff file list from the PR;
- repository PR guideline and PR template content when present.

Return `VALID` when the title and body already comply. When they do not comply,
return the repaired title and/or body for the caller to apply with `gh pr edit`.
Do not run `gh pr edit` yourself.

## Guideline Discovery

From the repository root, check for PR authoring policy before composing or
validating:

- `**/pr-guideline*.md`
- `docs/guidelines/pr-guideline.md`
- `.github/pull_request_template.md`
- `CONTRIBUTING.md`
- `WORKFLOW.md`

The PR guideline is the primary policy when present. The GitHub PR template
defines the required body shape when it exists. `CONTRIBUTING.md` and
`WORKFLOW.md` provide supporting policy such as issue linkage and required
verification. If no project-specific guideline or template is found, use
Conventional Commits for the title and an expanded final-state body with
summary, rationale, implementation or behavior changes, impact and risk,
verification, breaking changes, and related issue linkage.

## Validation Dimensions

Validate four dimensions every time:

1. **Title format** — does the title match the project guideline, usually
   `<type>(<scope>): <short summary>` or `<type>: <short summary>`?
2. **Required sections** — does the body contain every section required by the
   guideline or `.github/pull_request_template.md`?
3. **Anti-patterns** — does the body avoid commit SHAs, commit-by-commit
   changelogs, originally/now chronology, review-history sections,
   file-by-file diff restatement, embedded assumptions comments, and embedded
   unaddressed review nits?
4. **Content vs diff** — do the Summary and implementation/behavior sections
   reflect the commit headlines, commit bodies, and diff file list at a
   subsystem level? Flag stale claims about subsystems or files the diff does
   not touch, and flag omitted subsystems the diff plainly modifies.

The content-vs-diff check is intentionally subsystem-level, not file-by-file.
A body can pass without naming every file when it names the affected subsystem
and behavior. A body fails when it promises behavior the diff does not contain
or omits a subsystem the diff clearly changes.

## Composition and Repair Rules

PR descriptions are durable final-state records. Compose or repair sections by
synthesizing behavior and rationale from the commit log, diff file list, issue
context, verification evidence, and repository policy.

Always preserve these guardrails:

- no commit SHAs;
- no commit-by-commit changelogs;
- no originally/now chronology;
- no review-history sections or "notes from review";
- no file-by-file diff restatement;
- no verbatim commit-message paste;
- no assumptions comments in the PR body;
- no unaddressed nits in the PR body.

Assumptions that reviewers need to see belong in top-level PR comments.
Unaddressed review nits belong in PR review comments, inline when anchorable
and top-level review comments otherwise.

## Output Contract

For `compose`, return:

```text
PR title: <title>

PR body:
<body>
```

For `validate-fix`, return one of:

```text
VALID
```

or:

```text
PR title: <fixed title if changed>

PR body:
<fixed body if changed>

Validation failures:
- <dimension>: <short reason>
```

Only include title or body fields that need to be created or changed. Callers
apply side effects.

## Common Mistakes

- Treating `pr-merge` as the only place PR bodies need validation. PR creation
  should start compliant so merge-time repair is rare.
- Putting review or assumption chatter in the durable PR body. Use comments and
  reviews for transient review context.
- Regenerating a body by pasting commit messages. Synthesize subsystem-level
  behavior and impact instead.
- Repeating this policy in consumer skills. Consumers should reference
  `pr-authoring` and keep their own side-effect boundaries.
