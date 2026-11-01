# Git workspace cleanup usage

## Role

Performs the deterministic cleanup operation for a selected Git repository.

## Invocation

Run `bash "$SKILL_DIR/scripts/git-workspace-cleanup.sh" [--repo <path>] [--dry-run|--execute] [--retain-worktree <path>] [--retain-branch <name>] [--disposable-dir <relative-directory>] [--disposable-file <relative-file>] [--force-branches] [--force-dirty-worktrees]`.

Retention and disposable-path arguments may repeat. The caller establishes
completed-session disposal authority, active dependencies, unresolved removal effects and
explicit retention before invocation. Retained paths are canonicalized; used
branches are retained with their worktree. Record the concrete caller reason and
release condition alongside the command. Host refusals do not hold unrelated
cleanup. `.ephemeral` is the default disposable directory; additional designations
must be safe relative paths, never absolute paths, parent traversals or `.git`.
`--disposable-dir` designates a physical directory; `--disposable-file` designates
only an exact regular-file leaf with physical parent directories, not symlinks
or siblings. Establish generated-output disposability from the owning workflow
or repository guidance under retained cleanup authority, not from its name.
Ignoring a file does not itself authorize deletion. Nested Git guards still apply
inside disposable directories, and arbitrary ignored content retains its checkout.
Ignored paths are inspected as a NUL-separated stream, so large generated inventories
do not require an aggregate output buffer. Subprocess or stream failures block
inspection rather than establish cleanup eligibility.

### Selected local cleanup

```bash
bash "$SKILL_DIR/scripts/git-workspace-cleanup.sh" --repo "$TARGET_REPO" \
  --worktree "$TARGET_WORKTREE" --branch "$TARGET_BRANCH" \
  --expected-head "$EXPECTED_HEAD" --dry-run
```

Use the same inputs with `--execute` after the workflow validates disposal
and reconciles any pending/unknown removal effect. Any of `--worktree`, `--branch`, or
`--expected-head` selects targeted mode: all three and an explicit `--repo`
are required in paired mode. Two additional explicit selectors are supported:

```bash
bash "$SKILL_DIR/scripts/git-workspace-cleanup.sh" --repo "$TARGET_REPO" \
  --detached --worktree "$TARGET_WORKTREE" --expected-head "$EXPECTED_HEAD" --dry-run
bash "$SKILL_DIR/scripts/git-workspace-cleanup.sh" --repo "$TARGET_REPO" \
  --branch-only --branch "$TARGET_BRANCH" --expected-head "$EXPECTED_HEAD" --dry-run
```

Detached mode omits `--branch` and requires a detached target; branch-only mode
omits `--worktree`. Neither permits incomplete inputs, retention overrides or
broad force flags. `--disposable-dir` and `--disposable-file` are supported for targeted checkouts.
An unselected resource reports `skipped` with `not-selected`. All selected commit
tips need ancestry or squash-equivalence to the remote default branch. Squash
inspection is read-only, without synthetic commit writes.

The branch is a local short name and expected HEAD is its full
commit SHA. Partial inputs, invalid identities and broad force flags are rejected;
there is no fallback to repository-wide cleanup. Resolve the expected commit
from retained delivery evidence, not a changed branch at cleanup time.
The repository must have a locally resolvable origin default branch; no fetch is
performed to discover it. Targeted inspection uses Git's `--no-lazy-fetch`
to prevent implicit promisor downloads; Git versions without that option refuse
the operation. Missing expected objects fail locally. Run from outside the selected checkout and use a
surviving repository checkout for `--repo`.

Targeted dry-run performs no writes, fetch or prune. Execute removes only the
selected eligible checkout and local ref. It never updates the base checkout,
prunes registrations, deletes remote branches or reconciles host metadata.
Primary, locked, dirty, mismatched and default/base branch targets are retained.
The shared nested guards below still apply; eligible initialized submodules
use guarded `--force` automatically, with no dirty-work override.

Targeted output includes `MODE`, `SCOPE=targeted`, `STATUS=ok|blocked`,
`WORKTREE`, `BRANCH`, `EXPECTED_HEAD`, and independent `WORKTREE_STATUS` /
`BRANCH_STATUS` plus `WORKTREE_REASON` / `BRANCH_REASON`.
Resource statuses are `eligible` (dry-run), `removed`, `already-absent`,
`retained`, `failed` or `skipped`. Reasons describe verified absence, identity/protection
blockers or operation failures. Dry-run exits zero for inspected blocked plans;
execute exits 1 for retained/failed resources; invalid inputs exit 2.

