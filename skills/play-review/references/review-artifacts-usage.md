# Review artifacts usage

## Role

Validates, prepares, publishes, and renders `play-review/findings/v2` artifacts.

## Invocation

The helper remains Bash-only. From an established POSIX environment, run
`bash "$PLAY_REVIEW_DIR/scripts/review-artifacts.sh" <operation>`. On native
Windows, resolve Git-for-Windows Bash through the sibling passive runtime and
use the returned executable for the actual operation, not only for `--help`:

```powershell
$PlayReviewDir = "<installed-play-review-skill-bundle>"
$RuntimeBundle = Join-Path (Split-Path $PlayReviewDir) "devcanon-runtime"
$VerifiedBash = node (Join-Path $RuntimeBundle "scripts/resolve-bash.mjs")
if ($LASTEXITCODE -ne 0 -or $VerifiedBash.Count -ne 1) { throw "Git Bash resolution failed" }
$env:HEAD_SHA = "<review-head-sha>"
$env:FINDINGS_FILE = ".ephemeral/<branch>-<review-head-sha>-findings.json"
& $VerifiedBash (Join-Path $PlayReviewDir "scripts/review-artifacts.sh") validate-findings
if ($LASTEXITCODE -ne 0) { throw "validate-findings failed" }

$env:JUDGMENT_REQUIRED_FINDING_INDEXES = "0,2"
& $VerifiedBash (Join-Path $PlayReviewDir "scripts/review-artifacts.sh") prepare-judgment-nits
if ($LASTEXITCODE -ne 0) { throw "prepare-judgment-nits failed" }
```

`<operation>` is exactly one of: `validate-findings`, `validate-nits-file`,
`derive-nits-pending`, `prepare-judgment-nits`, `prepare-findings-write`,
`publish-findings`, `render-review-preview`, or
`build-github-review-payload`.

## Inputs

`validate-findings` requires `HEAD_SHA` and `FINDINGS_FILE`. `validate-nits-file` requires `NITS_FILE`. `derive-nits-pending` requires `HEAD_SHA` and `FINDINGS_FILE`. `prepare-judgment-nits` requires `HEAD_SHA`, `FINDINGS_FILE`, and comma-separated zero-based `JUDGMENT_REQUIRED_FINDING_INDEXES`. `prepare-findings-write` requires `HEAD_SHA`; `FINDINGS_FILE` is optional and otherwise derives from the current branch and head. `publish-findings` requires `HEAD_SHA` and `FINDINGS_FILE`, accepts no extra arguments, and reads exactly one UTF-8 JSON findings envelope from stdin.

`render-review-preview` requires `HEAD_SHA`, `FINDINGS_FILE`, and `REVIEW_SURFACE`; it additionally requires `REVIEW_BODY_FILE` when `REVIEW_SURFACE=pr-review`. `build-github-review-payload` requires `HEAD_SHA`, `FINDINGS_FILE`, `REVIEW_SURFACE=pr-review`, `REVIEW_BODY_FILE`, and `REVIEW_EVENT` (`APPROVE`, `REQUEST_CHANGES`, or `COMMENT`). No other operation reads stdin.

## Working directory

Every operation requires the target repository root. Artifact paths are direct children of a real nonsymlinked `.ephemeral` directory.

## Outputs

Validation commands are silent on success. `derive-nits-pending`, `prepare-judgment-nits`, and `prepare-findings-write` print their repo-relative paths. `publish-findings` prints its canonical findings path. `render-review-preview` emits Markdown; `build-github-review-payload` emits one JSON payload. Diagnostics use stderr and refusals exit nonzero.

## Refusal and failures

The helper rejects unknown commands, bad cwd, missing environment, invalid head or event, malformed envelopes, invalid judgment indexes, unsafe or unreadable paths, stale heads during publication, invalid source anchors, and invalid stdin.

## Side effects

Preparation creates `.ephemeral` and validates targets; `derive-nits-pending`, `prepare-judgment-nits`, and `prepare-findings-write` may unlink an existing target symlink before later work. `prepare-judgment-nits` and `publish-findings` write their artifact, with publication replacing the canonical findings path only after staging and validation. Rendering and validation are read-only.

## Workflow boundary

[Play review workflow context](../SKILL.md) owns command selection, interpretation, and continuation.
