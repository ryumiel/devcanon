# Setup worktree usage

## Role

Invokes the native issue-worktree setup adapter.

## Invocation

Run `node "$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.mjs"` with no arguments.

## Inputs

`BRANCH_NAME` and `WORKTREE_LEAF` are required environment values. `BRANCH_NAME` must be a Git-valid, single-line branch name that does not begin with `-`. `WORKTREE_LEAF` must be one safe leaf name: it cannot be absolute, contain `/` or `\\`, contain `..`, begin with `-`, or contain a line break. `BASE_REF` is optional. When absent, after the existing worktree and submodule safety checks, the runtime queries `origin` with `git ls-remote --symref --exit-code origin HEAD`. It requires exactly one advertised symbolic `HEAD` target under `refs/heads/` with a nonempty branch name, then uses the corresponding `origin/<branch>` remote-tracking ref as the base. When supplied, `BASE_REF` must be nonempty, single-line, not begin with `-`, and resolve to a commit; this explicit path does not query the remote default branch. `DEVCANON_RUNTIME_DIR` is an optional runtime diagnostic override. It reads no stdin.

## Working directory

Run from a native host shell in a Git worktree; POSIX/WSL execution against Windows Git metadata is refused.

## Outputs

It emits `MODE=...`, `WORKTREE_PATH=...`, and `MESSAGE=...` on stdout. A valid no-action outcome such as unsupported submodule use returns exit zero with `MODE=stop`; diagnostics use stderr only for command failure.

## Refusal and failures

Missing runtime, invalid setup inputs, or failed worktree setup exits nonzero. If an omitted `BASE_REF` cannot produce one usable advertised symbolic branch target, the runtime refuses before fetching with `Unable to determine origin's default branch:` followed by a specific cause. It does not assume `main` or `master`, use cached remote-tracking refs, or create the requested branch or worktree.

## Side effects

After a valid remote-default discovery for omitted `BASE_REF`, or immediately for a supplied `BASE_REF`, the adapter fetches `origin` before resolving the selected base; this can update remote-tracking state even when a later reuse, stop, or failure route is selected. The discovery query itself is read-only and does not update local remote-head state. Successful setup may additionally create, reuse, or update Git worktree state through the runtime adapter.

## Consumer worktree provisioning and artifact write guards

This section owns the shared mechanics that `github-issue-priming` and
`linear-issue-priming` run around the invocation above: native-first
selection, platform-native fallback invocation, output parsing,
`WORKTREE_PATH` validation, and the `.ephemeral/` artifact path and
write-target guards. The [owning skill](../SKILL.md) keeps the native-first
policy and the `reuse` / `new` / `stop` continuation semantics; each consumer
keeps its provider fetch, artifact naming rule, comment-evidence selection
policy, and the verbatim write itself.

### Native-first selection

Before invoking the fallback helper, apply the owning skill's native-first
policy under its `## Prefer Native Worktree Tooling` heading. If the host
exposes native worktree control, use that surface to create or adopt the
derived worktree, capture its absolute path in `WORKTREE_PATH`, and continue
from the worktree path validation below.

Do not run both the native flow and the fallback helper. If native
worktree control is unavailable, invoke the fallback helper so the
fetched issue body is written inside the correct checkout before
handoff.

On Windows-hosted Codex or PowerShell sessions, do not use Bash or WSL as the
fallback path for worktree provisioning and do not translate `D:\...` or
`D:/...` Git metadata into POSIX paths. Prefer native Codex worktree control; if
native control is unavailable, run the Node helper from native Windows shell
tooling. `scripts/setup-worktree.sh` is a POSIX adapter only. If POSIX or WSL
Git sees Windows-drive `.git` metadata, the helper stops before mutation and the
operator must re-run from native Windows tooling.

### Fallback helper invocation

Use platform-native environment variable and stdout capture around the native
Node helper. POSIX shell example:

```bash
ISSUE_WORKTREE_SETUP_DIR="<issue-worktree-setup-skill-dir>"
HELPER_SCRIPT="$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.mjs"

WORKTREE_SETUP_OUTPUT=$(
  BRANCH_NAME="<branch-name>" \
  WORKTREE_LEAF="<worktree-leaf>" \
  node "$HELPER_SCRIPT"
)
```

PowerShell example:

```powershell
$IssueWorktreeSetupDir = "<issue-worktree-setup-skill-dir>"
$HelperScript = Join-Path $IssueWorktreeSetupDir "scripts/setup-worktree.mjs"

$env:BRANCH_NAME = "<branch-name>"
$env:WORKTREE_LEAF = "<worktree-leaf>"
$WORKTREE_SETUP_OUTPUT = node $HelperScript
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

If you invoked the fallback helper, parse `WORKTREE_SETUP_OUTPUT`
exactly per the `## Outputs` contract above.

