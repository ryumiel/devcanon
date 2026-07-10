# Helper Invocation Contracts Reference

Load this reference when `issue-priming-workflow` needs detailed helper
interfaces, path vocabulary, stdout contracts, or diagnostic lookup material
for its existing helper scripts. `SKILL.md` remains the eager authority for
workflow policy, hard stops, phase order, lifecycle, model selection, review
classification, and PR authority. The helper scripts own deterministic
executable mechanics.

This reference covers only:

- `scripts/phase-artifacts.sh`
- `scripts/write-research-brief.sh`
- `scripts/write-assumptions-comment.sh`

Do not use this reference for Phase 6 auto-handoff behavior. Phase 6 helper
details remain in
[`phase-6-auto-handoff.md`](phase-6-auto-handoff.md).

## Shared Invocation Contract

Resolve `ISSUE_PRIMING_WORKFLOW_DIR` to the installed
`issue-priming-workflow` skill bundle. Invoke helpers from the issue worktree
repository root after Phase 1 has entered `WORKTREE_PATH`.

Any nonzero helper exit is a fatal contract failure for the current phase. The
controller stops the phase and must not fall back to inline path handling.

Scripts own deterministic mechanics:

- repository-root cwd checks
- `.ephemeral` path-shape checks
- suffix and traversal guards
- symlink and file-kind guards
- write-target preparation
- parseable stdout contracts

Workflow prose owns judgment:

- whether a phase should run
- what subagent or skill to invoke
- model selection
- lifecycle cleanup
- review finding classification
- PR handoff authority
- operator escalation and hard stops

## `phase-artifacts.sh`

`scripts/phase-artifacts.sh` validates reads of issue-priming-owned phase
artifacts before the controller or a downstream skill consumes a path.

Command:

```bash
PHASE_ARTIFACTS_HELPER="$ISSUE_PRIMING_WORKFLOW_DIR/scripts/phase-artifacts.sh"
bash "$PHASE_ARTIFACTS_HELPER" validate-read <kind> <repo-relative-path>
```

Inputs:

- `<kind>`: one of `issue-body`, `comment-evidence`, `research`, `design`, or
  `plan`.
- `<repo-relative-path>`: a direct child of `.ephemeral/` with the suffix owned
  by the selected kind.

Suffix vocabulary:

| Kind               | Required suffix        |
| ------------------ | ---------------------- |
| `issue-body`       | `-issue-body.md`       |
| `comment-evidence` | `-comment-evidence.md` |
| `research`         | `-research.md`         |
| `design`           | `-design.md`           |
| `plan`             | `-plan.md`             |

Output:

- Success writes nothing to stdout or stderr.
- Failure writes a diagnostic to stderr and exits nonzero.

Common diagnostics:

| Condition                   | Diagnostic shape                                       |
| --------------------------- | ------------------------------------------------------ |
| Wrong arity or command      | `usage: phase-artifacts.sh validate-read ...`          |
| Unknown kind                | `unknown phase artifact kind: <kind>`                  |
| Not in a Git repository     | `failed to determine git repository root`              |
| Repository root unresolved  | `failed to resolve git repository root`                |
| Cwd is not repository root  | `phase-artifacts.sh must run from the repository root` |
| Nested artifact path        | `nested <label> path rejected: <path>`                 |
| Bad suffix or prefix        | `<label> path validation failed: <path>`               |
| `..` appears in path        | `path traversal: <path>`                               |
| `.ephemeral` is a symlink   | `.ephemeral must be a directory, not a symlink`        |
| Artifact leaf is a symlink  | `<label> must not be a symlink: <path>`                |
| Missing or non-regular file | `<label> missing or not a regular file: <path>`        |
| Missing or unreadable file  | `<label> missing or unreadable: <path>`                |

Labels are `issue body`, `comment evidence`, `research`, `design`, or `plan`.
The script is the authority for exact emitted text and guard ordering; tests
for the helper own low-level stderr and path behavior.

## `write-research-brief.sh`

`scripts/write-research-brief.sh` prepares the Phase 3 research-brief write
target. It does not write the brief content.

Command:

```bash
RESEARCH_BRIEF_PATH=$(
  ISSUE_IDENTIFIER="<payload.identifier>" \
  ISSUE_PRIMING_TODAY="<YYYY-MM-DD>" \
    bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-research-brief.sh"
)
```

Inputs:

- `ISSUE_IDENTIFIER`: required. The helper derives the identifier slug.
- `ISSUE_PRIMING_TODAY`: required, formatted as `YYYY-MM-DD`.

Path shape:

- `.ephemeral/<YYYY-MM-DD>-<id>-research.md`
- `<id>` is derived by lowercasing `ISSUE_IDENTIFIER`, converting `/` to `-`,
  and retaining only alphanumerics, `.`, `_`, and `-`.

