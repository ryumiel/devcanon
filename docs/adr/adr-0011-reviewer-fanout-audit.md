# ADR-0011: Wave 3-bis Audit of `play-review` Reviewer Fan-out

## Status

Accepted

## Context

`skills/play-review/SKILL.md` Phase 3 dispatches several reviewer
roles. This audit covers the four reviewer roles that were dispatched
as inline prompts with no promoted source-agent identity
(`agents/<role>.yaml`) backing them — the role contract lives entirely
in the per-invocation briefing prose inside `skills/play-review/SKILL.md`
Phase 3:

1. **Correctness** — logic bugs, panic discipline, error propagation,
   API contracts, plus Sub-checks 1 (substitution audit) and 2
   (documented-behavior verification).
2. **Data-safety** — secrets, injection, PII, untrusted input. Always
   spawned per Hard Rule 1.
3. **Language-idiomatic** — Rust, TypeScript, etc. Spawned dynamically
   by file extension or `language_hints`.
4. **Test-coverage** — coverage, correctness of tests, fixtures. Spawned
   when test paths appear in the active diff.

The remaining Phase 3 agents — Docs, Architecture, and Documentation
(see the dynamic-reviewer dispatch table in `skills/play-review/SKILL.md`)
— are out of scope here. They are not classified by this audit; their
classification is left to a separate pass if and when the question
arises.

ADR-0009 consolidated `branch-review` and `pr-review` into thin wrappers
around `play-review`, which reduced the call-site count for any
`play-review`-internal reviewer agent to one unique skill. That makes
the two-call-sites operational threshold from
`docs/guidelines/agent-authoring-guide.md` §4 the load-bearing constraint
for any of these four roles being promoted to source agents.

The same guide states the operational threshold for reviewer-style
delegates, including a hard-constraint exception:

> A reviewer-style prompt template should accumulate at least two
> independent call sites before promotion, unless there is already a
> hard target-native constraint win that justifies promotion on its own
> (for example, a read-only sandbox plus a fixed tool surface).

Earlier promotion passes and the `research-agent` promotion consolidated
similar reviewer-style delegates into source agents where the
role-identity bar was met. This audit applies the refined promotion
policy to the four `play-review` Phase 3 roles.

## Decision

Apply the criteria from `agent-authoring-guide.md` §4 to each candidate.
Result:

| Candidate                     | Classification   |
| ----------------------------- | ---------------- |
| `correctness-reviewer`        | keep-as-template |
| `data-safety-reviewer`        | promote          |
| `language-idiomatic-reviewer` | keep-as-template |
| `test-coverage-reviewer`      | keep-as-template |

### `correctness-reviewer` — keep-as-template

Single call site after ADR-0009. The role boundary is real but the
briefing is diff-context-heavy: full active diff, guidelines, prior
threads, doc-impact summary, plus per-invocation instructions for
Sub-checks 1 and 2. That makes the agent inherently workflow-local
scaffolding rather than a stable thin role.

The constraint potential (read-only sandbox) is marginal — useful but
not load-bearing the way it is for the data-safety role. And the
existing `code-quality-reviewer.yaml` carries an explicit
"Do not use for ... broad branch review" carve-out that reflects
ADR-0007's per-task vs branch-level pipeline split. Both candidate
moves — widening that charter, or splitting a sibling
`branch-correctness-reviewer` — were considered and rejected (see
Alternatives).

### `data-safety-reviewer` — promote

The PII / injection / secrets / unsafe-defaults charter is
domain-specific, stable across any review invocation, and semantically
meaningful outside the review pipeline. It is the one agent always
spawned regardless of file type (Hard Rule 1 in
`skills/play-review/SKILL.md`).

A promoted `agents/data-safety-reviewer.yaml` with
`claude.tools: [Read, Grep]` and `codex.sandbox_mode: read-only` matches
exactly the example cited in the agent-authoring guide's hard-constraint
exception to the two-call-sites threshold. The constraint is not
ornamental — read-only enforcement is load-bearing for a security-review
role.

### `language-idiomatic-reviewer` — keep-as-template

Role identity is per-language: Rust idiom heuristics differ from
TypeScript idiom heuristics. Promoting one parameterized agent would
require runtime language-dispatch inside the agent, which the source
schema does not model. Promoting a family
(`rust-reviewer`, `typescript-reviewer`) would give each member a single
call site and no constraint win — fails the threshold. The dynamic
per-invocation language switch fits inline briefing prose better.

### `test-coverage-reviewer` — keep-as-template

Single call site, fires conditionally only when test files appear in
the diff. The role boundary exists but its conditional trigger means it
has no consistent cross-session identity, and its constraint surface is
the same minimal read-only sandbox as the language-idiomatic role —
without a stable-role rationale, the constraint alone is insufficient.

### Wrapper symmetry

Both `branch-review` and `pr-review` delegate to `play-review`
(ADR-0009). Any role that gets promoted in a future follow-up lands
inside `play-review` Phase 3 once; both wrappers inherit the change
automatically. The classifications above are wrapper-symmetric by
construction; there is no per-wrapper divergence to encode.

## Consequences

- The single recommended promotion (`data-safety-reviewer`) is tracked
  as a separate implementation pass, not part of this audit decision.
  Rationale: keeps the audit reviewable as a pure policy change and
  preserves the separation between classification and promotion.
- The other three roles (`correctness-reviewer`,
  `language-idiomatic-reviewer`, `test-coverage-reviewer`) stay as
  inline briefing prose inside `skills/play-review/SKILL.md` Phase 3
  indefinitely — until a genuine second call site for any of them
  emerges. The keep-as-template verdicts are time-bounded against the
  current call-site geometry, not absolute.
- No wrapper-level divergence between `branch-review` and `pr-review` is
  introduced or required; any future promotion lands once in
  `play-review`.
- `agent-authoring-guide.md` §4 is unchanged. The audit applies the
  existing policy; it does not amend it.

## Alternatives considered

- **Widen `code-quality-reviewer`'s charter to cover branch-level
  correctness, optionally renaming it to `code-reviewer`.** Rejected.
  `agents/code-quality-reviewer.yaml` carries an explicit
  "Do not use for ... broad branch review" carve-out reflecting
  ADR-0007's per-task vs branch-level review pipeline split. Reversing
  that carve-out reopens the ADR-0007 problem (token duplication and
  contradictory verdicts on single-task plans). Creating a sibling
  `branch-correctness-reviewer` was the alternative form of the same
  move — also rejected, since it produces a single-call-site agent
  with no constraint win.
- **Defer all four promotions until a genuine second call site
  exists.** Rejected. Most-conservative reading of the two-call-sites
  rule, but it forfeits the data-safety-reviewer constraint win that
  the policy's hard-constraint exception was written to enable.
  Read-only sandbox enforcement at the target level is meaningfully
  stronger than relying on briefing prose for a security-review role.
- **Promote a `language-idiomatic-reviewer` family
  (`rust-reviewer`, `typescript-reviewer`, ...).** Rejected. Each
  family member would have one call site and no additional constraint
  win, failing both the cross-skill-reuse and two-call-sites criteria.
  The per-language switch belongs in the briefing template, not in
  the agent identity.

## Related

- ADR-0001 — skills-first architecture (the policy backdrop for keeping
  delegates as templates by default)
- ADR-0007 — per-task vs branch-level review pipeline delineation (the
  carve-out reason for not widening `code-quality-reviewer`)
- ADR-0009 — review pipeline consolidation into shared `play-review`
  (the structural reason the call-site count is one)