- If `MODE=stop`, surface `MESSAGE` and stop before any `.ephemeral/`
  write.
- If `MODE=reuse` or `MODE=new`, continue from `WORKTREE_PATH`.
- If the helper exits non-zero, stop immediately instead of attempting to
  parse partial output.

### Worktree path validation

Once `WORKTREE_PATH` is available — either from native tooling or the
fallback helper — validate it before any write. It must be nonempty,
absolute according to the host platform, and name an existing searchable
directory. POSIX shell example:

```bash
[ -n "$WORKTREE_PATH" ] || { echo "worktree path missing" >&2; exit 1; }
case "$WORKTREE_PATH" in
  /*) ;;
  *) echo "worktree path must be absolute: $WORKTREE_PATH" >&2; exit 1 ;;
esac
[ -d "$WORKTREE_PATH" ] || { echo "worktree missing or unreadable: $WORKTREE_PATH" >&2; exit 1; }
[ -x "$WORKTREE_PATH" ] || { echo "worktree not searchable: $WORKTREE_PATH" >&2; exit 1; }
```

PowerShell example:

```powershell
if ([string]::IsNullOrWhiteSpace($WORKTREE_PATH)) { throw "worktree path missing" }
if (-not [System.IO.Path]::IsPathFullyQualified($WORKTREE_PATH)) { throw "worktree path must be absolute: $WORKTREE_PATH" }
if (-not (Test-Path -LiteralPath $WORKTREE_PATH -PathType Container)) { throw "worktree missing or unreadable: $WORKTREE_PATH" }
try { Get-ChildItem -LiteralPath $WORKTREE_PATH -Force -ErrorAction Stop | Out-Null } catch { throw "worktree not searchable: $WORKTREE_PATH" }
```

### Artifact write guards

Consumers write up to two repo-relative artifacts inside `WORKTREE_PATH`:
the issue body at `.ephemeral/<YYYY-MM-DD>-<id>-issue-body.md`
(`ISSUE_BODY_PATH`) and, only when substantive comment evidence exists, the
comment evidence at `.ephemeral/<YYYY-MM-DD>-<id>-comment-evidence.md`
(`COMMENT_EVIDENCE_PATH`). The consumer derives `<id>` from its provider's
identifier rule. For each artifact, validate the repo-relative path, then
apply the write-target guard, then write. Both guards share one shape and
differ only in the path variable and the `-issue-body.md` /
`-comment-evidence.md` suffix; the two worked examples follow. Unsafe
artifact paths fail before write.

### Issue-body guard example

Validate the repo-relative path before writing. POSIX shell example:

```bash
case "$ISSUE_BODY_PATH" in
  .ephemeral/*/*) echo "nested issue body path rejected: $ISSUE_BODY_PATH" >&2; exit 1 ;;
  .ephemeral/*-issue-body.md) ;;
  *) echo "issue body path validation failed: $ISSUE_BODY_PATH" >&2; exit 1 ;;
esac
[ "${ISSUE_BODY_PATH#*..}" = "$ISSUE_BODY_PATH" ] || { echo "path traversal: $ISSUE_BODY_PATH" >&2; exit 1; }
```

PowerShell example:

```powershell
if ($ISSUE_BODY_PATH -notmatch '^\.ephemeral/[^/\\]+-issue-body\.md$') { throw "issue body path validation failed: $ISSUE_BODY_PATH" }
if ($ISSUE_BODY_PATH.Contains("..")) { throw "path traversal: $ISSUE_BODY_PATH" }
```

Apply the write-target guard before the write. POSIX shell example:

```bash
[ -L "$WORKTREE_PATH/.ephemeral" ] && rm "$WORKTREE_PATH/.ephemeral"
mkdir -p "$WORKTREE_PATH/.ephemeral"
[ -L "$WORKTREE_PATH/$ISSUE_BODY_PATH" ] && rm "$WORKTREE_PATH/$ISSUE_BODY_PATH"
[ ! -d "$WORKTREE_PATH/$ISSUE_BODY_PATH" ] || { echo "issue body path is a directory: $WORKTREE_PATH/$ISSUE_BODY_PATH" >&2; exit 1; }
[ ! -e "$WORKTREE_PATH/$ISSUE_BODY_PATH" ] || [ -f "$WORKTREE_PATH/$ISSUE_BODY_PATH" ] || { echo "issue body path exists but is not a regular file: $WORKTREE_PATH/$ISSUE_BODY_PATH" >&2; exit 1; }
```

PowerShell example:

