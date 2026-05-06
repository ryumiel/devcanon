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

In multi-task plans (per-task reviewers active per ADR-0007), the
controller's re-read pressure is highest because line ranges feed the
spec-compliance and code-quality reviewer dispatches. Each re-read
pulls full file content into the controller's context. The pattern was
observed in PR #163's run: a 167-line ADR that the implementer wrote
was re-read by the controller across the post-commit verification,
review composition, and nit-fixing steps.

A naive fix — embed the file content in the DONE report — collides
with `skills/play-subagent-execution/references/spec-reviewer-prompt.md`
§ "CRITICAL: Do Not Trust the Report" (lines 23-37 today), which
mandates that reviewers read the actual code from disk and **NOT**
trust any artifact the implementer hands over. The same rule covers
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

A separate concern: issue #168 (now reduced to a leaner prompt
variant) and issue #175 (skip-dispatch path for trivial single-task
plans) interact. #168 still dispatches an implementer; #175 does not
— the plan body is itself the snapshot in that path. Any contract
introduced here must explicitly exclude #175.

## Decision

### Producer (implementer)

After the implementer commits its work, before reporting, it writes a
side-channel snapshot manifest. The path:

```
.ephemeral/<branch_slug>-<head_sha>-snapshot.json
```

- `<head_sha>` — full 40-character lowercase hex from
  `git rev-parse HEAD` post-commit. Regex `^[0-9a-f]{40}$`.
- `<branch_slug>` — derived using the canonical bash from
  `skills/play-review/SKILL.md` § Output → Side-channel file → Path
  (including the `detached` and `unnamed` substitutions). The
  implementer reuses that canon — it does not invent a new slug
  rule.

The path scheme matches `play-review`'s findings file because, like
`play-review`, the implementer is writing post-commit and so has a
defined `head_sha`. ADR-0013 explicitly noted that brainstorm/plan
artifacts cannot use this scheme because they precede commits; the
implementer is in a different position.

Per-commit `head_sha` guarantees uniqueness, so no `task<N>` segment
is needed in the path. Re-dispatched tasks produce new commits → new
SHAs → new files. Stale snapshots remain on disk until worktree
teardown (consistent with ADR-0012 cleanup).

### Snapshot envelope (`implementer/snapshot/v1`)

```json
{
  "schema": "implementer/snapshot/v1",
  "task_id": "Task 3",
  "head_sha": "abc1234567890abc1234567890abc1234567890",
  "files": [
    {
      "path": "docs/adr/adr-0014-implementer-done-snapshot-contract.md",
      "status": "added",
      "lines": 167,
      "bytes": 5021,
      "sha256": "<hex>",
      "content": "<verbatim file content>"
    }
  ]
}
```

Per-field contract:

| Field      | Type                                       | Notes                                                                                         |
| ---------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `schema`   | string literal `"implementer/snapshot/v1"` | Pinned. Additive changes stay on `v1`; renames/type changes require `v2`.                     |
| `task_id`  | string                                     | Free-form task identifier from the plan task header (e.g., `"Task 3"`). Provenance only.      |
| `head_sha` | string                                     | Post-commit SHA, full 40-char lowercase hex (`^[0-9a-f]{40}$`).                               |
| `files`    | array                                      | One object per file the implementer created or modified for this task.                        |
| `path`     | string, repo-relative                      | Path of the modified file.                                                                    |
| `status`   | `"added"` \| `"modified"` \| `"deleted"`   | Mirrors `git diff --name-status` letters mapped to words.                                     |
| `lines`    | integer                                    | Line count post-commit (`wc -l`). For deleted files, `0`.                                     |
| `bytes`    | integer                                    | Byte count post-commit. For deleted files, `0`.                                               |
| `sha256`   | string, hex                                | SHA-256 of the file's post-commit content. For deleted files, `""`.                           |
| `content`  | string OR omitted                          | Verbatim post-commit file content. Present iff `bytes <= 64_000` AND `status != "deleted"`.   |
| `skipped`  | string OR omitted                          | When `content` is omitted, the reason (`"size>64KB"`, `"deleted"`, `"binary"`).               |

Mutual exclusion: exactly one of `content` or `skipped` is present
per file, except when `status == "deleted"` (both omitted; the
consumer infers `deleted` semantics from `status`).

Files reported by `git diff --numstat` as binary (`-\t-\t<path>`)
emit `"skipped": "binary"`.

### Notice line

After writing the file, the implementer appends exactly one literal
line to its DONE report:

```
Snapshot written to <repo-relative-path>.
```

The notice line is the controller's contract surface. The existing
`Files changed` bullet stays — it is human-scannable and
non-redundant with the structured notice.

### Size threshold (64 KB)

64 KB byte threshold, hard-coded in the implementer prompts.

- A byte threshold (vs. line threshold) is uniform across file types
  and avoids gaming via long lines.
- 64 KB clears the largest skill markdown in this repo
  (`skills/play-review/SKILL.md` ~42 KB; next-largest
  `skills/issue-priming-workflow/SKILL.md` ~34 KB) with comfortable
  headroom for JSON-encoding overhead and future growth. ADRs are
  smaller still (~6–15 KB each).
- Per-file skip with a recorded reason lets the controller fall back
  to disk read for that one file rather than disabling the whole
  snapshot.
- Configurability is YAGNI for v1.

### Consumer (controller in `play-subagent-execution`)

After the implementer reports DONE (or DONE_WITH_CONCERNS), the
controller parses the literal `Snapshot written to <path>.` line off
the report and validates the parsed path with the canonical guard
narrowed to the `*-snapshot.json` suffix:

```bash
case "$SNAPSHOT_FILE" in
  .ephemeral/*-snapshot.json) ;;
  *) echo "snapshot path validation failed: $SNAPSHOT_FILE" >&2; exit 1 ;;
esac
[ "${SNAPSHOT_FILE#*..}" = "$SNAPSHOT_FILE" ] || { echo "path traversal: $SNAPSHOT_FILE" >&2; exit 1; }
[ -r "$SNAPSHOT_FILE" ] || { echo "snapshot missing or unreadable: $SNAPSHOT_FILE" >&2; exit 1; }
```

This bash mirrors the authoritative path-validation guard in
`skills/play-review/SKILL.md` § Output → Side-channel file → Path
(required by ADR-0012), narrowed to the snapshot suffix.

The controller MAY use snapshot `content` for:

- Post-commit verification (cross-check `head_sha`, `sha256`, file
  existence).
- Line-range extraction for downstream review or commit composition.

For files with `content` omitted (`skipped` set), the controller
falls back to disk read for that file only. If validation fails, the
JSON is malformed, or `head_sha` doesn't match the controller's
view, the controller fails loud and falls back to disk reads for all
files.

### Trust-boundary rule (load-bearing)

The controller MUST NOT forward snapshot content (or the parsed JSON)
into reviewer subagent dispatches. The controller MAY pass the
metadata (file paths, statuses, `head_sha`) to reviewers so they know
which files to read — that is metadata, not content. Reviewers read
the actual code from disk.

This rule is restated in three places to be unmissable to its primary
reader:

1. `spec-reviewer-prompt.md` § "CRITICAL: Do Not Trust the Report" —
   one bullet calling out controller-held snapshots specifically.
2. `code-quality-reviewer-prompt.md` § "In addition to standard code
   quality concerns" — equivalent bullet.
3. `play-subagent-execution/SKILL.md` § Red Flags — controller-side
   prohibition on forwarding snapshot content.

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

The contract scope is the **dispatched-implementer path only**. Issue
#175 (skip-dispatch variant for trivial single-task plans) does not
invoke this contract because no implementer is dispatched and no DONE
report exists; the plan body is itself the snapshot. This is named
in `play-subagent-execution/SKILL.md` controller prose so a reader
cannot confuse the two paths.

### Single-task plan interaction

Per ADR-0007, single-task plans skip per-task spec-compliance and
code-quality reviewers. The implementer still emits a snapshot — the
contract is on the implementer, not the controller. The controller's
reuse is opportunistic; the cost is one notice line and one
`.ephemeral/` file torn down with the worktree.

## Consequences

- Token cost on the implementer-DONE → controller hop drops by the
  size of any file the controller would otherwise re-read 1–3 times
  during post-DONE verification, line-range extraction, or
  reviewer-dispatch composition. PR #163-class cost is recovered for
  the dispatched-implementer path.
- The phase-handoff substrate gains a fifth deterministic
  `.ephemeral/` artifact (research, design, plan, findings,
  snapshot). Cleanup remains implicit via worktree teardown.
- The controller's existing post-DONE behavior is unchanged when the
  notice line is absent: it falls back to disk reads. Older plans
  running through the same prompts gain the snapshot-write step
  automatically once the prompt updates land. No version flag is
  needed.
- The trust boundary between controller and reviewers is now
  explicit on both sides: controller-side via Red Flag, reviewer-side
  via prompt restatement. The reviewer prompts already mandated disk
  reads ("Read the actual code"); this ADR closes the
  what-about-snapshots gap explicitly.
- Edit-staleness is documented as a discipline rule, not enforced by
  code. The implementer doesn't ratchet or invalidate prior
  snapshots; old files remain in `.ephemeral/` until worktree
  teardown.
- **Data residency.** Snapshot content can include source code from
  the diff under review, identical to ADR-0012's findings-file
  residency posture. The file is git-ignored
  (`.gitignore` `.ephemeral/`) and lives under default umask. Same
  guidance applies — never embed secret values verbatim; describe
  them.
- **Fork-PR working trees.** Pre-staged symlinks at the snapshot
  path could redirect a `Write`. The implementer applies the
  ADR-0012 symlink guard (`[ -L "$F" ] && rm "$F"`) before writing.

## Alternatives considered

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
  `<branch_slug>-<head_sha>-task<N>-snapshot.json`. Rejected:
  per-commit `head_sha` already disambiguates because each task
  produces a new commit. The `task<N>` segment is redundant.
- **500-line size threshold (matching the issue body's example).**
  Rejected in favor of 64 KB byte threshold. A byte threshold is
  uniform across file types and avoids gaming via long-line
  packing.
- **Configurable threshold.** Rejected for v1 as YAGNI. The
  threshold is a single literal in two prompts; if real workloads
  need a different value we add the knob then.

## Related

- [ADR-0007](adr-0007-review-pipeline-delineation.md) — single-task
  per-task reviewer skip; this contract still applies in single-task
  plans (implementer always emits) but the cost benefit is small
  there.
- [ADR-0012](adr-0012-side-channel-file-delivery-for-play-review-findings.md)
  — established the side-channel file pattern this ADR extends to a
  new producer.
- [ADR-0013](adr-0013-path-based-phase-artifact-handoff.md) — the
  upstream symmetry argument for the substrate; the path-validation
  guard pattern; the untrusted-prose framing.
- Issue #164 — session-cost reduction parent.
- Issue #170 — this work.
- Issue #168 — leaner mechanical-implementer prompt; still dispatches
  an implementer, so this contract applies to it.
- Issue #175 — skip-dispatch path; this contract explicitly does NOT
  apply because no implementer is dispatched.
