# ADR-0014: Implementer DONE-Report Content Snapshot Contract

## Status

Accepted

## Context

ADR-0012 moved `play-review`'s findings off-conversation by writing a
`play-review/findings/v1` envelope to a deterministic `.ephemeral/`
path; ADR-0013 generalized the same pattern upstream for research
briefs, designs, and plans. The four hops it covers all flow from a
producer skill to a consumer skill across `--auto`'s pipeline.

One hop the substrate does not yet cover is the per-task implementer
DONE report. After `play-subagent-execution` dispatches an
`implementer` subagent and receives a DONE report, the controller
typically re-reads the file(s) the implementer touched to:

- Verify the commit landed correctly.
- Extract line numbers for downstream review or commit composition.
- Confirm content matches the spec.

In multi-task plans where the effective route includes per-task reviewers,
the controller's re-read pressure is highest because line ranges feed the
spec-compliance and, for `spec-and-quality`, code-quality reviewer
dispatches. ADR-0018 later permits reduced routes where line ranges may feed
only spec review, or no per-task reviewer at all when the final whole-diff
gate independently reviews the full branch diff. Each re-read pulls full file
content into the controller's context. The observed failure mode was a
medium-sized ADR being re-read across post-commit verification, review
composition, and nit-fixing steps.

A naive fix — embed the file content in the DONE report — collides
with `skills/play-subagent-execution/references/spec-reviewer-prompt.md`
§ "CRITICAL: Do Not Trust the Report", which mandates that reviewers
read the actual code from disk and **NOT** trust any artifact the
implementer hands over. The same rule covers
`code-quality-reviewer-prompt.md`. A snapshot is exactly the kind of
artifact that rule says to ignore — for reviewers.

The trust boundary distinguishes two read paths:

1. **Verification reads** (controller confirms the implementer's
   claim, post-commit) — fine to use a snapshot. The controller is
   checking work, not independently re-deriving truth.