Both directory and registration must be absent before branch deletion. A retry
uses the same inputs, including when the checkout's parent directories are gone,
and removes only a still-matching unused local ref;
changed refs, replacement checkouts and stale registrations remain protected.
Ref deletion compares the expected SHA atomically. Existing branch configuration
is left unchanged. A failed branch deletion does not erase a verified worktree
removal result. Reconcile pending/unknown removal or identity/protection effects before invoking
a retry. Attachment-only metadata reconciliation does not hold the Git retry.

### Windows PowerShell to Bash

Choose the route for the Bash environment you will actually use. Convert both
the wrapper path and target repository path before invoking the helper. If the
named converter is unavailable, stop and install or select that Bash
environment; do not guess a POSIX path.

For Git Bash or MSYS2, launch that environment from PowerShell and pass both
Windows paths as positional arguments before converting them with `cygpath -u`:

```powershell
bash -lc 'command -v cygpath >/dev/null 2>&1 || { printf "%s\n" "cygpath is required; use Git Bash or MSYS2." >&2; exit 1; }; skill_dir="$(cygpath -u "$1")" || exit 1; target_repo="$(cygpath -u "$2")" || exit 1; bash "$skill_dir/scripts/git-workspace-cleanup.sh" --repo "$target_repo" --dry-run' -- "$SKILL_DIR" "$TARGET_REPO"
```

For WSL, invoke through `wsl.exe` and convert both paths with `wslpath` inside
that environment:

```powershell
wsl.exe bash -lc 'command -v wslpath >/dev/null 2>&1 || { printf "%s\n" "wslpath is required; use a WSL environment that provides it." >&2; exit 1; }; skill_dir="$(wslpath "$1")" || exit 1; target_repo="$(wslpath "$2")" || exit 1; bash "$skill_dir/scripts/git-workspace-cleanup.sh" --repo "$target_repo" --dry-run' -- "$SKILL_DIR" "$TARGET_REPO"
```

These path forms are environment-specific; do not substitute a Git Bash/MSYS2
path into WSL or the reverse. After the required dry-run, retain the approval
and force-flag rules from the workflow before changing `--dry-run` to
`--execute`.

## Inputs

For repository-wide mode, `--repo <path>` is optional and defaults to the current directory. `--dry-run` is the default mode; `--execute` enables cleanup. `--force-branches` and `--force-dirty-worktrees` are optional execute-mode overrides. It reads no stdin.

## Working directory

The caller may invoke it from any directory; `--repo` identifies the target.

## Outputs

It reports planned or completed cleanup outcomes on stdout and diagnostics on stderr.

## Refusal and failures

Unknown or incomplete flags, a non-worktree or bare repository, or a missing remote default branch exits nonzero. A completed dry run exits zero and reports `STATUS=ok` or `STATUS=blocked` according to the collected facts. Execute mode exits nonzero when those facts are blocked.

## Side effects

In repository-wide mode, `--dry-run` fetches `origin --prune` before reporting.
`--execute` removes eligible worktrees and branches independently, and updates
the default checkout only when its guards pass. Retention/failure of one resource
does not stop unrelated eligible work; branches in surviving registrations stay.
Unavailable registrations are retained, not pruned. Execution does not fetch again.
`WORKTREE_RESULT=<path>|STATUS=<status>|REASON=<reason>` and `BRANCH_RESULT` name
actual outcomes; `BASE_UPDATE`/`BASE_UPDATE_REASON` describe the base operation.
Candidate/eligible counts are inspection counts, never proof of deletion.
A partial execution exits 1 even when some resources were removed successfully.
Dry-run is not mutation-free; selected-target dry-run remains read-only.

## Workflow boundary

[Git workspace cleanup workflow context](../SKILL.md) owns authorization and result handling.

## Mechanism selection and verification

