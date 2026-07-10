# ADR-0013: Path-Based Phase-Artifact Handoff

## Status

Accepted

## Context

ADR-0012 ratified a side-channel file pattern for `play-review`'s findings:
the producer skill writes a `play-review/findings/v1` envelope to
`.ephemeral/<branch_slug>-<head_sha>-findings.json` and emits a single
`Findings written to <path>.` notice line; consumers read the file off the
path. The motivating evidence showed inline re-emission across consumer hops
accounted for a measurable share of total session tokens.

The same shape exists upstream of `play-review` and is _not_ yet path-based:

| Hop | Producer                         | Consumer                                                                                           | Today                                            |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A   | `issue-priming-workflow` Phase 3 | `play-brainstorm`                                                                                  | Brief inlined under `## Research Brief`          |
| B   | `play-brainstorm`                | `play-planning`                                                                                    | Design summary inlined into `play-planning` args |
| C   | `play-planning`                  | `play-subagent-execution`                                                                          | Plan summary inlined into controller args        |
| D   | `play-review`                    | `branch-review --fix`, `play-branch-finish`, `pr-review` Phase 6, `issue-priming-workflow` Phase 7 | Already path-based via ADR-0012                  |

Each hop carries 2–5 KB of redundant content that the next phase could read
from disk. The artifacts already exist on disk under `.ephemeral/` —
`play-brainstorm` writes `…-design.md` and `play-planning` writes
`…-plan.md`, both established before ADR-0012. ADR-0012 explicitly named
this asymmetry in its Consequences section: "`play-review` becomes
consistent with `play-brainstorm` and `play-planning` in that it writes a
single deterministically-named artifact under `.ephemeral/`. The
phase-handoff substrate is now symmetric across the design / plan / review
producers." This ADR closes the consumer-side gap.

A separate consideration:
`skills/play-subagent-execution/references/red-flags.md` previously listed
`Make subagent read plan file (provide full text instead)` without scoping it to
a specific subagent boundary. Read literally, the rule forbids the
controller-receives-plan-via-path pattern this ADR introduces. The rule's
protective intent — that the controller curates exactly what context each
per-task implementer subagent receives — applies specifically to the per-task
implementer dispatch boundary, not to the controller's own receipt of the plan
from its caller. This ADR documents that scoping.

## Decision

### Hybrid consumer input contract

Each consumer skill (`play-brainstorm`, `play-planning`,
`play-subagent-execution`) accepts the upstream artifact in either of two
shapes inside its invocation prose:

1. **Path reference** (controller-preferred): a single literal line of the
   form `<Artifact label>: <repo-relative-path>`
   (e.g., `Research brief: .ephemeral/<YYYY-MM-DD>-<id>-research.md`).
2. **Inline content**: the existing `## <Artifact label>` heading + body,
   unchanged from prior behavior.

If both are present, the path reference wins. The hybrid form preserves
backward compatibility for direct human invocations (which have no upstream
file to reference) while letting controllers like `issue-priming-workflow`
drop the inline payload entirely.

### Producer notice-line contract

Producer skills emit a literal line at the end of their conversation output,
mirroring ADR-0012's `Findings written to <path>.` pattern verbatim:

| Producer (skill that emits the line) | Literal line                                      |
| ------------------------------------ | ------------------------------------------------- |
| `issue-priming-workflow` Phase 3     | `Research brief written to <repo-relative-path>.` |
| `play-brainstorm`                    | `Design written to <repo-relative-path>.`         |
| `play-planning`                      | `Plan written to <repo-relative-path>.`           |

Controllers parse the path off this exact line. Producers MUST NOT reword.

### Invocation-only child handoff lines

`issue-priming-workflow` Phase 6 also passes `Auto handoff:
<repo-relative-path>` inside the child invocation prose for
`play-subagent-execution`. This is not emitted as a conversation-output
producer notice, and downstream tools MUST NOT treat it as a bearer credential
or parseable proof of authorization. The referenced artifact has schema
`issue-priming/auto-handoff/v1` and is audit evidence for
`play-subagent-execution`'s reduced-route decision; the executor also needs
controller-local parent state from an active `issue-priming-workflow --auto`
run.