2. **Independent-review reads** (spec-compliance, code-quality,
   `branch-review`'s review agents) — must continue to read from
   disk. The whole point is independence from the implementer's
   framing.

A separate concern: the lean mechanical implementer path and the
skip-dispatch path for trivial single-task plans interact. The lean
mechanical path still dispatches an implementer; the skip-dispatch path
does not — the plan body is itself the snapshot in that path. Any
contract introduced here must explicitly exclude the skip-dispatch path.

## Decision

Implementer snapshot manifests are **trigger-based**, not mandatory for every
dispatched implementer. ADR-0014 is the policy authority for when snapshots are
part of the DONE-report contract. `play-subagent-execution` owns execution-time
classification and request/skip decisions; the implementer follows the request
state it receives in the assembled prompt contract. Plan text may contain
snapshot hints, but those hints are advisory and non-authoritative.

When `play-subagent-execution` classifies a dispatched task, it requests a
snapshot for:

- Durable ADR, behavior-spec, product-requirements, roadmap, or
  workflow-policy updates.
- Source-owned policy, procedure, prompt contract, generated-output behavior,
  manifest, executable helper, config, or tests guarding those surfaces.
- Failure-routing or incident-boundary changes where downstream consumers need
  precise post-DONE evidence.
- Prompt contract implications, including changes that affect implementer,
  reviewer, or controller handoff behavior.
- Broad, multi-file, cross-module, or cross-skill tasks; deletes, renames, or
  file-mode changes.
- Any explicit controller request for audit or review coordination.
- Any unclear classification.

Unclear cases fail closed to the higher-assurance path: request a snapshot. Low
risk localized tasks do not require a snapshot when the controller can rely on
the default DONE fields plus disk/git fallback. When no snapshot is requested,
the DONE report must still include status, summary, tests, files changed, base
SHA, and head SHA; concerns may be included as usual.

If a snapshot was requested, a missing, unreadable, malformed, or mismatched
snapshot is an incident and the controller records that disposition before
falling back to its own changed-file list and committed `HEAD:<path>` blob reads.
If no snapshot was requested, absence of the literal snapshot notice is valid
and is not an incident. An emitted snapshot remains an optimization, never
reviewer evidence.

The affected consumers are `play-subagent-execution`, implementer prompt
templates, and rendered Codex/Claude skill outputs generated from those sources.

### Producer (implementer, when requested)

When the controller requests a snapshot, after the implementer commits its work
and before reporting, it writes a side-channel snapshot manifest. The path:

```text
.ephemeral/snapshot-<head_sha>.json
```

- `<head_sha>` — full 40-character lowercase hex from
  `git rev-parse HEAD` post-commit. Regex `^[0-9a-f]{40}$`.

Detailed producer-side construction instructions live in the canonical
snapshot-manifest recipe under
`skills/play-subagent-execution/references/snapshot-manifest-recipe.md`, while
the executable construction procedure lives in
`skills/play-subagent-execution/scripts/write-snapshot-manifest.sh`. The
controller supplies both a readable recipe path and a readable helper script path
with each snapshot-requesting implementer dispatch, and the implementer prompts
carry a compact conditional-use contract while preserving the same notice line
for requested snapshots and the same fallback contract.

The helper has a hard runtime prerequisite on `jq`. If `jq` is unavailable, the
helper exits nonzero and the implementer reports `BLOCKED` rather than
hand-rolling JSON assembly. This is accepted because the helper is now the
authority for executable snapshot behavior, and byte-faithful JSON construction
is part of that behavior.

Authority model: this ADR is authoritative for policy intent, trigger
conditions, and accepted behavior changes; `play-subagent-execution` is the
execution-policy owner for classification and request/skip propagation; the
helper script is authoritative for executable snapshot construction behavior;
the recipe is authoritative for implementer-facing operating instructions; and
prompt text is only the compact handoff to those sources. If these surfaces
conflict, update the lower-authority surface to match this ADR's policy intent
and the helper's executable behavior.

The snapshot path shares `play-review`'s post-commit `head_sha` anchor, not its
full findings-file path scheme. ADR-0013 explicitly noted that brainstorm/plan
artifacts cannot use commit-derived artifact names because they precede commits;
the implementer is in a different position.

Per-commit `head_sha` guarantees uniqueness, so no `task<N>` segment
is needed in the path. Re-dispatched tasks produce new commits → new
SHAs → new files. Stale snapshots remain on disk until worktree
teardown (consistent with ADR-0012 cleanup).

### Snapshot envelope (`implementer/snapshot/v1`)

```json
{
  "schema": "implementer/snapshot/v1",
  "task_id": "Task 3",
  "head_sha": "0123456789abcdef0123456789abcdef01234567",
  "files": [
    {
      "path": "docs/adr/adr-0007-review-pipeline-delineation.md",
      "status": "added",
      "lines": 167,
      "bytes": 5021,
      "sha256": "<hex>",
      "content": "<verbatim file content>"
    },
    {
      "path": "docs/specs/old-spec.md",
      "status": "deleted",
      "lines": 0,
      "bytes": 0,
      "sha256": ""
    }
  ]
}
```

Per-field contract:

| Field      | Type                                       | Notes                                                                                                                                                                                                   |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`   | string literal `"implementer/snapshot/v1"` | Pinned. Additive changes stay on `v1`; renames/type changes require `v2`.                                                                                                                               |
| `task_id`  | string                                     | Free-form task identifier from the plan task header (e.g., `"Task 3"`). Provenance only.                                                                                                                |
| `head_sha` | string                                     | Post-commit SHA, full 40-char lowercase hex (`^[0-9a-f]{40}$`).                                                                                                                                         |
| `files`    | array                                      | One object per file the implementer added, modified, or deleted for this task.                                                                                                                          |
| `path`     | string, repo-relative                      | Path of the added, modified, or deleted file.                                                                                                                                                           |
| `status`   | `"added"` \| `"modified"` \| `"deleted"`   | Mirrors NUL-delimited `git diff -z --name-status --no-renames` letters mapped to words: `A`->`added`, `M`->`modified`, `D`->`deleted`. Unsupported status letters such as `T` route to `BLOCKED`.       |
| `lines`    | integer                                    | Visible line count of the committed `HEAD:<path>` blob. Equals `wc -l` for newline-terminated files and is one greater than `wc -l` for files lacking a trailing newline. For deleted files, `0`.       |
| `bytes`    | integer                                    | Byte count of the committed `HEAD:<path>` blob. For deleted files, `0`.                                                                                                                                 |
| `sha256`   | string, hex                                | SHA-256 of the committed `HEAD:<path>` blob. For deleted files, `""`.                                                                                                                                   |
| `content`  | string OR omitted                          | Verbatim committed `HEAD:<path>` blob content. Present when `bytes <= 64_000`, `status != "deleted"`, the file is not Git-binary, and the blob round-trips byte-for-byte through JSON string transport. |
| `skipped`  | string OR omitted                          | When `content` is omitted on a non-deleted file, the reason (`"size>64KB"` or `"binary"`).                                                                                                              |

Mutual exclusion: exactly one of `content` or `skipped` is present
per file, except when `status == "deleted"` (both omitted; the
consumer infers `deleted` semantics from `status`).

The `files` array MUST NOT be empty: a DONE report implies at least
one commit landed between `BASE_SHA` and `HEAD`. If the implementer
made no changes, it reports BLOCKED instead of writing a snapshot.

Changed path strings must round-trip byte-for-byte through `jq --arg`
and `jq -rj '@base64'` JSON string transport before the producer emits
them into the snapshot. Non-deleted non-regular paths from committed
`HEAD` tree metadata and symlinked working-tree parent components route
to `BLOCKED` before the producer reads line count, byte count, hash, or
content. For ordinary files, the helper reads bytes from the committed
`HEAD:<path>` blob so the snapshot cannot diverge from the `head_sha` it
reports if the working tree changes after commit.
This is an intentional v1 helper behavior change from the older
prompt-embedded shell sketch, which read working-tree paths. The change
blocks non-deleted symlinks, gitlinks, and other non-regular entries
instead of following them and snapshots committed blob bytes rather than
any post-commit working-tree bytes that may differ because of filters,
Git LFS pointer expansion, line-ending normalization, or other checkout
transformations.

Files reported by `git diff --numstat --no-renames` as binary
(`-\t-\t<path>`) emit `"skipped": "binary"`. Files that Git reports as
text but that do not round-trip byte-for-byte through `jq --rawfile`
and `jq -rj '@base64'` comparison also emit `"skipped": "binary"`
because JSON string transport would not be byte-faithful. Skip
precedence is fixed:
Git-reported binary files emit `"skipped": "binary"` first; non-binary
files over 64 KB emit `"skipped": "size>64KB"` before JSON transport
validation; non-binary files at or under 64 KB that fail byte-faithful
JSON transport emit `"skipped": "binary"`. Deletion dominates binary
detection: when `status == "deleted"`, the file emits neither
`content` nor `skipped`, even if numstat reports the path as binary.

### Notice line

After writing a requested snapshot file, the implementer appends exactly one
literal line to its DONE report:

```
Snapshot written to <repo-relative-path>.
```

The notice line is the controller's contract surface. The existing
`Files changed` bullet stays — it is human-scannable and
non-redundant with the structured notice. The implementer reports
`BLOCKED` if the snapshot write fails — never emit the notice line
for an absent file. The producer fails loud for requested snapshots; the
consumer's fallback (next subsection) covers downstream consumers that encounter
a missing or corrupt requested snapshot. When no snapshot was requested, the
implementer does not run the helper and does not emit the notice line.

### Size threshold (64 KB)

The snapshot contract uses a 64 KB byte threshold, specified by the canonical
snapshot-manifest recipe and enforced by the helper script that the controller
supplies with each snapshot-requesting implementer dispatch.

- A byte threshold (vs. line threshold) is uniform across file types
  and avoids gaming via long lines.
- 64 KB clears the current largest Markdown skill and reference files in
  this repo with comfortable headroom for JSON-encoding overhead and
  future growth. ADRs are smaller still (~6–15 KB each).
- Per-file skip with a recorded reason lets the controller fall back
  to a committed HEAD blob read for that one file rather than disabling
  the whole snapshot.
- Configurability is YAGNI for v1.

### Consumer (controller in `play-subagent-execution`)

After the implementer reports DONE (or DONE_WITH_CONCERNS), the controller
first consults its recorded request state:

- `requested`: the report is expected to include the literal
  `Snapshot written to <repo-relative-path>.` line. Missing, unreadable,
  malformed, or mismatched snapshots are incidents; the controller records the
  incident and falls back to committed `HEAD:<path>` blob reads.
- `skipped`: the report is expected to omit the snapshot notice and include the
  default no-snapshot fields: status, summary, tests, files changed, base SHA,
  and head SHA. The controller uses those fields, its own `git diff`, commit
  state, and disk/git verification results.

For requested snapshots, the controller parses the literal notice line off the
report and validates the parsed path with the canonical guard narrowed to the
`snapshot-*.json` name:

```bash
SNAPSHOT_OK=true
case "$SNAPSHOT_FILE" in
  .ephemeral/snapshot-*.json) ;;
  *) echo "snapshot path validation failed: $SNAPSHOT_FILE" >&2; SNAPSHOT_OK=false ;;
