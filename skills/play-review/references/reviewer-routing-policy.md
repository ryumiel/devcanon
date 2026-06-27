# Reviewer Routing Policy - `play-review`

This reference expands the Phase 2.75 and Phase 3 routing rules. `SKILL.md`
keeps the hard rules and fail-closed defaults eager.

## Guarded Tiny-Diff Mode

Tiny-diff mode activates only when all are true for `active_diff_range`:

1. The active diff touches at most 2 files.
2. The active diff changes at most 20 total lines (`added + removed`).
3. Every touched path stays in the low-risk allowlist.
4. No high-risk disqualifier is present.
5. `is_followup_narrow` is **false**.

If any check is ambiguous, fall back to full risk-triggered routing.

Low-risk allowlist:

- `docs/guidelines/*.md` except `documentation-standard.md`,
  `documentation-checklists.md`, `agent-authoring-guide.md`,
  `writing-skills.md`, `pr-guideline.md`, and
  `project-management-model.md`.
- `skills/**/references/red-flags.md`.
- `skills/**/references/common-mistakes.md`.

Eligible files must stay prose-only: no new or modified path-validation guards,
shell-command examples, tool-invocation examples, or review hard-rule text.

High-risk disqualifiers:

- file deletion, rename, mode change, or binary diff;
- touched `AGENTS.md`, `CONTRIBUTING.md`, `MAP.md`, `docs/adr/**`,
  `docs/arch/**`, or `docs/specs/**`;
- touched source file, test file, manifest, schema, or config file;
- changed shell commands, external-invocation examples, path-validation guards,
  critic rules, or core-review rules;
- changed reviewer-routing policy such as thresholds, allowlists,
  disqualifiers, risk-triggered reviewer triggers, or follow-up override
  behavior;
- any follow-up narrow diff.

safe tiny diff example: two wording-only edits in
`docs/guidelines/code-review-guideline.md` and
`skills/play-review/references/red-flags.md`, 8 changed lines total, no commands
or guards touched.

Small-but-risky example: a 6-line edit in `skills/play-review/SKILL.md` that
changes a path-validation guard or a `gh` command example. Result: full
risk-triggered path.

## Architecture Reviewer Trigger

Spawn when the active diff or full-PR routing summary includes
architecture-routing risks: dependency manifests, config, major entry points,
`docs/adr/**`, `docs/arch/**`, `MAP.md`, `AGENTS.md`, `agents/**`, `skills/**`
workflow policy, generated/source ownership changes, module-boundary changes,
durable decision indicators, responsibility drift, or 3+ modules.

Focus: boundary violations, dependency justification, responsibility drift,
contract changes, and AFDS v2 ADR coverage.

### Architecture override

When `is_followup_narrow == true` and `ARCHITECTURE_ROUTING_RISKS` or
`ARCH_FILES` from the Phase 2 full-PR routing summary is non-empty, always spawn
Architecture even when the active diff alone would not trigger it. The active
diff stays incremental, but ADR coverage and architecture routing checks apply
to the full PR, not just the incremental diff.

## Spec Reviewer Trigger

Spawn when the active diff or full-PR routing summary includes spec-routing
risks: docs/spec/API/user-facing behavior, CLI/operator guidance, examples,
public config schemas, files referenced by existing docs, or prose that changes
a documented pattern's canonical direction.

Focus: missing or stale docs for changed behavior, contract alignment, examples,
operator guidance, identifier drift, and spec accuracy.

### Spec override

When `is_followup_narrow == true` and `SPEC_ROUTING_RISKS` from the Phase 2
full-PR routing summary is non-empty, always spawn Spec even when the active
diff alone would not trigger it. The active diff stays incremental, but spec,
documentation, API, examples, and operator-guidance checks apply to the full PR,
not just the incremental diff.

## ADR Coverage Rubric

When Architecture fires, include the doc-impact summary and full-PR routing
summary in its briefing:

- Durable decision plus new covering `docs/adr/adr-NNNN-*.md`: pass.
- Durable decision plus existing covering ADR modified: pass.
- Deleted ADRs are never coverage evidence. Route deleted ADR paths as
  architecture risk, and require a new or modified successor ADR when the diff
  makes or removes a durable decision.
- Durable decision with no new or modified covering ADR:
  `Blocking | Documentation` recommending a covering ADR per
  `docs/adr/adr-template.md`.
- Implementation detail or refactor without durable decision: no finding.

Apply the same judgment for `MAP.md` and `docs/arch/` when major file paths,
directory layout, or system shape changes.

For `mode == "github-post"` missing-file findings, anchor to the most
architecturally significant changed line in this priority order: `MAP.md`,
`AGENTS.md`, most-modified `src/`, `agents/`, or `skills/` file, any
`ARCH_FILES` file, then the most-modified file in the diff. Tag
`Anchor: missing-file` and begin the body with "Missing-file finding (no natural
anchor - see body):".