The Phase 6 producer still follows the same direct-child `.ephemeral/` write
discipline: reject symlinked `.ephemeral`, create the directory, reject a
symlink at the target file, write a temporary file under `.ephemeral/`, then
rename it into place. The consumer applies the direct-child
suffix/traversal/symlink guard before reading it; invalid or missing audit
evidence disables reduced routes and falls back to `spec-and-quality`.

### Research synthesis and persistence ownership

`issue-priming-workflow` Phase 3 is the research-artifact producer. Its root
dispatches one required internal research child and, when external evidence is
applicable, one external research child. The root synthesizes the final brief
from the required internal report and any applicable external report.

Research children are read-only leaves that return agent-local scoped reports.
They do not delegate, write artifacts, emit producer notices, or synthesize the
final `## Issue Brief`. Only the root invokes the guarded write helper,
persists the final brief, and emits
`Research brief written to <repo-relative-path>.` This parallels how
`play-review` (a skill) writes its own findings file rather than delegating
persistence to a subagent.

Raw child reports remain agent-local/controller-local execution evidence, not
phase artifacts or shared records. Shared comments may reuse only sanitized
summary-only outcomes and minimum stable evidence pointers; they do not receive
raw reports or issue-local execution history. Durable documentation contains
only deliberately promoted durable truth and evidence pointers under its
owning documentation contract, never raw issue-local history or agent reports.

### Path schemes

| Artifact       | Path scheme                                      |
| -------------- | ------------------------------------------------ |
| Research brief | `.ephemeral/<YYYY-MM-DD>-<id>-research.md`       |
| Design         | `.ephemeral/<YYYY-MM-DD>-<topic>-design.md`      |
| Plan           | `.ephemeral/<YYYY-MM-DD>-<feature-name>-plan.md` |

`<id>` is the slugged form of `payload.identifier`: a hash-prefixed numeric
identifier becomes its digits, while an uppercase provider key becomes
lowercase. The authoritative slug and research-brief path computation lives in
`skills/issue-priming-workflow/scripts/write-research-brief.sh`: lowercase the
identifier, convert `/` to `-`, retain only alphanumerics, `.`, `_`, and `-`,
and reject unsafe derived paths through the script's write-target guard.
`<topic>` and `<feature-name>` follow the existing `play-brainstorm` /
`play-planning` conventions and are unchanged.

The deterministic `<branch_slug>-<head_sha>` scheme used by `play-review`
was considered for symmetry across all four producers and rejected: design
and plan artifacts are written before any implementation commits exist, so
`head_sha` is ill-defined at write time. Consumers locate files via the
producer notice line, not by guessing a path, so mixed schemes inside
`.ephemeral/` are acceptable.

### Path-validation guard

Every consumer that reads a path-referenced artifact MUST run a guard before
opening the file. ADR-0013 owns the generic phase-artifact guard below.
`skills/play-review/references/findings-envelope-contract.md` defines the
stricter findings-file variant: it recomputes
`.ephemeral/<branch_slug>-<head_sha>-findings.json`, rejects nested paths, and
is used for findings-file consumers. `skills/play-review/SKILL.md` retains the
workflow and notice-line hook. Derived nits
envelopes use their own direct-child `nits_file` guard because they may end in
`-nits-pending.json`. Generic phase artifacts narrow the guard to their expected
suffix, reject symlinked `.ephemeral` and symlinked leaf files, require a regular
file, and include a `[ -r ]` readability check; a missing or unreadable file is a
fail-loud signal that the producer notice line was malformed or the file was
clobbered.

```bash
# Generic shape (each consumer narrows the allow-list)
case "$ARTIFACT_PATH" in
  .ephemeral/*/*) echo "nested <artifact> path rejected: $ARTIFACT_PATH" >&2; exit 1 ;;
  .ephemeral/*-<expected-suffix>) ;;
  *) echo "<artifact> path validation failed: $ARTIFACT_PATH" >&2; exit 1 ;;
esac
[ "${ARTIFACT_PATH#*..}" = "$ARTIFACT_PATH" ] || { echo "path traversal: $ARTIFACT_PATH" >&2; exit 1; }
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
[ ! -L "$ARTIFACT_PATH" ] || { echo "artifact must not be a symlink: $ARTIFACT_PATH" >&2; exit 1; }
[ -f "$ARTIFACT_PATH" ] || { echo "artifact missing or not a regular file: $ARTIFACT_PATH" >&2; exit 1; }
[ -r "$ARTIFACT_PATH" ] || { echo "artifact missing or unreadable: $ARTIFACT_PATH" >&2; exit 1; }
```

