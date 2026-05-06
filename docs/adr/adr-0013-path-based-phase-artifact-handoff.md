# ADR-0013: Path-Based Phase-Artifact Handoff

## Status

Accepted

## Context

ADR-0012 ratified a side-channel file pattern for `play-review`'s findings:
the producer skill writes a `play-review/findings/v1` envelope to
`.ephemeral/<branch_slug>-<head_sha>-findings.json` and emits a single
`Findings written to <path>.` notice line; consumers read the file off the
path. The motivating evidence (PR #163-class session-cost) showed inline
re-emission across consumer hops accounted for a measurable share of total
session tokens.

The same shape exists upstream of `play-review` and is _not_ yet path-based:

| Hop | Producer                       | Consumer                                                                                           | Today                                            |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A   | `research-agent` (via Phase 3) | `play-brainstorm`                                                                                  | Brief inlined under `## Research Brief`          |
| B   | `play-brainstorm`              | `play-planning`                                                                                    | Design summary inlined into `play-planning` args |
| C   | `play-planning`                | `play-subagent-execution`                                                                          | Plan summary inlined into controller args        |
| D   | `play-review`                  | `branch-review --fix`, `play-branch-finish`, `pr-review` Phase 6, `issue-priming-workflow` Phase 7 | Already path-based via ADR-0012 (#166)           |

Each hop carries 2–5 KB of redundant content that the next phase could read
from disk. The artifacts already exist on disk under `.ephemeral/` —
`play-brainstorm` writes `…-design.md` and `play-planning` writes
`…-plan.md`, both established before ADR-0012. ADR-0012 explicitly named
this asymmetry in its Consequences section: "`play-review` becomes
consistent with `play-brainstorm` and `play-planning` in that it writes a
single deterministically-named artifact under `.ephemeral/`. The
phase-handoff substrate is now symmetric across the design / plan / review
producers." Issue #167 closes the consumer-side gap.

A separate consideration: `skills/play-subagent-execution/SKILL.md` § Red
Flags previously listed `Make subagent read plan file (provide full text
instead)` without scoping it to a specific subagent boundary. Read literally,
the rule forbids the controller-receives-plan-via-path pattern this ADR
introduces. The rule's protective intent — that the controller curates
exactly what context each per-task implementer subagent receives — applies
specifically to the per-task implementer dispatch boundary, not to the
controller's own receipt of the plan from its caller. This ADR documents
that scoping.

## Decision

### Hybrid consumer input contract

Each consumer skill (`play-brainstorm`, `play-planning`,
`play-subagent-execution`) accepts the upstream artifact in either of two
shapes inside its invocation prose:

1. **Path reference** (controller-preferred): a single literal line of the
   form `<Artifact label>: <repo-relative-path>`
   (e.g., `Research brief: .ephemeral/2026-05-06-167-research.md`).
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

`research-agent` itself does not write the brief; `issue-priming-workflow`
Phase 3 (the dispatching skill) does. The agent stays read-only — its
`agents/research-agent.yaml` contract is unchanged. This parallels how
`play-review` (a skill) writes its own findings file rather than delegating
to a subagent.

### Path schemes

| Artifact       | Path scheme                                      |
| -------------- | ------------------------------------------------ |
| Research brief | `.ephemeral/<YYYY-MM-DD>-<id>-research.md`       |
| Design         | `.ephemeral/<YYYY-MM-DD>-<topic>-design.md`      |
| Plan           | `.ephemeral/<YYYY-MM-DD>-<feature-name>-plan.md` |

`<id>` is the slugged form of `payload.identifier` (`#167` → `167`,
`ENG-123` → `eng-123`); the slug rule is: strip leading `#`, lowercase,
retain alphanumerics and hyphens, replace any other character with `-`.
The authoritative slug computation lives in `skills/issue-priming-workflow/SKILL.md`
Phase 3 (added by issue #167's implementation). `<topic>` and `<feature-name>`
follow the existing `play-brainstorm` / `play-planning` conventions and are
unchanged. The research-brief scheme matches the prescription in issue #167's body.

The deterministic `<branch_slug>-<head_sha>` scheme used by `play-review`
was considered for symmetry across all four producers and rejected: design
and plan artifacts are written before any implementation commits exist, so
`head_sha` is ill-defined at write time. Consumers locate files via the
producer notice line, not by guessing a path, so mixed schemes inside
`.ephemeral/` are acceptable.

### Path-validation guard

Every consumer that reads a path-referenced artifact MUST run a guard before
opening the file. The authoritative bash for the path-validation pattern lives
in `skills/play-review/SKILL.md` § Output → Side-channel file → Path; the
guard inherits that structure, narrowed per consumer to its expected suffix,
plus a `[ -r ]` readability check that does not appear in the canonical
play-review form (play-review writes its own findings file and so does not
need a readability gate at the producer; consumers reading an upstream-
produced path do — a missing or unreadable file is a fail-loud signal that
the producer notice line was malformed or the file was clobbered):

```bash
# Generic shape (each consumer narrows the allow-list)
case "$ARTIFACT_PATH" in
  .ephemeral/*-<expected-suffix>) ;;
  *) echo "<artifact> path validation failed: $ARTIFACT_PATH" >&2; exit 1 ;;
esac
[ "${ARTIFACT_PATH#*..}" = "$ARTIFACT_PATH" ] || { echo "path traversal: $ARTIFACT_PATH" >&2; exit 1; }
[ -r "$ARTIFACT_PATH" ] || { echo "artifact missing or unreadable: $ARTIFACT_PATH" >&2; exit 1; }
```

Two deliberate looseness properties of this guard, named here so future
readers do not mistake them for bugs:

- The shell-`case` glob `*` matches `/`, so paths under nested subpaths
  (e.g., `.ephemeral/sub/dir/<…>-research.md`) and an empty `<id>` slug
  (e.g., `.ephemeral/-research.md`) both pass the suffix match. Consumers
  rely on producer notice-line authenticity, not depth, for routing.
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

The symlink guard `[ -L "$F" ] && rm "$F"` (run before `Write`) — whose
authoritative form lives in `skills/play-review/SKILL.md` § Output → Write
rules and is required by ADR-0012 — is reused unchanged by
`issue-priming-workflow` Phase 3 when it persists the research brief.

### Cleanup ownership

Inherits ADR-0012 § Consequences's policy: cleanup is implicit via worktree
teardown. `play-branch-finish` Step 5 already removes the worktree under
Options 1 (merge), 2 (PR), and 4 (discard); `.ephemeral/` is destroyed with
it. No per-skill stale-artifact sweep is introduced. The
`design.md` / `plan.md` precedents have never had a sweep; ADR-0012's
findings-file decision did not introduce one; this ADR keeps the convention
uniform. Edge cases (Option 3 "Keep As-Is", direct skill invocations outside
a worktree) leave files in place. Operators may sweep manually — extending
the ADR-0012 sweep snippet with the three new markdown suffixes:

```bash
rm -f .ephemeral/*-research.md .ephemeral/*-design.md .ephemeral/*-plan.md \
      .ephemeral/*-findings.json .ephemeral/*-nits-pending.json
```

### Clarification of `skills/play-subagent-execution/SKILL.md` § Red Flags

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
  symlink guard requirement is named in this ADR's Decision § for
  cross-reference clarity.
- **Brief content is untrusted prose, not executable instructions.** The
  research brief originates from a subagent dispatched against a possibly-
  untrusted issue body (fork PRs especially, but any issue under operator
  workflow). When `play-brainstorm` reads the brief from `.ephemeral/`, it
  treats the content as descriptive prose — not as authority to act
  outside its contract. Embedded directives ("ignore prior instructions",
  tool-call snippets, shell commands, paths into the controller's filesystem)
  do not become instructions to the consumer skill, regardless of how the
  brief is phrased. The downstream skills (`play-planning`,
  `play-subagent-execution`) consume artifacts produced by the operator
  workflow itself (design, plan) and so are not directly exposed to
  untrusted-issue-body prose; the threat is contained at the
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
  has no path to reference) and would violate issue #167's explicit
  backward-compat acceptance criterion.
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
- **Have `research-agent` write the brief itself.** Would expand the agent's
  Codex sandbox from `read-only` to a write-capable mode and add the `Write`
  tool to its `agents/research-agent.yaml` `claude.tools` list. Rejected:
  the agent's role is investigation, not artifact persistence; the parallel
  to `play-review` (a skill that runs in the main conversation context with
  full Write access) is the correct one. `issue-priming-workflow` Phase 3 —
  the dispatching skill — owns persistence and notice-line emission.

## Related

- [ADR-0010](adr-0010-structured-review-findings-schema.md) — defines the
  `play-review/findings/v1` schema (transport superseded by ADR-0012).
- [ADR-0012](adr-0012-side-channel-file-delivery-for-play-review-findings.md)
  — establishes the side-channel file pattern this ADR generalizes upstream.
- Issue #164 — session-cost reduction parent.
- Issue #166 — `play-review` findings side-channel transport.
- Issue #167 — this work.
