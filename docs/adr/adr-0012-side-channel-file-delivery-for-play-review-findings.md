# ADR-0012: Side-Channel File Delivery for `play-review` Findings

## Status

Accepted

## Context

ADR-0010 introduced the `play-review/findings/v1` JSON schema (a
top-level envelope with `schema`, `findings`, and `carry_forward`
fields, defined in `skills/play-review/SKILL.md` § Output) and
specified its transport: a trailing fenced `json` block appended to
`play-review`'s conversation output. Wrappers (`branch-review`,
`pr-review`) re-emit the same block on their surfaces;
`play-branch-finish` re-receives it as a `nits[]` invocation arg;
`issue-priming-workflow` Phase 7 reads it from conversation to select
judgment-required remaining nits. The same envelope traverses 4 conversation contexts
per `--auto` run.

That propagation was observed to be a measurable share of total session
tokens — on the order of 5KB per hop across 4 hops, though the exact
figure depends on finding count and run. The cost evidence was not
available when ADR-0010 was written; ADR-0010 acknowledged a "wrappers
re-emit the block on their surfaces" cost in its Consequences but had no
empirical baseline to weigh it against.

ADR-0010's _Alternatives considered_ already considered and **rejected**
a side-channel `.ephemeral/findings.json`, with this stated reason
(ADR-0010 § Alternatives considered, "Side-channel
`.ephemeral/findings.json` file" entry):

> Side-channel `.ephemeral/findings.json` file. Rejected:
> violates `play-review`'s no-I/O boundary established by ADR-0009.
> File I/O is the wrapper's responsibility, not `play-review`'s.

This ADR re-opens that decision. Two facts pull against ADR-0010's
prior reasoning:

1. **The "no-I/O boundary" framing is a paraphrase of ADR-0009 that
   ADR-0009 itself does not assert.** ADR-0009's actual constraints
   on `play-review` (mirrored in `skills/play-review/SKILL.md` Hard
   Rules 5-7 and the closing paragraph of § Output) are: "this skill
   never touches GitHub, never auto-fixes, never creates or removes
   worktrees." That is a constraint on _side-effectful disposition_
   (posting, fixing, cleanup), not on bytes-on-disk. `play-review`
   already reads files (guideline globs, source code) under that
   regime without controversy. The "no-I/O" reading hardened only
   inside ADR-0010's Alternatives section; treating it as a
   first-class invariant overstates ADR-0009's text.
2. **`.ephemeral/` is already an established phase-handoff
   substrate.** `play-brainstorm` writes
   `.ephemeral/YYYY-MM-DD-<topic>-design.md`; `play-planning` writes
   `.ephemeral/YYYY-MM-DD-<feature-name>-plan.md`;
   `play-subagent-execution` reads them back. The directory is
   git-ignored. ADR-0010 did not engage with this precedent.

Together these mean: the prior rejection rested partly on a stronger
boundary claim than ADR-0009 actually makes, and on an
artifact-passing precedent that already cuts the other way. The
remaining cost — cross-context propagation of the JSON envelope — is
load-bearing and addressable.

## Decision

`play-review` writes the `play-review/findings/v1` envelope to a
deterministic side-channel file and emits a single notice line in its
conversation output:

```
Findings written to <repo-relative-path>.
```

Path scheme:

```
.ephemeral/<branch_slug>-<head_sha>-findings.json
```

- `<head_sha>` — `play-review`'s required `head_sha` input. Full
  40-character SHA, lowercased (regex `^[0-9a-f]{40}$`).
- `<branch_slug>` — derived from the current branch with explicit
  detached-HEAD detection, since `git rev-parse --abbrev-ref HEAD`
  returns the literal string `HEAD` (not empty/error) on detached
  checkouts (e.g., `pr-review` fork PRs that use
  `gh pr checkout --detach`). The slug also substitutes `unnamed` for
  shapes that would widen the path-interpretation surface (empty after
  stripping, bare `.`/`..`, or starting with `-`/`.`).

The path scheme and consumer responsibilities in this ADR remain authoritative.
Per ADR-0019, reusable executable mechanics for findings and derived nits
artifacts should move to the owning `play-review` helper script when this
contract is extracted from prompt-embedded shell. `SKILL.md` carries the
invocation contract and workflow policy.

The path is computed and written by `play-review` itself, not by the
wrapper. The envelope is always written, even for empty findings (the
canonical empty form
`{"schema":"play-review/findings/v1","findings":[],"carry_forward":[]}`).
The notice line is the only structured surface in conversation; the
human-readable `## Findings` and `## Carry-forward` markdown sections
are unchanged and remain in-conversation for operator review.

The schema name `play-review/findings/v1` and per-field contract are
unchanged. Only the transport changes. Additive evolution stays on
`v1` per ADR-0010 Decision §.

Consumer responsibilities:

- `branch-review` Phase 3 (no-`--fix`) — surface the notice line in
  wrapper output. No JSON re-emission.
- `branch-review --fix` — after auto-fixes, _overwrite the same
  file_ with the remaining-set envelope: all pre-fix findings except findings
  successfully fixed and committed by `branch-review --fix`, including
  objectively fixable nit-severity findings. The remaining set preserves
  judgment-required nits, blockers skipped on `INVALID`/`DOWNGRADE`, hard-rule
  judgment-required blockers preserved in the remaining set from `play-review`
  Sub-check 1 Safety / Sub-check 2 Contracts, the halt blocker, and any later
  blockers left unprocessed because an earlier stop-rule finding halted the
  loop. `INVALID` findings are preserved as invalidated review evidence for
  auditability but count as neither blockers nor postable nits. Capture the
  immutable Phase 2 review SHA before applying any auto-fix commits, then report
  it after processing as the exact line
  `Review head: <40-hex-sha>.`. Re-emit the (unchanged) findings notice line.
- `pr-review` Phase 6 — read the envelope from the file. The
  partition-by-`anchor` logic, `start_line` null-handling, and
  GitHub Reviews API call are unchanged.
- `play-branch-finish` Option 2 — accept `nits_file` (a
  repo-relative path to a `play-review/findings/v1` envelope) in
  place of today's inline `nits` JSON array. Iterate `findings[]`
  and post anchorable / unanchorable subsets as before.
- `issue-priming-workflow` Phase 7 — read the immutable review SHA from
  `branch-review --fix`'s exact `Review head: <40-hex-sha>.` notice line, then
  read `findings[]` from the file at the `Findings written to <path>.` notice
  line. The consumer validates the findings path against the Phase 2
  review SHA, not post-fix `HEAD`, because `branch-review --fix` may have
  committed fixes after `play-review` created the file. After the final
  branch-review run, write only the judgment-required remaining subset to a
  derived file `.ephemeral/<branch_slug>-<head_sha>-nits-pending.json` and pass
  that path to `play-branch-finish` as `nits_file`.

## Consequences

- Token cost on the 4 consumer hops collapses from ~5KB × 4 to one
  notice line per hop.
- `play-review` becomes consistent with `play-brainstorm` and
  `play-planning` in that it writes a single deterministically-named
  artifact under `.ephemeral/`. The phase-handoff substrate is now
  symmetric across the design / plan / review producers.
- Cleanup remains implicit via worktree lifecycle, but PR creation preserves
  the worktree. `play-branch-finish` removes worktrees only for local merge and
  explicit discard paths; Option 2 PR creation keeps `.ephemeral/` artifacts
  available for review follow-up, CI fixes, and nit handling. Post-merge cleanup
  is owned by `pr-merge`, and manual cleanup remains an operator action for
  long-lived worktrees. No per-skill stale-finding sweep is introduced.
  - Edge case: PR-created preserved worktrees, keep-as-is flows, and direct
    `branch-review` / `pr-review` invocations outside a short-lived worktree
    leave the file in place. Files are git-ignored (`.gitignore`) and small
    (~5KB each). Operators may sweep manually if accumulation matters in
    long-lived worktrees:

    ```bash
    rm -f .ephemeral/*-findings.json .ephemeral/*-nits-pending.json
    ```

    A sweep was considered and rejected — the `.ephemeral/` precedent
    (`design.md`, `plan.md`) doesn't sweep either, and there is no
    concrete failure scenario today motivating the inconsistency.

- Re-runs on the same branch + same SHA overwrite cleanly (deterministic
  path). Different SHAs produce different paths.
- **Data residency.** Findings text (`why` / `recommendation` / `body`)
  can quote source code from the diff under review — Safety-category
  findings often do. Unlike the in-conversation markdown, which lives
  only in session memory, the side-channel file persists on disk under
  the default umask until the worktree is torn down. The file is
  git-ignored (`.gitignore` `.ephemeral/`) so the content does not
  reach the remote, but the on-disk substring remains discoverable to
  anything with read access to the working tree. The pre-existing
  guidance in `skills/play-review/SKILL.md` — never quote actual
  secret values in finding text; describe them (e.g., "a 32-char API
  key on line 42") instead — is restated here so this ADR does not
  read as if disk-usage were the only risk.
- **Fork-PR working trees are untrusted with respect to `.ephemeral/`
  layout.** When `pr-review` runs against a fork PR via
  `gh pr checkout --detach`, the checked-out tree may contain a
  pre-staged symlink at `.ephemeral` itself or at
  `.ephemeral/<…>-findings.json`. Because the `Write` tool follows
  symlinks, an unguarded write would land attacker-chosen content at
  the link's target. `play-review`'s Write rules (see
  `skills/play-review/SKILL.md` § Output) now require a write-target
  preflight before writing: reject a symlinked `.ephemeral`
  directory, `mkdir -p .ephemeral`, remove any symlink at the target
  file path, and reject directories or other non-regular existing
  paths. `branch-review --fix` and `issue-priming-workflow` Phase 7
  inherit the same requirement when they overwrite or derive a sibling
  file.
- ADR-0010's "no-I/O boundary" paraphrase is corrected here. The
  remaining wrapper-disposition boundary (no GitHub calls, no auto-fix,
  no worktree mutation) is unchanged and still authoritative for
  `play-review`. Writing `.ephemeral/<…>-findings.json` is an output
  artifact, not a disposition.
- ADR-0010 is marked `Superseded by ADR-0012`. The schema name and
  field shape it defines remain authoritative — only the transport
  paragraph (Decision § "Wrappers re-emit the block on their surfaces"
  and Positional rules) is overridden by this ADR.

## Alternatives considered

- **Wrappers write the file; `play-review` keeps in-band JSON,
  truncated.** Rejected: preserves ADR-0010's letter but leaves the
  largest cost edge (`play-review` → wrapper, where the envelope first
  crosses contexts) untouched. Saves only the wrapper-to-downstream
  edges — half a fix at full migration cost.
- **Dual-channel: file plus compact in-band summary (counts by
  severity / category).** Rejected: reintroduces the consumer-side
  redundancy ADR-0010 was originally trying to eliminate, and creates
  a second contract (the summary) to keep in sync with the schema.
- **Keep ADR-0010's status quo.** Rejected: the cost evidence is
  load-bearing once ADR-0010's "no-I/O boundary" is reckoned with
  against ADR-0009's actual text. The prior rejection's framing
  overstated ADR-0009's constraint.
- **Use `play-review`'s existing date-prefix naming convention
  (`YYYY-MM-DD-…`) for the findings file.** Rejected: branch + head SHA
  is a stronger uniqueness scheme that matches `play-review`'s input
  contract directly and lets `branch-review --fix` overwrite in place
  without naming gymnastics. Date-prefix would conflict on same-day
  re-runs.

## Related

- ADR-0009: review-pipeline consolidation (defined the
  GitHub / auto-fix / worktree disposition boundary `play-review`
  preserves)
- ADR-0010: structured review-finding schema (superseded by this ADR
  for transport; schema name and field shape unchanged)