Worktree removal and recoverable archival are distinct outcomes. Delivery does
not by itself prove all local work disposable. Check retained authorization,
exact worktree ownership/scope, dirty and local-only work, and required artifacts
before selecting a mechanism. Preserve user-selected ordering between cleanup,
chat archival, milestone closure and watchdog shutdown; do not impose an
incident-specific sequence on other workflows. For completed batch owners,
[post-delivery lifecycle reconciliation](../../issue-batch-routing/SKILL.md#post-delivery-lifecycle-reconciliation)
defaults to evidence/responsibility transfer, chat archival, reconciliation of
any issued removal effect, selected checkout removal, then selected local branch
deletion. Archival can itself remove the checkout; inspect its effect before Git
cleanup. Host attachment reconciliation is tracked separately.

- Ordinary repository-wide cleanup uses this helper under its approval policy.
  Selected PR cleanup remains with `pr-merge`; completed-owner local-only cleanup
  uses explicit-target mode. Review sessions use their completed-session adapter
  or an explicit detached target after completion and retention checks.
- For completed host-managed checkouts, supported archival may be selected when
  recoverability is required. Otherwise, scoped Git removal is eligible under
  retained disposal authority after the owner releases active consumers and
  guards establish the exact path, expected HEAD, registration and local branch.
  Unsupported archive capabilities (including initialized submodules), stale
  attachments, or a host's task-primary label alone do not prohibit Git removal.
  Git's actual primary checkout, locks, active work and explicit retention remain
  protected. A mandatory higher-priority host instruction still applies; do not
  infer such a mandate merely from attachment existence or archive-tool limits.
- Reconcile an issued pending or unknown archive/removal operation before another
  removal mechanism acts on that checkout. A known unsupported precondition with
  no invocation, or a confirmed terminal refusal, is not an unresolved effect.
  Classify the refusal: an active consumer or explicit protection still retains
  the resource; an unsupported archive capability permits fresh Git guards.
- After Git removal, report filesystem absence and Git registration absence
  separately from local/remote branch disposition, chat archival and host
  metadata. Record unreconciled attachments with their exact identity and a
  supported follow-up owner/action; do not claim they were removed. This residual
  obligation does not veto completed Git cleanup. Do not edit app databases,
  invoke private APIs, or fabricate host reconciliation. Retry only on a relevant
  state/capability change, not repeated unchanged observations.

A snapshot or archived chat proves neither checkout nor branch deletion. Execute
from a surviving checkout outside the selected target, never an active consumer's
working directory. No app-side snapshot is implied by direct Git disposal.

### Nested repository classifications

The runtime scans checkout directories, including ignored directories, without
following symlinks or traversing Git administration. Gitlinks distinguish
registered submodules from embedded repositories; nested submodules are inspected
recursively. Diagnostics resolve actual Git and common directories. A clean
initialized submodule is eligible only when administration is private beneath
this checkout's Git `modules` directory, the submodule has no other linked
worktree registrations, its working tree has no modified, untracked or ignored files, and all refs,
HEAD and reflog commits are covered by existing remote-tracking refs. This uses
local remote-tracking evidence and does not verify remote availability anew.
An unresolved inspection fails closed.

`dirty-or-untracked-submodule` requires preserving or disposing that named work,
including ignored submodule artifacts. Unlike ordinary ignored superproject
files, these artifacts are protected before the helper enables Git's submodule-removal force;
`submodule-local-only-work` requires preserving/publishing its commits, refs or
reflog work. Neither existing broad force flag discards nested work.
`shared-submodule-worktrees` requires preserving/releasing the submodule's other
registered checkouts before retry; cleanup never removes their administration.
`shared-or-external-submodule-git-dir` requires the repository owner to establish
checkout-private custody through a supported Git procedure before retry.
`embedded-repository` requires its own disposition/preservation and removal
under that repository's authority before retry; it is not a submodule. Never
change shared submodule configuration merely to remove one checkout.
`uninitialized-submodule-administration` identifies cached Git custody without an
initialized checkout; preserve its refs/reflogs or restore the checkout for full
inspection before retry. An empty submodule directory is not proof of no work.
`nested-repository-inspection-failed` requires resolving that repository's Git
metadata before retry. Re-run guards after the remedy. Preserve the primary and
unrelated linked checkouts; verify targeted checkout and registration removal.

### Accepted asynchronous requests

For `queued`, retain the exact operation/resource identity, host/owner binding,
and observed acceptance in existing pending-effect fields. Acceptance is not a
terminal result. Use a supported terminal result or bounded authoritative
reconciliation of filesystem, Git registration and host metadata. Record the
observed outcome as pending (positive evidence of active execution), removed,
retained/protected, unsupported, failed, or unknown. A remaining directory or
restored attachment alone proves neither continued execution nor refusal;
absence of immediate completion proves neither failure nor a stuck queue.

A supported refusal with its reason establishes unsupported or retained status;
clear obsolete queue claims and replace the blocker. When terminal feedback is
unavailable, keep the execution outcome unknown, name the missing supported
result, and stop bounded observation. A known archive precondition restriction
can explain why archival is unsupported without claiming a historical terminal
refusal. After a terminal refusal, classify guarded Git removal independently;
attachment restoration alone does not establish an active consumer. Do not inspect undocumented app state or minified bundles in
production workflows. Never retry an unresolved effect. A confirmed terminal
refusal may be retried after an authorized remedy and fresh guards. Separate
verified effects from unresolved ones; only dependent actions wait.

Supported host tools own terminal archive outcomes and attachment reconciliation.
DevCanon cannot supply those capabilities, but completed Git cleanup does not
wait for attachment reconciliation when no competing removal effect remains.