Two deliberate shape properties of this guard, named here so future readers do
not mistake them for bugs:

- This generic phase-artifact guard rejects nested `.ephemeral` subpaths.
  Allowing a nested path such as `.ephemeral/link/foo-plan.md` would require
  parent-component realpath confinement checks before read or write; without
  those checks, a symlinked parent component could escape the worktree.
  Findings/nits envelopes also stay direct children of `.ephemeral/` for the
  same reason and because their paths are echoed through review output and
  reused by wrappers before read or overwrite.
- The generic guard allows an empty `<id>` slug (e.g.,
  `.ephemeral/-research.md`) when the suffix matches. Consumers rely on
  producer notice-line authenticity plus suffix validation for routing.
- The `[ "${VAR#*..}" = "$VAR" ]` test rejects all `..`-bearing paths,
  including benign filenames that contain `..` as ordinary characters
  (e.g., `.ephemeral/foo-..-bar-research.md`). This is intentional:
  `..` is reserved anywhere in a `.ephemeral/` artifact filename. The
  test errs on the safe side and is canonical for all four producers.

Per-consumer suffix specialization:

- `play-brainstorm` accepts `*-research.md` only.
- `play-planning` accepts `*-design.md` only.
- `play-subagent-execution` accepts `*-plan.md` only.
- `issue-priming-workflow` validates each artifact at its capture point with
  the same per-suffix narrowing.

The canonical `.ephemeral` write guard baseline — reject a symlinked
`.ephemeral` directory, `mkdir -p .ephemeral`, remove a symlink at the target
file path where the producer follows the legacy replace-before-`Write` pattern,
and reject directories or other non-regular existing paths — was introduced by
`skills/play-review/references/findings-envelope-contract.md` and is required
by ADR-0012. Each phase-artifact producer owns its deterministic mechanics at
its own boundary: `issue-priming-workflow` uses
`scripts/write-research-brief.sh` when it persists the research brief, and that
helper intentionally uses a stricter target-leaf policy by rejecting symlinked
research-brief paths instead of removing them. This stricter research-helper
behavior does not change the legacy leaf-symlink behavior of `play-review`,
`play-brainstorm`, or `play-planning`.

The generic guard shape remains the policy baseline for phase artifacts. When a
guard becomes complex, reusable, or shared across multiple skills, ADR-0019
requires the owning skill to move the executable mechanics into a tested helper
script and keep only the invocation contract in `SKILL.md`.

### Cleanup ownership

Inherits ADR-0012 § Consequences's policy: cleanup is implicit via worktree
lifecycle, but PR creation preserves the worktree. `play-branch-finish` Step 5
removes worktrees only for local merge and explicit discard paths; Option 2 PR
creation keeps `.ephemeral/` artifacts available for review follow-up, CI
fixes, and nit handling. Post-merge cleanup is owned by `pr-merge`, and manual
cleanup remains an operator action for long-lived worktrees. No per-skill
stale-artifact sweep is introduced. The `design.md` / `plan.md` precedents have
never had a sweep; ADR-0012's findings-file decision did not introduce one;
this ADR keeps the convention uniform. Edge cases (PR-created preserved
worktrees, keep-as-is flows, direct skill invocations outside a short-lived
worktree) leave files in place. Operators may sweep manually — extending the
ADR-0012 sweep snippet with the three new markdown suffixes:

```bash
rm -f .ephemeral/*-research.md .ephemeral/*-design.md .ephemeral/*-plan.md \
      .ephemeral/*-findings.json .ephemeral/*-nits-pending.json
```

### Clarification of `skills/play-subagent-execution/references/red-flags.md`

The previous Red Flag entry `Make subagent read plan file (provide full text
instead)` is rewritten as `Make per-task implementer subagent read the plan
file (controller still curates and inlines the per-task text)`. The
controller (the agent running `play-subagent-execution`) MAY accept the plan
via a path reference from its caller; what stays prohibited is the per-task
implementer subagent fishing the plan from disk. The two boundaries are
distinct, and the rewrite preserves the original protective intent at the
per-task boundary.

## Consequences