Output:

- Success prints only the repo-relative research-brief path on stdout.
- Failure writes a diagnostic to stderr and exits nonzero.

Controller responsibilities:

- Invoke the helper from the issue worktree repository root.
- Treat nonzero exit as a Phase 3 contract failure.
- Write the root-synthesized final brief verbatim to the stdout path. Raw
  internal and external child reports remain agent-local/controller-local and
  are never helper inputs or separately persisted artifacts.
- Emit the literal consumer notice line:
  `Research brief written to <repo-relative-path>.`

Common diagnostics:

| Condition                      | Diagnostic shape                                               |
| ------------------------------ | -------------------------------------------------------------- |
| Missing required input         | `<ENV_NAME> is required`                                       |
| Not in a Git repository        | `failed to determine git repository root`                      |
| Repository root unresolved     | `failed to resolve git repository root`                        |
| Cwd is not repository root     | `write-research-brief.sh must run from the repository root`    |
| Nested research path           | `nested research brief path rejected: <path>`                  |
| Bad suffix, prefix, or date    | `research brief path validation failed: <path>`                |
| `..` appears in path           | `path traversal: <path>`                                       |
| `.ephemeral` is a symlink      | `.ephemeral must be a directory, not a symlink`                |
| Research target is a symlink   | `research brief must not be a symlink: <path>`                 |
| Research target is a directory | `research brief path is a directory: <path>`                   |
| Target exists as non-file      | `research brief path exists but is not a regular file: <path>` |

The helper prepares `.ephemeral/` and validates the target before the
controller writes. The helper is the authority for the exact path computation.

## `write-assumptions-comment.sh`

`scripts/write-assumptions-comment.sh` prepares the Phase 8
assumptions-comment write target. It does not write the comment content or
decide whether assumptions are reviewer-relevant.

Command with derived target:

```bash
ASSUMPTIONS_COMMENT_FILE=$(
  ISSUE_IDENTIFIER="<payload.identifier>" \
    bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-assumptions-comment.sh"
)
```

Command with caller-selected target:

```bash
ASSUMPTIONS_COMMENT_FILE=$(
  ISSUE_IDENTIFIER="<payload.identifier>" \
  ASSUMPTIONS_COMMENT_FILE=".ephemeral/<name>-assumptions-comment.md" \
    bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-assumptions-comment.sh"
)
```

Inputs:

- `ISSUE_IDENTIFIER`: required. Used to derive the default target when
  `ASSUMPTIONS_COMMENT_FILE` is absent.
- `ASSUMPTIONS_COMMENT_FILE`: optional. When present, it must already be a
  repo-relative direct child of `.ephemeral/` ending in
  `-assumptions-comment.md`.

Path shape:

- Default: `.ephemeral/<id>-assumptions-comment.md`
- Caller-selected: `.ephemeral/<name>-assumptions-comment.md`
- `<id>` is derived by lowercasing `ISSUE_IDENTIFIER`, converting `/` to `-`,
  and retaining only alphanumerics, `.`, `_`, and `-`.

Output:

- Success prints only the repo-relative assumptions-comment path on stdout.
- Failure writes a diagnostic to stderr and exits nonzero.

Controller responsibilities:

- Invoke the helper from the issue worktree repository root only when resolved
  auto-mode assumptions need reviewer visibility.
- Treat nonzero exit as a Phase 8 contract failure.
- Write only resolved, reviewer-relevant assumptions to the stdout path.
- Pass the path to `play-branch-finish` as `assumptions_comment_file`.
- Omit `assumptions_comment_file` entirely when there are no assumptions to
  surface.

Common diagnostics:

| Condition                         | Diagnostic shape                                                        |
| --------------------------------- | ----------------------------------------------------------------------- |
| Missing required input            | `<ENV_NAME> is required`                                                |
| Not in a Git repository           | `failed to determine git repository root`                               |
| Repository root unresolved        | `failed to resolve git repository root`                                 |
| Cwd is not repository root        | `write-assumptions-comment.sh must run from the repository root`        |
| Nested assumptions path           | `assumptions_comment_file must be a direct child of .ephemeral: <path>` |
| Bad suffix or prefix              | `assumptions_comment_file path validation failed: <path>`               |
| `..` appears in path              | `path traversal: <path>`                                                |
| `.ephemeral` is a symlink         | `.ephemeral must be a directory, not a symlink`                         |
| Assumptions target is a symlink   | `assumptions comment must not be a symlink: <path>`                     |
| Assumptions target is a directory | `assumptions comment path is a directory: <path>`                       |
| Target exists as non-file         | `assumptions comment path exists but is not a regular file: <path>`     |

The workflow decides which assumptions, if any, are appropriate for reviewers.
The helper only prepares and guards the target path.