```powershell
$EphemeralDir = Join-Path $WORKTREE_PATH ".ephemeral"
$EphemeralItem = Get-Item -LiteralPath $EphemeralDir -Force -ErrorAction SilentlyContinue
if ($EphemeralItem -and (($EphemeralItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { Remove-Item -LiteralPath $EphemeralDir }
New-Item -ItemType Directory -Force -Path $EphemeralDir | Out-Null
$IssueBodyFullPath = Join-Path $WORKTREE_PATH ($ISSUE_BODY_PATH -replace '/', [System.IO.Path]::DirectorySeparatorChar)
$IssueBodyItem = Get-Item -LiteralPath $IssueBodyFullPath -Force -ErrorAction SilentlyContinue
if ($IssueBodyItem -and (($IssueBodyItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { Remove-Item -LiteralPath $IssueBodyFullPath; $IssueBodyItem = $null }
if ($IssueBodyItem -and $IssueBodyItem.PSIsContainer) { throw "issue body path is a directory: $IssueBodyFullPath" }
if ($IssueBodyItem -and -not ($IssueBodyItem -is [System.IO.FileInfo])) { throw "issue body path exists but is not a regular file: $IssueBodyFullPath" }
```

### Comment-evidence guard example

Validate the repo-relative path before writing. POSIX shell example:

```bash
case "$COMMENT_EVIDENCE_PATH" in
  .ephemeral/*/*) echo "nested comment evidence path rejected: $COMMENT_EVIDENCE_PATH" >&2; exit 1 ;;
  .ephemeral/*-comment-evidence.md) ;;
  *) echo "comment evidence path validation failed: $COMMENT_EVIDENCE_PATH" >&2; exit 1 ;;
esac
[ "${COMMENT_EVIDENCE_PATH#*..}" = "$COMMENT_EVIDENCE_PATH" ] || { echo "path traversal: $COMMENT_EVIDENCE_PATH" >&2; exit 1; }
```

PowerShell example:

```powershell
if ($COMMENT_EVIDENCE_PATH -notmatch '^\.ephemeral/[^/\\]+-comment-evidence\.md$') { throw "comment evidence path validation failed: $COMMENT_EVIDENCE_PATH" }
if ($COMMENT_EVIDENCE_PATH.Contains("..")) { throw "path traversal: $COMMENT_EVIDENCE_PATH" }
```

Apply the write-target guard before the write. POSIX shell example:

```bash
[ -L "$WORKTREE_PATH/.ephemeral" ] && rm "$WORKTREE_PATH/.ephemeral"
mkdir -p "$WORKTREE_PATH/.ephemeral"
[ -L "$WORKTREE_PATH/$COMMENT_EVIDENCE_PATH" ] && rm "$WORKTREE_PATH/$COMMENT_EVIDENCE_PATH"
[ ! -d "$WORKTREE_PATH/$COMMENT_EVIDENCE_PATH" ] || { echo "comment evidence path is a directory: $WORKTREE_PATH/$COMMENT_EVIDENCE_PATH" >&2; exit 1; }
[ ! -e "$WORKTREE_PATH/$COMMENT_EVIDENCE_PATH" ] || [ -f "$WORKTREE_PATH/$COMMENT_EVIDENCE_PATH" ] || { echo "comment evidence path exists but is not a regular file: $WORKTREE_PATH/$COMMENT_EVIDENCE_PATH" >&2; exit 1; }
```

PowerShell example:

```powershell
$EphemeralDir = Join-Path $WORKTREE_PATH ".ephemeral"
$EphemeralItem = Get-Item -LiteralPath $EphemeralDir -Force -ErrorAction SilentlyContinue
if ($EphemeralItem -and (($EphemeralItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { Remove-Item -LiteralPath $EphemeralDir }
New-Item -ItemType Directory -Force -Path $EphemeralDir | Out-Null
$CommentEvidenceFullPath = Join-Path $WORKTREE_PATH ($COMMENT_EVIDENCE_PATH -replace '/', [System.IO.Path]::DirectorySeparatorChar)
$CommentEvidenceItem = Get-Item -LiteralPath $CommentEvidenceFullPath -Force -ErrorAction SilentlyContinue
if ($CommentEvidenceItem -and (($CommentEvidenceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { Remove-Item -LiteralPath $CommentEvidenceFullPath; $CommentEvidenceItem = $null }
if ($CommentEvidenceItem -and $CommentEvidenceItem.PSIsContainer) { throw "comment evidence path is a directory: $CommentEvidenceFullPath" }
if ($CommentEvidenceItem -and -not ($CommentEvidenceItem -is [System.IO.FileInfo])) { throw "comment evidence path exists but is not a regular file: $CommentEvidenceFullPath" }
```

## Workflow boundary

[Issue worktree setup workflow context](../SKILL.md) owns result continuation.