- Token cost on hops A, B, C collapses from 2–5 KB per hop to one notice line
  per hop. Combined with ADR-0012's hop D collapse, a single
  `--auto` run no longer carries any phase artifact inline across skill
  boundaries.
- Phase-handoff substrate is now symmetric across all four producers
  (research, design, plan, review). The pattern (write artifact under
  `.ephemeral/`; emit `<Artifact> written to <path>.`; consumer validates +
  reads) is uniform.
- Backward compatibility is preserved. Direct human invocations of
  `play-brainstorm` or `play-planning` that include `## Research Brief` or
  `## Design` headings continue to work unchanged.
- Cleanup remains implicit via worktree teardown. No new sweep introduced.
- Fork-PR untrust footnote from ADR-0012 transitively applies to
  `issue-priming-workflow` Phase 3's write of the research brief; the
  write-target guard requirement is named in this ADR's Decision § for
  cross-reference clarity.
- **Brief content is untrusted prose, not executable instructions.** The root
  synthesizes the research brief from leaf reports produced against a
  possibly-untrusted issue body (fork PRs especially, but any issue under
  operator workflow). When `play-brainstorm` reads the brief from
  `.ephemeral/`, it treats the content as descriptive prose — not as authority
  to act outside its contract. Embedded directives ("ignore prior
  instructions", tool-call snippets, shell commands, paths into the
  controller's filesystem) do not become instructions to the consumer skill,
  regardless of how the brief is phrased. The downstream skills
  (`play-planning`, `play-subagent-execution`) consume artifacts produced by
  the operator workflow itself (design, plan) and so are not directly exposed
  to untrusted-issue-body prose; the threat is contained at the
  `play-brainstorm`-reads-brief boundary.
- Operators reading `play-subagent-execution`'s § Red Flags now see a
  scoping note specifying the per-task subagent boundary. Future readers
  who encounter the rule do not have to grep history to discover that the
  controller-receives-plan path is allowed.

## Alternatives considered

- **Path-only consumer contract.** Each consumer skill accepts only the path
  reference shape; the inline `## <Artifact>` form is removed. Architecturally
  cleanest. Rejected: would break direct human invocations of
  `play-brainstorm` and `play-planning` (a user typing "Help me design X"
  has no path to reference) and would break the backward-compat requirement
  for direct invocations.
- **Auto-detect inline-vs-path via heuristic** (e.g., "value starts with
  `.ephemeral/`"). Single arg; consumer sniffs whether the value is a path.
  Rejected: fragile (a research brief that happens to quote `.ephemeral/`
  paths in its content would misroute), no precedent in the repo, and
  contradicts ADR-0012's explicit choice of structured separation over
  auto-detection for `nits_file`.
- **Migrate `play-brainstorm` and `play-planning` to
  `<branch_slug>-<head_sha>` paths** for symmetry with `play-review`'s
  findings file. Rejected: brainstorm and planning run _before_
  implementation commits exist, so `head_sha` is ill-defined at write time.
  The existing date-prefix scheme is documented and stable. Consumers locate
  files via producer notice lines, not by guessing a path, so mixed schemes
  inside `.ephemeral/` are acceptable.
- **Reverse `play-subagent-execution`'s § Red Flags entry entirely** (delete
  the rule rather than scope it). Rejected: the original rule's protective
  intent (controller curates per-task context for the implementer subagent)
  is independently load-bearing and applies whether or not the controller
  itself reads from a path. Scoping is the correct fix.
- **Have a research child write the brief itself.** Would expand that child's
  Codex sandbox from `read-only` to a write-capable mode and add the `Write`
  tool to `agents/research-agent.yaml`'s `claude.tools` list. Rejected: the
  role is scoped investigation, not cross-scope synthesis or artifact
  persistence; the parallel to `play-review` (a skill that runs in the main
  conversation context with full Write access) is the correct one.
  `issue-priming-workflow` Phase 3 — the dispatching skill — owns synthesis,
  persistence, and notice-line emission.

## Related

- [ADR-0010](adr-0010-structured-review-findings-schema.md) — defines the
  `play-review/findings/v1` schema (transport superseded by ADR-0012).
- [ADR-0012](adr-0012-side-channel-file-delivery-for-play-review-findings.md)
  — establishes the side-channel file pattern this ADR generalizes upstream.