esac
SNAPSHOT_BASENAME=${SNAPSHOT_FILE#.ephemeral/}
case "$SNAPSHOT_FILE" in
  .ephemeral/*/snapshot-*.json) echo "snapshot path must be flat: $SNAPSHOT_FILE" >&2; SNAPSHOT_OK=false ;;
esac
[ "$SNAPSHOT_BASENAME" != "$SNAPSHOT_FILE" ] && [ "$SNAPSHOT_BASENAME" != "" ] || { echo "snapshot path validation failed: $SNAPSHOT_FILE" >&2; SNAPSHOT_OK=false; }
[ "${SNAPSHOT_BASENAME#*/}" = "$SNAPSHOT_BASENAME" ] || { echo "snapshot path must be flat: $SNAPSHOT_FILE" >&2; SNAPSHOT_OK=false; }
[ "${SNAPSHOT_FILE#*..}" = "$SNAPSHOT_FILE" ] || { echo "path traversal: $SNAPSHOT_FILE" >&2; SNAPSHOT_OK=false; }
[ -L .ephemeral ] && { echo "snapshot directory is a symlink: .ephemeral" >&2; SNAPSHOT_OK=false; }
[ -L "$SNAPSHOT_FILE" ] && { echo "snapshot is a symlink: $SNAPSHOT_FILE" >&2; SNAPSHOT_OK=false; }
[ -f "$SNAPSHOT_FILE" ] || { echo "snapshot is not a regular file: $SNAPSHOT_FILE" >&2; SNAPSHOT_OK=false; }
[ -r "$SNAPSHOT_FILE" ] || { echo "snapshot missing or unreadable: $SNAPSHOT_FILE" >&2; SNAPSHOT_OK=false; }
# Validation failure is non-fatal to fallback: the controller records an
# incident when a snapshot was requested, then falls back to committed HEAD blob
# reads for every file in the controller-computed changed-file list. The
# snapshot is an optimization, not reviewer evidence.
```

This bash is a snapshot-specific read guard. It keeps the generic
suffix/traversal shape used by phase artifacts but intentionally diverges from
`play-review`'s findings-file guard: snapshots have no branch/SHA expected-path
comparison, allow only flat `.ephemeral/snapshot-*.json` files, and use a
record-incident-and-fall-back disposition for requested snapshots because the
snapshot consumer always has committed HEAD blob reads available. When no
snapshot was requested, there is no snapshot path to validate and no incident.
The snapshot consumer additionally enforces snapshot-specific flatness, symlink,
and regular-file checks because the consumer is read-only and never overwrites
the file — the producer-side helper writes through a repo-scoped private scratch
directory and renames that output into place.

After parsing the JSON, the controller compares the snapshot's
`head_sha` to its own view of the worktree (`git rev-parse HEAD`); a
mismatch indicates an unexpected commit between DONE and consumption
and routes the consumer to committed HEAD blob reads for that task.

Before using any `files[]` value for metadata, line extraction, or
committed-blob fallback, the controller validates it against the
controller's own changed-file list from `git diff -z --name-status --no-renames
BASE..HEAD`. The snapshot's complete `path` + `status` set must exactly
equal the controller-computed set: no missing, extra, duplicate, or
status-mismatched entries. Snapshot entry paths must be repo-relative
and must not be absolute, empty, `.`, `..`, contain `.` / `..` path
components, contain empty path components, or name a path outside the
controller-computed changed set. If validation fails, the controller
treats the snapshot as malformed and falls back using its own
changed-file list, not the snapshot-provided path or status. For any
non-deleted path the controller reads during fallback, it checks
committed HEAD tree metadata with a literal pathspec (`git ls-tree HEAD
-- ":(literal)$path"`) to require a regular blob entry, then reads bytes
with `git cat-file blob "HEAD:$path"`. It does not read mutable
working-tree paths for snapshot fallback.

The controller MAY use snapshot `content` for:

- Post-commit verification (cross-check `head_sha`, `sha256`, file
  existence).
- Line-range extraction for downstream review or commit composition.

For files with `content` omitted (`skipped` set), the controller falls
back to a committed HEAD blob read for that file only. If validation
fails, the JSON is malformed, or `head_sha` doesn't match the
controller's view for a requested snapshot, the controller fails loud by
recording a snapshot incident and falls back to committed HEAD blob reads for the
controller-computed changed-file list. If no snapshot was requested, the same
fallback path is the default path and absence of snapshot data is valid.

### Trust-boundary rule (load-bearing)

The controller MUST NOT forward snapshot content (or the parsed JSON)
into reviewer subagent dispatches. The controller MAY pass metadata
(file paths, statuses, `head_sha`) to reviewers only as structured,
escaped data. Path strings are repository-controlled and untrusted; they
are data to identify files, not instructions or prose to interpret.
Reviewers read the actual code from disk.

This rule is restated in three places to be unmissable to its primary
reader:

1. `spec-reviewer-prompt.md` § "CRITICAL: Do Not Trust the Report" —
   one bullet calling out controller-held snapshots specifically.
2. `code-quality-reviewer-prompt.md` § "Trust boundary
   (load-bearing)" — equivalent reviewer-side prohibition.
3. `play-subagent-execution/SKILL.md` § "Trust boundary
   (load-bearing)" — controller-side prohibition on forwarding snapshot
   content.

Snapshot content is treated by the controller as **untrusted prose**
(in the same sense ADR-0013 § Consequences names): embedded directives
do not become instructions. The snapshot is data, not a prompt.

### Edit-staleness rule

Editing flows (per-task review-loop fixups, `issue-priming-workflow`
Phase 7 mechanical-nit fixes, any subsequent commit) MUST NOT use
snapshot content as Edit-tool anchors. Once a new commit lands, the
snapshot reflects an older `head_sha` and is stale. For Edit
operations, re-read the file from disk.

The rule is documented in `play-subagent-execution/SKILL.md` near the
controller-consumption prose, and cross-referenced from
`issue-priming-workflow/SKILL.md` Phase 7 so an operator reading the
nit-fix path sees it.

### Skip-dispatch exclusion

The contract scope is the **dispatched-implementer path only**. The
skip-dispatch variant for trivial single-task plans does not invoke this
contract because no implementer is dispatched and no DONE report exists;
the plan body is itself the snapshot. This is named in
`play-subagent-execution/SKILL.md` controller prose so a reader cannot
confuse the two paths.

### Single-task plan interaction

Per ADR-0007, single-task plans skip per-task spec-compliance and
code-quality reviewers. A dispatched single-task implementer emits a snapshot
only when `play-subagent-execution` requests one under the trigger criteria
above. The controller's reuse is opportunistic; the default no-snapshot path is
status, summary, tests, files changed, base SHA, head SHA, and disk/git fallback.

## Consequences

- Token cost on the implementer-DONE → controller hop drops for triggered cases
  by the size of any file the controller would otherwise re-read 1–3 times
  during post-DONE verification, line-range extraction, or reviewer-dispatch
  composition, without imposing helper overhead on low-risk localized tasks.
- The phase-handoff substrate gains a fifth deterministic
  `.ephemeral/` artifact (research, design, plan, findings,
  snapshot) when classification requests it. Cleanup remains implicit via
  worktree teardown.
- The controller's post-DONE behavior is explicit for both paths: requested
  snapshots are validated and incident-recorded on failure, while skipped
  snapshots use the default DONE fields plus committed HEAD blob reads. No
  version flag is needed because request state is carried by
  `play-subagent-execution` and the assembled prompt contract.
- The trust boundary between controller and reviewers is now
  explicit on both sides: controller-side via Red Flag, reviewer-side
  via prompt restatement. The reviewer prompts already mandated disk
  reads ("Read the actual code"); this ADR closes the
  what-about-snapshots gap explicitly.
- Edit-staleness is documented as a discipline rule, not enforced by
  code. The implementer doesn't ratchet or invalidate prior snapshots; old files
  remain in `.ephemeral/` until worktree teardown when snapshots are requested.
- Policy drift risk moves to the ADR/controller/prompt boundary. ADR-0014 owns
  the accepted trigger policy, `play-subagent-execution` owns classification,
  and downstream prompt/controller updates must preserve that precedence.
- **Data residency.** Snapshot content can include source code from
  the diff under review, identical to ADR-0012's findings-file
  residency posture. This exposure exists only when a snapshot is requested.
  The file is git-ignored (`.gitignore` `.ephemeral/`) and lives under default
  umask. Same guidance applies — never embed secret values verbatim; describe
  them.
- **Fork-PR working trees.** Pre-staged symlinks at `.ephemeral`
  itself or at the snapshot path could redirect helper output. The
  implementer applies the ADR-0012 canonical `.ephemeral` write
  guard before writing: reject a symlinked `.ephemeral` directory,
  `mkdir -p .ephemeral`, write all helper scratch files and JSON temp
  output to a private scratch directory under `.ephemeral`, recheck the
  directory, reject an existing directory at the target snapshot path,
  then rename the temp file into the target snapshot path so hardlinks
  are replaced rather than truncated. After the rename, the helper
  verifies the target is a regular non-empty file before it prints the
  success notice.

## Alternatives considered

- **Mandatory snapshots for every dispatched implementer.** This was the
  original ADR-0014 decision and remains the high-assurance fallback for unclear
  cases. Rejected as the default because it imposes helper/runtime overhead on
  low-risk localized tasks where status, summary, tests, files changed, base
  SHA, head SHA, and committed-blob fallback are sufficient.
- **Fully optional snapshots by implementer judgment.** Rejected because it
  places policy in the least authoritative actor, creates inconsistent DONE
  reports, and risks silent loss of needed post-DONE evidence. Implementers
  follow the controller-supplied request state instead.
- **Inline snapshot in DONE-report body.** Implementer's report grows
  a `## Files (verified)` section with fenced blocks per file.
  Controller parses inline, skips re-read. Rejected: zero new
  infrastructure but reverses ADR-0012/0013's direction (move
  payloads off-conversation) — a 5 KB ADR snapshot would still hit
  the controller's context every dispatch. Skip-threshold has to be
  a single global limit (no per-file fallback signal). Substrate
  consistency suffers.
