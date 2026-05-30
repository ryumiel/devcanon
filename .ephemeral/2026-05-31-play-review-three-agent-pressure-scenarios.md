# play-review Three-agent Fanout RED Pressure Scenarios

Task: Task 1: Establish Skill-authoring RED Coverage

Base SHA captured before task edits:
`3361037f80e7f60c0b60615ef537344b63bbb440`

Scope boundary: this is local RED-phase evidence only. No authoritative
`skills/play-review/**`, wrapper, ADR, generated output, or source agent files
were edited before capturing this baseline.

## Execution Limitation

Pressure-scenario subagents were not dispatched for this Task 1 baseline. The
available task surface did not expose a dedicated pressure-subagent dispatch
tool, and this task's non-goal is to avoid changing source skill prose to make
the scenarios pass. The fallback evidence below uses source inspection and new
prose-contract assertions in `src/skill-contracts/existing-skills-prose.test.ts`.

This file therefore records RED baseline/fallback limitation evidence, not full
skill-authoring pressure verification.

## Scenario 1: TypeScript Source Plus Tests Fanout

### Pressure Prompt

Review a PR whose active diff changes `src/review.ts`, `src/review.test.ts`,
and a TypeScript helper. Route reviewers according to the current
`play-review` skill. Record which Phase 3 reviewer roles would be spawned and
which role owns correctness, data-safety, TypeScript-specific checks, and test
coverage review.

### Expected Target Contract

One always-on skill-local `Code-quality` topical reviewer owns correctness,
data-safety, language-specific TypeScript checks, tests, error handling, API
contracts, and external-invocation audits. `Architecture` and `Spec` dispatch
only when risk triggers or ambiguity require them. The maximum topical reviewer
count is three.

### Observed RED Baseline

Fallback source inspection shows the current Phase 3 model still describes:

- Core agents always spawned: `Correctness` and `Data-safety`.
- Dynamic agents by file type or `language_hints`, including `TypeScript` and
  `Test`.
- No always-on `Code-quality` owner for the combined correctness/data-safety/
  language/tests contract.

Baseline result: RED. The old model can route this scenario to separate
`Correctness`, `Data-safety`, `TypeScript`, and `Test` reviewers rather than
one `Code-quality` reviewer.

## Scenario 2: Tiny Low-risk Docs Diff

### Pressure Prompt

Review a tiny low-risk prose-only diff in an allowed markdown guidance file.
Explain what tiny-diff mode suppresses and which reviewers must still run.

### Expected Target Contract

Tiny-diff mode may suppress only risk-triggered `Architecture` and `Spec`.
It must never suppress `Code-quality` or the critic. Small-but-risky diffs
still use the full risk-triggered path.

### Observed RED Baseline

Fallback source inspection shows current tiny-diff prose says the exception
narrows "dynamic-agent fanout", that `Correctness`, `Data-safety`, and critic
remain mandatory, and that ambiguous checks fall back to "normal full dynamic
fanout".

Baseline result: RED. The current wording preserves old dynamic-agent
rationalization rather than the target risk-triggered reviewer suppression
contract.

## Scenario 3: Spec Identifier Drift Ownership

### Pressure Prompt

Review a docs/spec behavior diff where one markdown file updates a command
identifier in a code block but leaves adjacent prose stale, and the changed
prose explicitly says an older pattern is broken while unchanged sibling docs
still demonstrate that old pattern. Identify the topical owner for identifier
drift checks.

### Expected Target Contract

`Spec` owns within-document and cross-document identifier drift, stale or
missing documentation guidance, docs/spec/API/user-facing behavior, examples,
and operator guidance.

### Observed RED Baseline

Fallback source inspection shows current Phase 4 labels these as `Docs agent`
sub-checks, and the dynamic Phase 3 table separately names `Docs` and
`Documentation` reviewers.

Baseline result: RED. Identifier drift is not represented as one `Spec` topical
owner in the current skill.

## Scenario 4: Follow-up Narrow With Full-PR Architecture And Spec Risks

### Pressure Prompt

Review a follow-up where `is_followup_narrow=true` and the active incremental
diff only changes a small implementation line, but `full_pr_diff_range` includes
architecture surfaces and user-facing docs/spec/API risk. Confirm whether the
shared context has stable full-PR routing summary fields for both
`Architecture` and `Spec`, and whether the risk-triggered reviewers get
incremental active diff plus full-PR routing context.

### Expected Target Contract

Phase 2 computes stable full-PR routing summary fields for architecture-routing
risks and spec-routing risks, passes them through the shared review-context
file, and uses them for follow-up narrow override checks. `Architecture` and
`Spec` review the incremental active diff while receiving full-PR context for
their routing-specific obligations.

### Observed RED Baseline

Fallback source inspection shows Phase 2 currently computes only
`ARCH_FILES`, `NEW_ADRS`, and `MODIFIED_ADRS` for the Architecture ADR-coverage
sub-check. The shared review context carries those doc-impact fields, but not
stable full-PR routing summary fields for both Architecture and Spec risks.
Current follow-up override prose names Architecture and Documentation agents,
not Architecture and Spec.

Baseline result: RED. The current skill lacks explicit full-PR routing-summary
fields for both risk-triggered reviewers.

## Source-contract RED Assertions Added

`src/skill-contracts/existing-skills-prose.test.ts` now includes target-model
assertions for:

- `Code-quality` always-on ownership.
- Risk-triggered `Architecture` and `Spec`.
- Tiny-diff suppression limited to risk-triggered reviewers.
- Stable full-PR routing summary fields for architecture and spec risks.
- Lifecycle sentinels before topical reviewer and critic dispatch.
- Wrapper `language_hints` wording that does not imply dynamic/language-agent
  fanout.
- Stale old-role owner names in wrapper/reference prose.

Targeted test result will be appended after the RED run.

## Targeted RED Test Run

Command:

```sh
pnpm vitest run src/skill-contracts/existing-skills-prose.test.ts
```

Result: intentional RED failure.

Summary:

- Test file failed as expected: `src/skill-contracts/existing-skills-prose.test.ts`.
- 29 tests ran.
- 24 tests passed.
- 5 tests failed.

Intentional RED failures:

- `defines the play-review three-topic reviewer routing contract` failed
  because current Phase 2 lacks `full-PR routing summary`.
- `keeps play-review tiny-diff mode scoped to risk-triggered reviewer
  suppression` failed because current tiny-diff prose still says
  `dynamic-agent fanout`.
- `preserves play-review lifecycle sentinels around topical reviewers and
  critic` failed because current lifecycle prose says `Phase 3 reviewer agents`
  rather than `Phase 3 topical reviewer agents`.
- `keeps wrapper language hints from implying dynamic or language-agent fanout`
  failed because wrappers do not yet use the target `Code-quality`/risk-routing
  wording and still imply language-agent fanout.
- `removes stale old-role owner names from play-review wrapper and reference
  prose` failed because references still name old `Correctness`,
  `Data-safety`, `Docs`, or `Documentation` owners.

This confirms RED coverage before any source skill rewrite.

## Task 5 GREEN/REFACTOR Verification

Task 5 pre-task base SHA:
`bf9fcb311ba6b0d3575240ecbe592b810f8cff3e`

Scope boundary: this update records post-source-edit verification only. No
installed user-home outputs were synced. `generated/` remains a render preview
surface and is ignored by Git in this repository; source files under `skills/`
remain authoritative.

### GREEN Pressure Scenario Evidence

Pressure-scenario subagents were still not dispatched because the available
task surface does not expose a dedicated pressure-subagent dispatch tool. The
fallback verification remains source inspection plus prose-contract assertions,
now against the completed three-topical-reviewer source changes.

Post-edit targeted run:

```sh
pnpm vitest run src/skill-contracts/existing-skills-prose.test.ts
```

Result: GREEN.

Summary:

- Test file passed: `src/skill-contracts/existing-skills-prose.test.ts`.
- 30 tests ran.
- 30 tests passed.
- 0 tests failed.

The passing contracts cover:

- Always-on skill-local `Code-quality` reviewer ownership for correctness,
  data-safety, language, tests, and external-invocation checks.
- Risk-triggered `Architecture` and `Spec` routing with fail-closed ambiguity
  behavior.
- Tiny-diff suppression limited to risk-triggered `Architecture` and `Spec`;
  `Code-quality` and critic remain mandatory.
- Stable full-PR routing-summary fields for architecture-routing and
  spec-routing risks.
- Lifecycle sentinels before topical reviewer dispatch and before critic
  dispatch.
- Wrapper `language_hints` wording that no longer implies dynamic or
  language-agent fanout.
- Current wrapper/reference prose no longer names old topical owners such as
  `Correctness agent`, `Data-safety agent`, `Docs agent`, or
  `Documentation agent`.

### REFACTOR Render And Stale-wording Evidence

Render command:

```sh
pnpm run dev -- render
```

Result: passed. The render reported 8 generated agents and 56 tracked skills.
This refreshed the on-disk Claude and Codex preview trees without syncing
installed home-directory outputs.

Final stale-wording cleanup:

- Changed `skills/play-review/SKILL.md` from `Per-agent role-specific
  sub-checks` to `Per-reviewer role-specific sub-checks`.
- Changed
  `skills/play-review/references/agent-briefing-template.md` from
  `Per-agent` to `Per-reviewer` for the `<sub-checks>` placeholder.

Generated preview inspection confirmed the same `Per-reviewer` wording in:

- `generated/claude/skills/play-review/SKILL.md`
- `generated/codex/skills/play-review/SKILL.md`
- `generated/claude/skills/play-review/references/agent-briefing-template.md`
- `generated/codex/skills/play-review/references/agent-briefing-template.md`

Targeted stale-role grep across the source wrappers and listed generated
preview outputs found no current dispatch instructions for old topical
reviewer roles. Remaining `Documentation` matches are finding-category or
example guidance, not old reviewer dispatch instructions.

### Repository Verification Evidence

Targeted render integration:

```sh
pnpm vitest run src/render/existing-skills.integration.test.ts src/render/pipeline.integration.test.ts
```

Result: passed.

- 2 test files passed.
- 71 tests passed.

Markdown checks:

```sh
pnpm run format:markdown:check
pnpm run lint:markdown
```

Result: both passed.

Repository validation:

```sh
pnpm run dev -- validate
```

Result: passed with existing advisory prompt-size warnings.

Source checks:

```sh
pnpm run lint
pnpm run typecheck
pnpm run test
```

Result: all passed.

- Biome lint checked 114 files with no errors.
- TypeScript typecheck passed.
- Full Vitest run passed: 53 files, 822 passed, 3 skipped.

Full aggregate check:

```sh
pnpm run check
```

Result: stopped at `pnpm run format:check` because ignored local file
`.claude/settings.local.json` is not Biome-formatted. This file is outside the
tracked project diff and was not modified. The remaining constituent commands
listed above were run separately and passed.