- **Hybrid: inline summary + side-channel content.** DONE report
  inlines `files: [{path, lines, sha256}]` (cheap), content goes to
  the side-channel file. Controller does cheap verification (path /
  hash) without reading the file, falls back to file when needing
  content. Rejected: more contract surface (two channels) for a
  marginal win. The multi-task case (the dominant cost path) almost
  always needs content for line-range extraction, so the hybrid's
  optimization rarely pays.
- **Per-task `task<N>` segment in path.** Path scheme
  `snapshot-<head_sha>-task<N>.json`. Rejected:
  per-commit `head_sha` already disambiguates because each task
  produces a new commit. The `task<N>` segment is redundant.
- **500-line size threshold (matching the issue body's example).**
  Rejected in favor of 64 KB byte threshold. A byte threshold is
  uniform across file types and avoids gaming via long-line
  packing.
- **Configurable threshold.** Rejected for v1 as YAGNI. The
  threshold is enforced by a single literal in the canonical helper
  script and documented by the recipe contract; if real workloads need
  a different value we add the knob then.

## Related

- [ADR-0007](adr-0007-review-pipeline-delineation.md) — single-task
  per-task reviewer skip; dispatched single-task plans use the same
  trigger-based request policy, but the cost benefit is usually small there.
- [ADR-0012](adr-0012-side-channel-file-delivery-for-play-review-findings.md)
  — established the side-channel file pattern this ADR extends to a
  new producer.
- [ADR-0013](adr-0013-path-based-phase-artifact-handoff.md) — the
  upstream symmetry argument for the substrate; the path-validation
  guard pattern; the untrusted-prose framing.
- [ADR-0015](adr-0015-skip-dispatch-for-trivial-single-task-plans.md) —
  excludes skip-dispatch from dispatched-implementer DONE-report contracts.
